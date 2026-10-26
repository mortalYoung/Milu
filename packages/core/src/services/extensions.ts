import { createServiceId, DisposableStore, IInstantiationService, type Service } from "@milu/di";
import type { ExtensionStatus, ExtensionFailureText } from "@milu/protocol";

import type { ExtensionHost, ExtensionHostFactory } from "../extensions/host.ts";
import { EXTENSION_API_VERSION, isManifestData } from "../extensions/manifest.ts";
import type { DiscoveredExtensions, ExtensionFailure, WidgetRef } from "../extensions/source.ts";
import type { ExtensionServiceProxy, ExtensionServices } from "../extensions/types.ts";
import {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	COMPOSER_COMMANDS_POINT,
	type ComposerCommand,
	type ComposerTipItem,
	type SlotItem,
	type WelcomeItem,
	type ComposerWidgetItem,
	type Extension,
	type ExtensionContext,
	SESSION_HEADER_POINT,
	SESSION_FOOTER_POINT,
	CHAT_BAR_POINT,
	CHAT_NAME_POINT,
	CHAT_PANES_POINT,
	WELCOME_TIMELINE_POINT,
	SESSION_MENU_POINT,
	WELCOME_ITEMS_POINT,
	type SessionBarItem,
	type SessionMenuItem,
} from "../extensions/types.ts";
import type { Session } from "../session/session.ts";
import { IActionService } from "./actions.ts";
import type { ActionService } from "./actions.ts";
import { IComposerService } from "./composer.ts";
import type { ComposerService } from "./composer.ts";
import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";
import { IContributionService } from "./contributions.ts";
import type { ContributionService } from "./contributions.ts";
import { IHookService } from "./hooks.ts";
import type { HookService } from "./hooks.ts";
import { IModelsService } from "./models.ts";
import type { ModelsService } from "./models.ts";
import { ISettingsService, type SettingsPoint } from "./settings.ts";
import type { SettingsService } from "./settings.ts";
import { IToolService } from "./tools.ts";
import type { ToolService } from "./tools.ts";

export type ExtensionDeps = DiscoveredExtensions;

const HOST_RESTART_LIMIT = 3;
const HOST_RESTART_DELAY_MS = 300;

interface Loaded {
	readonly extension: Extension;
	readonly disposables: DisposableStore;
	readonly context: ExtensionContext;
}

export class ExtensionService implements Service {
	private readonly _pending: readonly Extension[];
	private readonly _failures: ExtensionFailure[];
	private readonly _windows: readonly WidgetRef[];
	private readonly _hosts: ExtensionHostFactory | undefined;
	private readonly _hosted: ReadonlyMap<string, string>;
	private readonly _declaredServices = new Set<string>();
	private readonly _registry = new Map<string, { readonly owner: string; readonly methods: readonly string[] }>();
	private readonly _running = new Map<string, ExtensionHost>();
	private readonly _hostRegistrations = new Map<string, DisposableStore>();
	private readonly _loaded: Loaded[] = [];
	private _activation: Promise<void> = Promise.resolve();

	constructor(
		@IContributionService private readonly _contributionService: ContributionService,
		@IConfigService private readonly _configService: ConfigService,
		@IActionService private readonly _actionService: ActionService,
		@IModelsService private readonly _modelsService: ModelsService,
		@IHookService private readonly _hookService: HookService,
		@ISettingsService private readonly _settingsService: SettingsService,
		@IComposerService private readonly _composerService: ComposerService,
		@IToolService private readonly _toolService: ToolService,
		@IInstantiationService private readonly _services: IInstantiationService,
		deps: ExtensionDeps,
		hosts?: ExtensionHostFactory,
	) {
		this._pending = deps.extensions;
		this._failures = [...deps.failures];
		this._windows = deps.widgets;
		this._hosted = new Map(deps.hosted.map((hosted) => [hosted.id, hosted.entry]));
		for (const service of deps.services) {
			this._registry.set(service.id, { owner: service.extension, methods: service.methods });
			this._declaredServices.add(service.id);
		}
		this._hosts = hosts;
	}

	async initialize(): Promise<void> {
		this._contributionService.declare<SessionMenuItem>(SESSION_MENU_POINT);
		this._contributionService.declare<SessionBarItem>(SESSION_HEADER_POINT);
		this._contributionService.declare<SessionBarItem>(SESSION_FOOTER_POINT);
		this._contributionService.declare<ComposerWidgetItem>(COMPOSER_LEFT_POINT);
		this._contributionService.declare<ComposerWidgetItem>(COMPOSER_RIGHT_POINT);
		this._contributionService.declare<ComposerTipItem>(COMPOSER_TIPS_POINT);
		this._contributionService.declare<ComposerCommand>(COMPOSER_COMMANDS_POINT);
		this._contributionService.declare<WelcomeItem>(WELCOME_ITEMS_POINT);
		this._contributionService.declare<SlotItem>(WELCOME_TIMELINE_POINT, "global");
		this._contributionService.declare<SlotItem>(CHAT_BAR_POINT);
		this._contributionService.declare<SlotItem>(CHAT_NAME_POINT);
		this._contributionService.declare<SlotItem>(CHAT_PANES_POINT);
		for (const extension of this._pending) this._register(extension);
		this._activation = this._activateAll();
	}

	settled(): Promise<void> {
		return this._activation;
	}

	private _register(extension: Extension): void {
		if (this._loaded.some((entry) => entry.extension.id === extension.id)) {
			throw new Error(`extension "${extension.id}" is already loaded`);
		}

		const disposables = new DisposableStore();
		const context: ExtensionContext = {
			id: extension.id,
			disposables,
			get: (id) => this._services.get(id),
			config: this._configService,
			actions: this._actionService,
			models: this._modelsService,
			settings: this._settingsService,
			composer: this._composerService,
			tools: this._toolService,
			services: this.services,
		};

		this._loaded.push({ extension, disposables, context });
		for (const [point, values] of Object.entries(extension.contributions ?? {})) {
			const target = this._contributionService.get<unknown>(point);
			for (const value of values) disposables.add(target.contribute(this._bind(extension.id, value)));
		}
	}

	private _bind(id: string, value: unknown): unknown {
		const data = (value as { data?: unknown }).data;
		if (!isManifestData(data)) return value;
		const key = data.key;
		return { ...(value as object), data: (session: Session) => this._dataOf(id, key, session) };
	}

	private async _dataOf(id: string, key: string, session: Session): Promise<unknown> {
		return this.data(id, key, session.name);
	}

	async data(extension: string, key: string, session: string | null): Promise<unknown> {
		const host = this._running.get(extension);
		if (host === undefined) {
			throw new Error(this._hosted.has(extension) ? `extension "${extension}" is not running` : `extension "${extension}" has no data provider`);
		}
		return host.contributionData(key, session);
	}

	private async _activateAll(): Promise<void> {
		for (const entry of this._loaded.slice()) {
			try {
				const hosted = this._hosted.get(entry.extension.id);
				if (hosted !== undefined) {
					if (this._hosts === undefined) throw new Error("no extension host is available — a packaged extension needs the desktop shell to run");
					await this._activateHosted(entry, this._hosts, hosted);
				} else {
					await entry.extension.activate?.(entry.context);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this._failures.push({ ref: `activate:${entry.extension.id}`, error: message });
				this.unload(entry.extension.id);
			}
		}
	}

	private async _activateHosted(entry: Loaded, factory: ExtensionHostFactory, path: string): Promise<void> {
		const id = entry.extension.id;
		const points = new Map<string, SettingsPoint<unknown>>();
		let attempts = 0;

		const start = async (): Promise<void> => {
			let host: ExtensionHost;
			const keys = new Set<string>();
			const round = new DisposableStore();
			this._hostRegistrations.set(id, round);
			host = factory.create(id, {
				tool: (tool) => {
					round.add(
						this._toolService.register({
							...tool,
							run: async (call) => (await host.runTool(tool.name, { toolCallId: call.toolCallId, name: tool.name, params: call.params, workspace: call.workspace })) as never,
						}),
					);
				},
				settings: (key, defaults) => {
					let point = points.get(key);
					if (point === undefined) {
						point = this._settingsService.declare<unknown>({ key, defaults });
						points.set(key, point);
					}
					keys.add(key);
					return point.get();
				},
				action: (action) => {
					round.add(
						this._actionService.register({
							id: action.id,
							...(action.scope === undefined ? {} : { scope: action.scope }),
							...(action.hotkey === undefined ? {} : { hotkey: action.hotkey }),
							run: async (context) => (await host.runAction(action.id, { args: context.args, session: context.session?.name ?? null })) as never,
						}),
					);
				},
				hook: (point) => {
					round.add(
						this._hookService.on(point, async (context) => {
							const { injected } = await host.emitHook(point, { messages: context.messages, session: context.session.name });
							for (const reminder of injected) context.inject(reminder);
						}),
					);
				},
				data: (key) => {
					void key;
				},
				service: (service, methods) => {
					this._registry.set(service, { owner: id, methods });
				},
				call: (service, method, args) => this._callService(service, method, args),
				exited: (error) => {
					round.dispose();
					for (const [name, entry] of this._registry) if (entry.owner === id && !this._declaredServices.has(name)) this._registry.delete(name);
					attempts += 1;
					if (attempts > HOST_RESTART_LIMIT) {
						this._failures.push({ ref: `host:${id}`, error: `${error} (gave up after ${HOST_RESTART_LIMIT} restarts)` });
						this.unload(id);
						return;
					}
					void new Promise((resolve) => setTimeout(resolve, HOST_RESTART_DELAY_MS * attempts)).then(start);
				},
			});
			this._running.set(id, host);
			round.add({ dispose: () => host.dispose() });
			round.add(
				this._settingsService.onChange(() => {
					for (const key of keys) host.notifySettings(key, points.get(key)?.get());
				}),
			);
			await host.activate(path);
		};

		await start();
	}

	unload(id: string): void {
		this._hostRegistrations.get(id)?.dispose();
		this._hostRegistrations.delete(id);
		const at = this._loaded.findIndex((entry) => entry.extension.id === id);
		if (at < 0) return;
		const [entry] = this._loaded.splice(at, 1);
		entry?.disposables.dispose();
	}

	loaded(): readonly string[] {
		return this._loaded.map((entry) => entry.extension.id);
	}

	failures(): readonly ExtensionFailure[] {
		return this._failures;
	}

	widgets(): readonly WidgetRef[] {
		return this._windows;
	}

	status(): { readonly extensions: readonly ExtensionStatus[]; readonly failures: readonly ExtensionFailureText[] } {
		return {
			extensions: this._pending.map((extension) => ({
				id: extension.id,
				source: this._hosted.has(extension.id) ? "package" : "builtin",
				apiVersion: extension.apiVersion ?? EXTENSION_API_VERSION,
				services: [...this._registry].filter(([, entry]) => entry.owner === extension.id).map(([name]) => name),
			})),
			failures: this._failures.map((failure) => ({ ref: failure.ref, error: failure.error })),
		};
	}

	readonly services: ExtensionServices = {
		get: (id) => this._service(id),
	};

	private _service(id: string): ExtensionServiceProxy {
		const entry = this._registry.get(id);
		if (entry === undefined) throw new Error(`service "${id}" is not declared`);
		return new Proxy({} as ExtensionServiceProxy, {
			get: (_target, method) => {
				if (typeof method !== "string") return undefined;
				return (...args: readonly unknown[]) => this._callService(id, method, args);
			},
		});
	}

	private async _callService(id: string, method: string, args: readonly unknown[]): Promise<unknown> {
		const entry = this._registry.get(id);
		if (entry === undefined) throw new Error(`service "${id}" is not declared`);
		if (!entry.methods.includes(method)) throw new Error(`service "${id}" has no method "${method}"`);
		const host = this._running.get(entry.owner);
		if (host === undefined) throw new Error(`extension "${entry.owner}" is not running`);
		const result = await host.callService(id, method, args);
		try {
			structuredClone(result);
		} catch (error) {
			throw new Error(`service "${id}"."${method}" returned a value that cannot cross the process boundary: ${error instanceof Error ? error.message : String(error)}`);
		}
		return result;
	}

	dispose(): void {
		for (const host of this._running.values()) host.dispose();
		this._running.clear();
		const failures: unknown[] = [];
		for (const entry of this._loaded.splice(0).reverse()) {
			try {
				entry.disposables.dispose();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "extension dispose failed");
	}
}

export const IExtensionService = createServiceId<ExtensionService>("ExtensionService");
