import { DisposableStore, createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { LiveEvent, MethodName, Methods, Result, SeqEntry } from "@milu/protocol";

const OPEN = 1;

export interface SocketEvent {
	readonly data?: unknown;
}

export interface SocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: "open" | "close" | "error" | "message", listener: (event: SocketEvent) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ConnectionDeps {
	readonly url: string;
	readonly createSocket?: SocketFactory;
	readonly retryMs?: number;
}

const defaultSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export class Connection implements Service {
	readonly onEntry: Event<{ session: string; entry: SeqEntry }>;
	readonly onLive: Event<LiveEvent>;
	readonly onLink: Event<boolean>;

	private readonly _deps: ConnectionDeps;
	private readonly _emitter = new Emitter<{ session: string; entry: SeqEntry }>();
	private readonly _live = new Emitter<LiveEvent>();
	private readonly _link = new Emitter<boolean>();
	private readonly _pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private readonly _disposables = new DisposableStore();
	private _socket: SocketLike | null = null;
	private _nextId = 1;
	private _closed = false;
	private _retry: ReturnType<typeof setTimeout> | undefined;

	constructor(deps: ConnectionDeps) {
		this._deps = deps;
		this.onEntry = this._emitter.event;
		this.onLive = this._live.event;
		this.onLink = this._link.event;
		this._disposables.add(this._emitter);
		this._disposables.add(this._live);
		this._disposables.add(this._link);
	}

	open(): void {
		this._closed = false;
		const create = this._deps.createSocket ?? defaultSocket;
		const socket = create(this._deps.url);
		this._socket = socket;

		socket.addEventListener("open", () => {
			this._link.fire(true);
		});

		socket.addEventListener("message", (message) => {
			if (typeof message.data !== "string") return;
			let frame: { kind: string } & Record<string, unknown>;
			try {
				frame = JSON.parse(message.data) as { kind: string } & Record<string, unknown>;
			} catch {
				return;
			}
			if (frame.kind === "entry") {
				this._emitter.fire({ session: frame["session"] as string, entry: { seq: frame["seq"] as number, entry: frame["entry"] as SeqEntry["entry"] } });
				return;
			}
			if (frame.kind === "live") {
				this._live.fire((frame as unknown as { event: LiveEvent }).event);
				return;
			}
			if (frame.kind !== "res") return;
			const id = frame["id"] as number;
			const pending = this._pending.get(id);
			if (!pending) return;
			this._pending.delete(id);
			if (frame["ok"] === true) pending.resolve(frame["result"]);
			else {
				const error = frame["error"] as { code?: string; message?: string } | undefined;
				pending.reject(new Error(error?.message ?? error?.code ?? "request failed"));
			}
		});

		const drop = () => {
			this._link.fire(false);
			for (const pending of this._pending.values()) pending.reject(new Error("disconnected"));
			this._pending.clear();
			if (this._closed) return;
			clearTimeout(this._retry);
			this._retry = setTimeout(() => this.open(), this._deps.retryMs ?? 800);
		};
		socket.addEventListener("close", drop);
		socket.addEventListener("error", () => socket.close());
	}

	close(): void {
		this._closed = true;
		clearTimeout(this._retry);
		this._socket?.close();
		this._socket = null;
	}

	async load(session: string, options: { mode?: "older" | "newer"; cursor?: string } = {}): Promise<Result<"transcript">> {
		return this.request("transcript", { session, ...options });
	}

	request<K extends MethodName>(method: K, params: Methods[K]["params"]): Promise<Result<K>> {
		const socket = this._socket;
		if (!socket || socket.readyState !== OPEN) return Promise.reject(new Error("not connected"));
		const id = this._nextId++;
		return new Promise<Result<K>>((resolve, reject) => {
			this._pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			socket.send(JSON.stringify({ kind: "req", id, method, params }));
		});
	}

	dispose(): void {
		this.close();
		this._disposables.dispose();
	}
}

export const ConnectionId = createServiceId<Connection>("Connection");
