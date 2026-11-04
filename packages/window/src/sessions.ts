import { createServiceId, type Service } from "@milu/di";
import type { SessionRow } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import { type Connection, IConnection } from "./connection.ts";

export type SessionListView = "focus" | "detail" | "groups";

const VIEW_KEY = "milu.sessions.view";

function initialView(): SessionListView {
	const value = localStorage.getItem(VIEW_KEY);
	return value === "detail" || value === "groups" ? value : "focus";
}

export interface SessionListState {
	readonly rows: readonly SessionRow[];
	readonly arrived: boolean;
	readonly view: SessionListView;
}

export class SessionListService implements Service {
	readonly store = createStore<SessionListState>()(() => ({ rows: [], arrived: false, view: initialView() }));

	constructor(@IConnection private readonly _connection: Connection) {}

	apply(rows: readonly SessionRow[]): void {
		this.store.setState((state) => ({ ...state, rows, arrived: true }), true);
	}

	async refresh(): Promise<string | null> {
		const result = await this._connection.request("sessions", {});
		this.apply(result.sessions);
		return result.selected;
	}

	get(session: string): SessionRow | undefined {
		return this.store.getState().rows.find((row) => row.name === session);
	}

	setView(view: SessionListView): void {
		if (this.store.getState().view === view) return;
		this.store.setState((state) => ({ ...state, view }), true);
		localStorage.setItem(VIEW_KEY, view);
	}

	patchRead(session: string, readAt: number): void {
		this.store.setState((state) => ({ ...state, rows: state.rows.map((row) => (row.name === session ? { ...row, readAt } : row)) }), true);
	}

	patchStatus(session: string, running: boolean): void {
		this.store.setState((state) => ({ ...state, rows: state.rows.map((row) => (row.name === session ? { ...row, running } : row)) }), true);
	}

	patchCompacting(session: string, compacting: boolean): void {
		this.store.setState((state) => ({ ...state, rows: state.rows.map((row) => (row.name === session ? { ...row, compacting } : row)) }), true);
	}

	dispose(): void {}
}

export const ISessionListService = createServiceId<SessionListService>("SessionListService");
