import { DisposableStore, type Disposable, type Service } from "./lifecycle.ts";

declare const serviceType: unique symbol;

export interface ServiceIdentifier<T> {
	(...args: readonly unknown[]): void;
	readonly name: string;
	readonly [serviceType]?: T;
}

export type ServiceId<T> = ServiceIdentifier<T>;

export type Constructor<T> = new (...args: never[]) => T;

const DEPENDENCIES = Symbol.for("milu.di.dependencies");

interface Dependency {
	readonly id: ServiceIdentifier<unknown>;
	readonly index: number;
}

function store(target: object, id: ServiceIdentifier<unknown>, index: number): void {
	if (typeof target !== "function") throw new Error(`@${id.name} can only decorate a constructor parameter`);
	const ctor = target as unknown as { [DEPENDENCIES]?: Dependency[] };
	const dependencies = (ctor[DEPENDENCIES] ??= []);
	if (dependencies.some((dependency) => dependency.index === index)) throw new Error(`@${id.name} decorates parameter ${index} twice`);
	dependencies.push({ id, index });
}

function dependenciesOf(ctor: Constructor<unknown>): readonly ServiceIdentifier<unknown>[] {
	const found: Dependency[] = [];
	let current: unknown = ctor;
	while (typeof current === "function") {
		const own = (current as { [DEPENDENCIES]?: Dependency[] })[DEPENDENCIES];
		if (own) found.push(...own);
		current = Object.getPrototypeOf(current) as unknown;
	}
	return found.sort((left, right) => left.index - right.index).map((dependency) => dependency.id);
}

export function createDecorator<T>(name: string): ServiceIdentifier<T> {
	const id = ((target: object, _key: string | symbol | undefined, index: number): void => {
		store(target, id, index);
	}) as unknown as ServiceIdentifier<T>;
	Object.defineProperty(id, "name", { value: name, configurable: true });
	return id;
}

export function createServiceId<T>(name: string): ServiceIdentifier<T> {
	return createDecorator<T>(name);
}

function assertDependencies(ctor: Constructor<unknown>, resolved: number, supplied: number): void {
	if (resolved + supplied >= ctor.length) return;
	const name = ctor.name || "anonymous service";
	throw new Error(
		`${name} needs ${ctor.length} constructor arguments but got ${resolved + supplied} — parameter decorators were dropped. ` +
			'Check that a tsconfig.json with "experimentalDecorators": true is visible from the working directory (or next to the entry file).',
	);
}

export class SyncDescriptor<T> {
	constructor(
		readonly ctor: Constructor<T>,
		readonly staticArguments: readonly unknown[] = [],
		readonly supportsDelayedInstantiation = false,
	) {}
}

export type ServiceFactory<T> = (service: InstantiationService) => T;

export type ServiceDescriptor<T> = T | SyncDescriptor<T> | ServiceFactory<T>;

export class ServiceCollection {
	private readonly _entries = new Map<ServiceIdentifier<unknown>, ServiceDescriptor<unknown>>();

	constructor(private readonly _parent?: ServiceCollection) {}

	set<T>(id: ServiceIdentifier<T>, value: ServiceDescriptor<T>): void {
		if (this._entries.has(id)) throw new Error(`${id.name} is already registered`);
		this._entries.set(id, value as ServiceDescriptor<unknown>);
	}

	has(id: ServiceIdentifier<unknown>): boolean {
		return this._entries.has(id) || (this._parent?.has(id) ?? false);
	}

	get<T>(id: ServiceIdentifier<T>): ServiceDescriptor<T> | undefined {
		return (this._entries.get(id) as ServiceDescriptor<T> | undefined) ?? this._parent?.get(id);
	}

	entries(): IterableIterator<[ServiceIdentifier<unknown>, ServiceDescriptor<unknown>]> {
		return this._entries.entries();
	}

	delete(id: ServiceIdentifier<unknown>): void {
		this._entries.delete(id);
	}
}

export interface IInstantiationService {
	get<T extends Service>(id: ServiceIdentifier<T>): T;
	createInstance<T>(ctor: Constructor<T>, ...args: readonly unknown[]): T;
	createChild(collection?: ServiceCollection): IInstantiationService;
}

export const IInstantiationService = createDecorator<IInstantiationService>("instantiationService");

function isService(value: unknown): value is Service {
	return typeof value === "object" && value !== null && typeof (value as { dispose?: unknown }).dispose === "function";
}

export class InstantiationService implements IInstantiationService, Disposable {
	private readonly _instances = new Map<ServiceIdentifier<unknown>, Service>();
	private readonly _building = new Set<ServiceIdentifier<unknown>>();
	private readonly _owned = new DisposableStore();

	private _booted = false;
	private _disposed = false;

	constructor(
		private readonly _services: ServiceCollection,
		private readonly _parent?: InstantiationService,
	) {}

	async initialize(): Promise<void> {
		if (this._disposed) throw new Error("InstantiationService is disposed");
		if (this._booted) throw new Error("InstantiationService is already initialized");
		this._booted = true;

		for (const [id] of this._services.entries()) this._resolve(id as ServiceIdentifier<Service>);
		for (const service of this._instances.values()) if (service !== this) await service.initialize?.();
	}

	get<T extends Service>(id: ServiceIdentifier<T>): T {
		if (this._disposed) throw new Error("InstantiationService is disposed");
		if (!this._booted) throw new Error(`${id.name} requested before the services were initialized`);
		return this._resolve(id as ServiceIdentifier<Service>) as T;
	}

	createInstance<T>(ctor: Constructor<T>, ...args: readonly unknown[]): T {
		if (this._disposed) throw new Error("InstantiationService is disposed");
		const dependencies = dependenciesOf(ctor as Constructor<unknown>).map((dependency) => this._resolve(dependency as ServiceIdentifier<Service>));
		assertDependencies(ctor, dependencies.length, args.length);
		const instance = new ctor(...(dependencies as never[]), ...(args as never[]));
		if (isService(instance)) this._owned.add(instance);
		return instance;
	}

	createChild(collection: ServiceCollection = new ServiceCollection()): InstantiationService {
		if (!this._booted) throw new Error("Initialize the services before creating a child");
		return new InstantiationService(collection, this);
	}

	own(disposable: Disposable): void {
		this._owned.add(disposable);
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		this._instances.clear();
		this._owned.dispose();
	}

	private _resolve(id: ServiceIdentifier<Service>): Service {
		const existing = this._instances.get(id);
		if (existing) return existing;

		const parent = this._parent?._instances.get(id);
		if (parent) return parent;

		const descriptor = this._services.get(id);
		if (descriptor === undefined) {
			if (this._parent !== undefined) return this._parent._resolve(id);
			throw new Error(`${id.name} is not registered`);
		}
		if (this._building.has(id)) throw new Error(`circular dependency on ${id.name}`);

		this._building.add(id);
		try {
			const service = this._construct(descriptor);
			this._instances.set(id, service);
			if (service !== this) this._owned.add(service);
			return service;
		} finally {
			this._building.delete(id);
		}
	}

	private _construct(descriptor: ServiceDescriptor<Service>): Service {
		if (descriptor instanceof SyncDescriptor) {
			const dependencies = dependenciesOf(descriptor.ctor as Constructor<unknown>).map((dependency) => this._resolve(dependency as ServiceIdentifier<Service>));
			assertDependencies(descriptor.ctor as Constructor<unknown>, dependencies.length, descriptor.staticArguments.length);
			return new descriptor.ctor(...(dependencies as never[]), ...(descriptor.staticArguments as never[]));
		}
		if (typeof descriptor === "function") return (descriptor as ServiceFactory<Service>)(this);
		return descriptor as Service;
	}
}
