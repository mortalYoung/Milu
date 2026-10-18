import type { ChatRow, LiveEvent, MethodName, Methods, Result, SeqEntry } from "@milu/protocol";

export interface SessionHandlers {
	onEntry(chat: string, entry: SeqEntry): void;
	onLive(event: LiveEvent): void;
	onLink(up: boolean): void;
	onChats(rows: ChatRow[]): void;
}

export class Session {
	private _socket: WebSocket | null = null;
	private _handlers: SessionHandlers | null = null;
	private _nextId = 1;
	private _closed = false;
	private _retry: ReturnType<typeof setTimeout> | undefined;
	private readonly _pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

	/** Handlers are attached before the socket opens, so no frame can arrive unheard. */
	attach(handlers: SessionHandlers): void {
		this._handlers = handlers;
	}

	open(): void {
		this._closed = false;
		const url = new URL("/ws", location.href);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

		const socket = new WebSocket(url);
		this._socket = socket;

		socket.addEventListener("open", () => {
			this._handlers?.onLink(true);
			void this.refreshChats().catch(() => {});
		});

		socket.addEventListener("message", (message) => {
			const frame = JSON.parse(String(message.data)) as { kind: string } & Record<string, unknown>;
			if (frame.kind === "entry") {
				this._handlers?.onEntry(frame["chat"] as string, { seq: frame["seq"] as number, entry: frame["entry"] as SeqEntry["entry"] });
				return;
			}
			if (frame.kind === "live") {
				this._handlers?.onLive((frame as unknown as { event: LiveEvent }).event);
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
			this._handlers?.onLink(false);
			for (const pending of this._pending.values()) pending.reject(new Error("disconnected"));
			this._pending.clear();
			if (this._closed) return;
			clearTimeout(this._retry);
			this._retry = setTimeout(() => this.open(), 800);
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

	async refreshChats(): Promise<void> {
		const result = await this.request("chats", {});
		this._handlers?.onChats(result.chats);
	}

	/** Opens a chat and replays its log; the server dedupes anything already sent live. */
	async load(chat: string): Promise<void> {
		const result = await this.request("transcript", { chat, since: 0 });
		for (const entry of result.entries) this._handlers?.onEntry(chat, entry);
	}

	request<K extends MethodName>(method: K, params: Methods[K]["params"]): Promise<Result<K>> {
		const socket = this._socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
		const id = this._nextId++;
		return new Promise<Result<K>>((resolve, reject) => {
			this._pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			socket.send(JSON.stringify({ kind: "req", id, method, params }));
		});
	}
}
