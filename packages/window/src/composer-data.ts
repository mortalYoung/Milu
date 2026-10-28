import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

import { IConnection, type Connection } from "./connection.ts";

export interface ComposerDataEntry {
	readonly status: "idle" | "loading" | "ready" | "error";
	readonly data?: Readonly<Record<string, unknown>>;
	readonly error?: string;
}

export interface ComposerDataState {
	readonly sessions: Readonly<Record<string, ComposerDataEntry>>;
}

export class ComposerDataService implements Service {
	readonly store = createStore<ComposerDataState>()(() => ({ sessions: {} }));

	private readonly _inflight = new Map<string, Promise<void>>();

	constructor(@IConnection private readonly _connection: Connection) {}

	async ensure(session: string): Promise<void> {
		if (!session) return;
		const entry = this.store.getState().sessions[session];
		if (entry?.status === "ready" || entry?.status === "error") return;
		const inflight = this._inflight.get(session);
		if (inflight) return inflight;
		await this._fetch(session);
	}

	async refresh(session: string): Promise<void> {
		if (!session) return;
		await this._fetch(session);
	}

	invalidate(session: string): void {
		const entry = this.store.getState().sessions[session];
		this._set(session, { ...entry, status: "idle" });
	}

	drop(session: string): void {
		this.store.setState((state) => {
			if (!(session in state.sessions)) return state;
			const sessions = { ...state.sessions };
			delete sessions[session];
			return { sessions };
		}, true);
	}

	clear(): void {
		this.store.setState({ sessions: {} }, true);
	}

	dispose(): void {
		this.clear();
		this._inflight.clear();
	}

	private _fetch(session: string): Promise<void> {
		const inflight = this._inflight.get(session);
		if (inflight) return inflight;
		const previous = this.store.getState().sessions[session];
		this._set(session, { status: "loading", ...(previous?.data === undefined ? {} : { data: previous.data }) });
		const request = this._connection
			.request("composerData", { session })
			.then(({ data }) => this._set(session, { status: "ready", data }))
			.catch((error: unknown) =>
				this._set(session, { status: "error", error: error instanceof Error ? error.message : String(error), ...(previous?.data === undefined ? {} : { data: previous.data }) }),
			)
			.finally(() => this._inflight.delete(session));
		this._inflight.set(session, request);
		return request;
	}

	private _set(session: string, entry: ComposerDataEntry): void {
		this.store.setState((state) => ({ ...state, sessions: { ...state.sessions, [session]: entry } }), true);
	}
}

export const IComposerDataService = createServiceId<ComposerDataService>("ComposerDataService");
