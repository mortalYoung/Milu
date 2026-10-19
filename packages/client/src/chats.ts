import { createServiceId, type Service } from "@milu/di";
import type { ChatRow } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

/** Every chat, as the server describes them; the row's own read watermark included. */
export class ChatsService implements Service {
	readonly rows = new Store<readonly ChatRow[]>([]);
	readonly arrived = new Store(false);

	constructor(private readonly _connection: Connection) {}

	async refresh(): Promise<void> {
		const result = await this._connection.request("chats", {});
		this.rows.set(result.chats);
		this.arrived.set(true);
	}

	get(chat: string): ChatRow | undefined {
		return this.rows.get().find((row) => row.name === chat);
	}

	/** The row drops its unread dot the moment it is opened, and the server remembers why. */
	async markRead(chat: string, readAt: number): Promise<void> {
		const row = this.get(chat);
		if (!row || readAt <= (row.readAt ?? 0)) return;
		this.rows.update((rows) => rows.map((each) => (each.name === chat ? { ...each, readAt } : each)));
		await this._connection.request("markRead", { chat, readAt });
	}

	dispose(): void {
		this.rows.dispose();
		this.arrived.dispose();
	}
}

export const ChatsServiceId = createServiceId<ChatsService>("ChatsService");
