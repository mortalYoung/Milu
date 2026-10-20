import { createServiceId, type Service } from "@milu/di";
import type { SessionRow } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export class SessionListService implements Service {
	readonly rows = new Store<readonly SessionRow[]>([]);
	readonly arrived = new Store(false);

	constructor(private readonly _connection: Connection) {}

	async refresh(): Promise<string | null> {
		const result = await this._connection.request("sessions", {});
		this.rows.set(result.sessions);
		this.arrived.set(true);
		return result.selected;
	}

	get(session: string): SessionRow | undefined {
		return this.rows.get().find((row) => row.name === session);
	}

	patchStatus(session: string, running: boolean, error?: string): void {
		this.rows.update((rows) => rows.map((row) => (row.name === session ? { ...row, running, error: error ?? undefined } : row)));
	}

	dispose(): void {
		this.rows.dispose();
		this.arrived.dispose();
	}
}

export const SessionListServiceId = createServiceId<SessionListService>("SessionListService");
