import { join } from "node:path";

import type {
	AgentHookPoint,
	AgentMessage,
	AgentReminder,
	ExtensionHost,
	ExtensionHostFactory,
	HostAction,
	HostRequest,
	HostResponse,
	HostSink,
	HostTool,
	HostToolCall,
	HostToolResult,
} from "@milu/core";
import { app, utilityProcess } from "electron";

class UtilityExtensionHost implements ExtensionHost {
	private readonly _child;
	private readonly _pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	private _nextId = 1;
	private _spawned: Promise<void>;
	private _dead: string | null = null;

	constructor(
		readonly id: string,
		private readonly _sink: HostSink,
	) {
		this._child = utilityProcess.fork(join(app.getAppPath(), "dist-electron/ext-host.cjs"), [], { stdio: "inherit" });
		this._spawned = new Promise((resolve) => this._child.once("spawn", () => resolve()));
		this._child.on("message", (message: HostResponse | { id: number; method: string; params: unknown }) => {
			if ("ok" in message) {
				const pending = this._pending.get(message.id);
				this._pending.delete(message.id);
				if (message.ok) pending?.resolve(message.result);
				else pending?.reject(new Error(message.error));
				return;
			}
			if (message.method === "registerTool") {
				this._sink.tool(message.params as HostTool);
				this._child.postMessage({ id: message.id, ok: true, result: null });
			} else if (message.method === "registerAction") {
				this._sink.action(message.params as HostAction);
				this._child.postMessage({ id: message.id, ok: true, result: null });
			} else if (message.method === "registerHook") {
				this._sink.hook((message.params as { point: AgentHookPoint }).point);
				this._child.postMessage({ id: message.id, ok: true, result: null });
			} else if (message.method === "provideData") {
				this._sink.data((message.params as { key: string }).key);
				this._child.postMessage({ id: message.id, ok: true, result: null });
			} else if (message.method === "callService") {
				const { service, method, args } = message.params as { service: string; method: string; args: readonly unknown[] };
				void this._sink.call(service, method, args).then(
					(result) => this._child.postMessage({ id: message.id, ok: true, result }),
					(error: unknown) => this._child.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
				);
			} else if (message.method === "implementService") {
				const { service, methods } = message.params as { service: string; methods: readonly string[] };
				this._sink.service(service, methods);
				this._child.postMessage({ id: message.id, ok: true, result: null });
			} else if (message.method === "settings") {
				const { key, defaults } = message.params as { key: string; defaults: unknown };
				this._child.postMessage({ id: message.id, ok: true, result: this._sink.settings(key, defaults) });
			} else {
				this._child.postMessage({ id: message.id, ok: true, result: null });
			}
		});
		this._child.on("exit", (code) => {
			const error = `extension host "${this.id}" exited with code ${String(code)}`;
			for (const pending of this._pending.values()) pending.reject(new Error(error));
			this._pending.clear();
			this._dead = error;
			this._sink.exited(error);
		});
	}

	async activate(entry: string): Promise<void> {
		await this._spawned;
		await this._call("activate", { entry, extension: this.id });
	}

	async runTool(tool: string, call: HostToolCall): Promise<HostToolResult> {
		await this._spawned;
		return (await this._call("runTool", { tool, call })) as HostToolResult;
	}

	async runAction(action: string, params: { args?: unknown; session: string | null }): Promise<unknown> {
		await this._spawned;
		return this._call("runAction", { action, ...params });
	}

	notifySettings(key: string, value: unknown): void {
		if (this._dead !== null) return;
		this._child.postMessage({ id: 0, method: "settingsChanged", params: { key, value } } as HostRequest);
	}

	async contributionData(key: string, session: string | null): Promise<unknown> {
		await this._spawned;
		return this._call("contributionData", { key, session });
	}

	async callService(service: string, method: string, args: readonly unknown[]): Promise<unknown> {
		await this._spawned;
		return this._call("callService", { service, method, args });
	}

	async emitHook(point: AgentHookPoint, params: { messages: readonly AgentMessage[]; session: string }): Promise<{ injected: readonly AgentReminder[] }> {
		await this._spawned;
		return (await this._call("emitHook", { point, ...params })) as { injected: readonly AgentReminder[] };
	}

	dispose(): void {
		this._child.kill();
	}

	private _call(method: HostRequest["method"], params: unknown): Promise<unknown> {
		if (this._dead !== null) return Promise.reject(new Error(this._dead));
		const id = this._nextId++;
		return new Promise((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._child.postMessage({ id, method, params } as HostRequest);
		});
	}
}

export const extensionHostFactory: ExtensionHostFactory = {
	create: (id, sink) => new UtilityExtensionHost(id, sink),
};
