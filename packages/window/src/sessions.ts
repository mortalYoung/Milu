import { createServiceId, type Service } from "@milu/di";
import type { SessionRow } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import { type Connection, IConnection } from "./connection.ts";

export interface SessionListState {
	readonly rows: readonly SessionRow[];
	readonly arrived: boolean;
}

export class SessionListService implements Service {
	readonly store = createStore<SessionListState>()(() => ({ rows: [], arrived: false }));

	constructor(@IConnection private readonly _connection: Connection) {}

	apply(rows: readonly SessionRow[]): void {
		this.store.setState({ rows, arrived: true }, true);
	}

	async refresh(): Promise<string | null> {
		const result = await this._connection.request("sessions", {});
		this.apply(result.sessions);
		return result.selected;
	}

	get(session: string): SessionRow | undefined {
		return this.store.getState().rows.find((row) => row.name === session);
	}

	patchRead(session: string, readAt: number): void {
		this.store.setState((state) => ({ ...state, rows: state.rows.map((row) => (row.name === session ? { ...row, readAt } : row)) }), true);
	}

	patchStatus(session: string, running: boolean): void {
		this.store.setState((state) => ({ ...state, rows: state.rows.map((row) => (row.name === session ? { ...row, running } : row)) }), true);
	}

	dispose(): void {}
}

export const ISessionListService = createServiceId<SessionListService>("SessionListService");
