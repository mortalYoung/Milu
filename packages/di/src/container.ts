import { type Disposable, DisposableStore, type Service } from "./lifecycle.ts";

declare const serviceIdType: unique symbol;

export interface ServiceId<T extends Service> {
	readonly name: string;
	readonly [serviceIdType]?: T;
}

export function createServiceId<T extends Service>(name: string): ServiceId<T> {
	return { name };
}

type Factory = (container: Container) => Service;

export class Container implements Disposable {
	private readonly _registrations = new Map<ServiceId<Service>, Factory>();
	private readonly _instances = new Map<ServiceId<Service>, Service>();
	private readonly _constructing = new Set<ServiceId<Service>>();
	private readonly _built: Service[] = [];
	private readonly _owned = new DisposableStore();
	private readonly _parent: Container | null;

	private _booted = false;
	private _disposed = false;

	constructor(parent: Container | null = null) {
		this._parent = parent;
	}

	register<T extends Service>(id: ServiceId<T>, create: (container: Container) => T): void {
		if (this._disposed) throw new Error(`Container is disposed — cannot register ${id.name}`);
		if (this._booted) throw new Error(`Container is initialized — cannot register ${id.name}`);
		if (this._registrations.has(id)) throw new Error(`${id.name} is already registered`);
		this._registrations.set(id, create);
	}

	createChild(): Container {
		if (this._disposed) throw new Error("Container is disposed");
		if (!this._booted) throw new Error("Initialize the container before creating a child");
		return new Container(this);
	}

	own(disposable: Disposable): void {
		this._owned.add(disposable);
	}

	async initialize(): Promise<void> {
		if (this._disposed) throw new Error("Container is disposed");
		if (this._booted) throw new Error("Container is already initialized");
		if (this._parent && !this._parent._booted) throw new Error("Parent container is not initialized");
		this._booted = true;

		for (const id of this._registrations.keys()) this._build(id);
		for (const service of this._built) await service.initialize?.();
	}

	get<T extends Service>(id: ServiceId<T>): T {
		if (!this._booted) throw new Error(`Container is not initialized — cannot get ${id.name}`);
		return this._build(id) as T;
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		this._built.length = 0;
		this._instances.clear();
		this._owned.dispose();
	}

	private _build(id: ServiceId<Service>): Service {
		if (this._disposed) throw new Error("Container is disposed");

		const existing = this._instances.get(id);
		if (existing) return existing;

		const create = this._registrations.get(id);
		if (!create) {
			if (this._parent) return this._parent._build(id);
			throw new Error(`${id.name} is not registered`);
		}
		if (this._constructing.has(id)) throw new Error(`Circular dependency on ${id.name}`);

		this._constructing.add(id);
		try {
			const service = create(this);
			this._instances.set(id, service);
			this._built.push(service);
			this._owned.add(service);
			return service;
		} finally {
			this._constructing.delete(id);
		}
	}
}
