import { createServiceId, type Service } from "@milu/di";
import type { SessionRow } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

/** Every session, as the core describes them; each row's own read watermark included. */
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

	/** Pinning moves the row above the rest, so the list is re-read rather than patched. */
	async pin(session: string, pinned: boolean): Promise<void> {
		await this._connection.request("pin", { session, pinned });
		await this.refresh();
	}

	/** The row drops its unread dot the moment it is opened, and the core remembers why. */
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
