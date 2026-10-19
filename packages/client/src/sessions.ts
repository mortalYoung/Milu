import { createServiceId, type Service } from "@milu/di";
import type { SessionRow } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export class SessionListService implements Service {
	readonly rows = new Store<readonly SessionRow[]>([]);
	readonly arrived = new Store(false);

	constructor(private readonly _connection: Connection) {}

	async refresh(): Promise<void> {
		const result = await this._connection.request("sessions", {});
		this.rows.set(result.sessions);
		this.arrived.set(true);
	}

	get(session: string): SessionRow | undefined {
		return this.rows.get().find((row) => row.name === session);
	}

	async markRead(session: string, readAt: number): Promise<void> {
		const row = this.get(session);
		if (!row || readAt <= (row.readAt ?? 0)) return;
		this.rows.update((rows) => rows.map((each) => (each.name === session ? { ...each, readAt } : each)));
		await this._connection.request("markRead", { session, readAt });
	}

	dispose(): void {
		this.rows.dispose();
		this.arrived.dispose();
	}
}

export const SessionListServiceId = createServiceId<SessionListService>("SessionListService");
