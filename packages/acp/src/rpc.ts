export const ERROR = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
	authRequired: -32000,
	resourceNotFound: -32002,
	cancelled: -32800,
} as const;

export class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
	}
}

export interface Handlers {
	readonly requests: Readonly<Record<string, (params: unknown) => unknown | Promise<unknown>>>;
	readonly notifications: Readonly<Record<string, (params: unknown) => void>>;
}

interface Waiter {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
}

type Id = number | string;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class RpcServer {
	private readonly _waiters = new Map<string, Waiter>();
	private _handlers: Handlers = { requests: {}, notifications: {} };
	private _seq = 0;

	constructor(private readonly _write: (message: unknown) => void) {}

	handlers(handlers: Handlers): void {
		this._handlers = handlers;
	}

	request(method: string, params?: unknown): Promise<unknown> {
		const id = ++this._seq;
		const sent = new Promise<unknown>((resolve, reject) => this._waiters.set(String(id), { resolve, reject }));
		this._write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
		return sent;
	}

	notify(method: string, params?: unknown): void {
		this._write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	async serve(input: AsyncIterable<string | Buffer>): Promise<void> {
		let pending = "";
		const decoder = new TextDecoder();
		for await (const chunk of input) {
			pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
			for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
				const line = pending.slice(0, at);
				pending = pending.slice(at + 1);
				await this._incoming(line);
			}
		}
		if (pending.trim() !== "") await this._incoming(pending);
	}

	private async _incoming(line: string): Promise<void> {
		if (line.trim() === "") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this._write({ jsonrpc: "2.0", id: null, error: { code: ERROR.parse, message: "parse error" } });
			return;
		}
		if (!isRecord(parsed)) {
			this._write({ jsonrpc: "2.0", id: null, error: { code: ERROR.invalidRequest, message: "not an object" } });
			return;
		}
		const method = parsed["method"];
		const id = parsed["id"] as Id | null | undefined;
		const params = parsed["params"];
		if (typeof method !== "string") {
			this._settle(id, parsed);
			return;
		}
		if (id === undefined || id === null) {
			const notified = this._handlers.notifications[method];
			if (notified !== undefined) {
				try {
					notified(params);
				} catch (error) {
					console.error(`notification ${method} failed:`, error);
				}
			}
			return;
		}
		const handler = this._handlers.requests[method];
		if (handler === undefined) {
			this._fail(id, ERROR.methodNotFound, `no method "${method}"`);
			return;
		}
		try {
			const result = await handler(params);
			this._write({ jsonrpc: "2.0", id, result: result ?? {} });
		} catch (error) {
			if (error instanceof RpcError) this._fail(id, error.code, error.message, error.data);
			else this._fail(id, ERROR.internal, error instanceof Error ? error.message : String(error));
		}
	}

	private _settle(id: Id | null | undefined, message: Record<string, unknown>): void {
		const key = String(id);
		const waiter = this._waiters.get(key);
		if (waiter === undefined) return;
		this._waiters.delete(key);
		const error = message["error"];
		if (isRecord(error)) {
			const code = typeof error["code"] === "number" ? error["code"] : ERROR.internal;
			const text = typeof error["message"] === "string" ? error["message"] : "request failed";
			waiter.reject(new RpcError(code, text, error["data"]));
			return;
		}
		waiter.resolve(message["result"]);
	}

	private _fail(id: Id, code: number, message: string, data?: unknown): void {
		this._write({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
	}
}
