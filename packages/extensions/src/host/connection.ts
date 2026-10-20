import { DisposableStore, createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { LiveEvent, MethodName, Params, Result, SeqEntry, Snapshot } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import type { ServerEvent, Transport } from "./transport.ts";

export class Connection implements Service {
	readonly store = createStore<{ linked: boolean; pending: Readonly<Record<string, number>> }>()(() => ({ linked: false, pending: {} }));
	readonly onEntry: Event<{ session: string; entry: SeqEntry }>;
	readonly onLive: Event<LiveEvent>;
	readonly onSnapshot: Event<Snapshot>;
	readonly onLink: Event<boolean>;

	private readonly _transport: Transport;
	private readonly _entry = new Emitter<{ session: string; entry: SeqEntry }>();
	private readonly _live = new Emitter<LiveEvent>();
	private readonly _snapshot = new Emitter<Snapshot>();
	private readonly _link = new Emitter<boolean>();
	private readonly _disposables = new DisposableStore();
	private _subscribed = false;

	constructor(transport: Transport) {
		this._transport = transport;
		this.onEntry = this._entry.event;
		this.onLive = this._live.event;
		this.onSnapshot = this._snapshot.event;
		this.onLink = this._link.event;
		this._disposables.add(this._entry);
		this._disposables.add(this._live);
		this._disposables.add(this._snapshot);
		this._disposables.add(this._link);
	}

	async connect(): Promise<void> {
		if (!this._subscribed) {
			this._subscribed = true;
			this._disposables.add({ dispose: this._transport.subscribe((event) => this._receive(event)) });
		}
		try {
			const snapshot = await this._transport.connect();
			this._snapshot.fire(snapshot);
			this._setLinked(true);
		} catch (error) {
			this._setLinked(false);
			throw error;
		}
	}

	close(): void {
		this._transport.close();
		this._setLinked(false);
	}

	async load(session: string, options: { mode?: "older" | "newer"; cursor?: string } = {}): Promise<Result<"transcript">> {
		return this.request("transcript", { session, ...options });
	}

	pending(method: MethodName): number {
		return this.store.getState().pending[method] ?? 0;
	}

	async request<K extends MethodName>(method: K, params: Params<K>): Promise<Result<K>> {
		this._count(method, 1);
		try {
			return await this._transport.request(method, params);
		} finally {
			this._count(method, -1);
		}
	}

	dispose(): void {
		this.close();
		this._disposables.dispose();
	}

	private _receive(event: ServerEvent): void {
		if (event.type === "snapshot") {
			this._snapshot.fire(event.snapshot);
			return;
		}
		if (event.type === "entry") {
			this._entry.fire({ session: event.session, entry: event.entry });
			return;
		}
		this._live.fire(event.event);
	}

	private _setLinked(up: boolean): void {
		if (this.store.getState().linked === up) return;
		this.store.setState((state) => ({ ...state, linked: up }), true);
		this._link.fire(up);
	}

	private _count(method: string, delta: number): void {
		this.store.setState((state) => {
			const pending = { ...state.pending };
			const next = (pending[method] ?? 0) + delta;
			if (next > 0) pending[method] = next;
			else delete pending[method];
			return { ...state, pending };
		}, true);
	}
}

export const ConnectionId = createServiceId<Connection>("Connection");
