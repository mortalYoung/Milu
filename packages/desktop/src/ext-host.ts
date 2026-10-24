import { pathToFileURL } from "node:url";

import type { ChildRequest, ChildResponse, HostAction, HostRequest, HostResponse, HostTool, HostToolCall } from "@milu/core";

interface Port {
	postMessage(message: unknown): void;
	on(event: "message", listener: (message: { data: unknown }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: Port }).parentPort;
const port: Port =
	parentPort ??
	({
		postMessage: (message) => process.send?.(message),
		on: (_event, listener) => process.on("message", (message: unknown) => listener({ data: message })),
	} satisfies Port);

const tools = new Map<string, (call: HostToolCall) => Promise<{ content: unknown; details: unknown }>>();
const actions = new Map<string, (call: { args?: unknown; session: string | null }) => unknown>();
const hooks = new Map<string, (context: { messages: readonly unknown[]; session: string; inject(reminder: unknown): void }) => unknown>();
const settings = new Map<string, unknown>();
const data = new Map<string, (session: string | null) => unknown>();
const services = new Map<string, Record<string, (...args: readonly unknown[]) => unknown>>();
const disposables: { dispose(): void }[] = [];
let nextId = 1;
const pending = new Map<number, (response: HostResponse) => void>();

function callHost(method: ChildRequest["method"], params: unknown): Promise<unknown> {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, (response) => {
			pending.delete(id);
			if (response.ok) resolve(response.result);
			else reject(new Error(response.error));
		});
		port.postMessage({ id, method, params } as ChildRequest);
	});
}

function extensionContext(id: string) {
	return {
		id,
		disposables: {
			add<T extends { dispose(): void }>(value: T): T {
				disposables.push(value);
				return value;
			},
		},
		get: () => {
			throw new Error("this extension runs out of process — host services are not available yet");
		},
		settings: {
			declare(request: { key: string; defaults: unknown }) {
				if (!settings.has(request.key)) settings.set(request.key, request.defaults);
				void callHost("settings", request)
					.then((stored) => settings.set(request.key, stored ?? request.defaults))
					.catch(() => {});
				return { get: () => settings.get(request.key) ?? request.defaults };
			},
		},
		services: {
			implement(id: string, implementation: Record<string, (...args: readonly unknown[]) => unknown>) {
				services.set(id, implementation);
				void callHost("implementService", { service: id, methods: Object.keys(implementation) }).then(() => console.log(`[milu] ext-host ${process.pid} implements "${id}"`));
			},
			get(id: string) {
				return new Proxy(
					{},
					{ get: (_target, method) => (typeof method === "string" ? (...args: readonly unknown[]) => callHost("callService", { service: id, method, args }) : undefined) },
				);
			},
		},
		contributions: {
			provide(key: string, load: (session: string | null) => unknown) {
				data.set(key, load);
				void callHost("provideData", { key });
				return { dispose: () => data.delete(key) };
			},
		},
		hooks: {
			on(point: string, listener: (context: { messages: readonly unknown[]; session: string; inject(reminder: unknown): void }) => unknown) {
				hooks.set(point, listener);
				void callHost("registerHook", { point }).then(() => console.log(`[milu] ext-host ${process.pid} hooked "${point}"`));
				return { dispose: () => hooks.delete(point) };
			},
		},
		actions: {
			register(action: HostAction & { run: (context: { args?: unknown; session: string | null }) => unknown }) {
				actions.set(action.id, (call) => action.run(call));
				void callHost("registerAction", {
					id: action.id,
					...(action.scope === undefined ? {} : { scope: action.scope }),
					...(action.hotkey === undefined ? {} : { hotkey: action.hotkey }),
				}).then(() => console.log(`[milu] ext-host ${process.pid} registered action "${action.id}"`));
				return { dispose: () => actions.delete(action.id) };
			},
		},
		tools: {
			register(tool: HostTool & { run: (call: { params: unknown }) => Promise<{ content: unknown; details: unknown }> }) {
				tools.set(tool.name, (call) => tool.run({ params: call.params }));
				void callHost("registerTool", { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters }).then(() =>
					console.log(`[milu] ext-host ${process.pid} registered tool "${tool.name}"`),
				);
				return {
					dispose: () => {
						tools.delete(tool.name);
					},
				};
			},
		},
	};
}

async function activate(entry: string, extensionId: string): Promise<void> {
	const module = (await import(pathToFileURL(entry).href)) as { default?: { activate?: (context: unknown) => void | Promise<void> } };
	await module.default?.activate?.(extensionContext(extensionId));
	console.log(`[milu] ext-host ${process.pid} activated "${extensionId}"`);
}

port.on("message", (event) => {
	const message = event.data as HostRequest | HostResponse;
	if ("ok" in message) {
		pending.get(message.id)?.(message);
		return;
	}
	if (message.method === "settingsChanged") {
		settings.set(message.params.key, message.params.value);
		return;
	}
	void (async () => {
		try {
			let result: unknown = null;
			if (message.method === "activate") {
				const { entry, extension } = message.params as { entry: string; extension: string };
				await activate(entry, extension);
			} else if (message.method === "emitHook") {
				const listener = hooks.get(message.params.point);
				const injected: unknown[] = [];
				if (listener) await listener({ messages: message.params.messages, session: message.params.session, inject: (reminder) => injected.push(reminder) });
				result = { injected };
			} else if (message.method === "callService") {
				const implementation = services.get(message.params.service);
				const method = implementation?.[message.params.method];
				if (typeof method !== "function") throw new Error(`service "${message.params.service}" has no method "${message.params.method}"`);
				result = await method(...(message.params.args ?? []));
			} else if (message.method === "contributionData") {
				const load = data.get(message.params.key);
				if (!load) throw new Error(`data provider "${message.params.key}" is not registered in this process`);
				result = await load(message.params.session);
			} else if (message.method === "runAction") {
				const action = actions.get(message.params.action);
				if (!action) throw new Error(`action "${message.params.action}" is not registered in this process`);
				result = await action({ args: message.params.args, session: message.params.session });
			} else if (message.method === "runTool") {
				const tool = tools.get(message.params.tool);
				if (!tool) throw new Error(`tool "${message.params.tool}" is not registered in this process`);
				result = await tool(message.params.call);
			} else {
				for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
			}
			port.postMessage({ id: message.id, ok: true, result } satisfies ChildResponse);
		} catch (error) {
			port.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ChildResponse);
		}
	})();
});
