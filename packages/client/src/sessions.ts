import { createServiceId, type Service } from "@milu/di";
import type { ChatRow, SeqEntry } from "@milu/protocol";

import type { ChatsService } from "./chats.ts";
import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export interface SessionsState {
	/** The chat on screen; empty until the first row arrives. */
	readonly selected: string;
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly running: Readonly<Record<string, boolean>>;
	readonly errors: Readonly<Record<string, string>>;
	readonly drafts: Readonly<Record<string, string>>;
}

const EMPTY: SessionsState = { selected: "", logs: {}, running: {}, errors: {}, drafts: {} };
const NO_ENTRIES: readonly SeqEntry[] = [];

/** What each chat is doing and what has been said in it — one entry per chat, never a merged log. */
export class SessionsService implements Service {
	readonly state = new Store<SessionsState>(EMPTY);
	readonly linked = new Store(false);

	private readonly _loaded = new Set<string>();

	constructor(
		private readonly _connection: Connection,
		private readonly _chats: ChatsService,
	) {}

	selected(): string {
		return this.state.get().selected;
	}

	entries(chat: string): readonly SeqEntry[] {
		return this.state.get().logs[chat] ?? NO_ENTRIES;
	}

	/** Live status wins; the row's own flag covers chats this client never saw run. */
	running(chat: string): boolean {
		return this.state.get().running[chat] ?? this._chats.get(chat)?.writing ?? false;
	}

	error(chat: string): string {
		return this.state.get().errors[chat] ?? "";
	}

	draft(chat: string): string {
		return this.state.get().drafts[chat] ?? "";
	}

	/** Switch chats: mark the old one read, load the new one once. Never blocks on a run. */
	async select(chat: string): Promise<void> {
		this.state.update((current) => ({ ...current, selected: chat }));

		const row = this._chats.get(chat);
		const at = row?.lastMessageAt ?? 0;
		if (at > (row?.readAt ?? 0)) await this._chats.markRead(chat, at);

		if (this._loaded.has(chat)) return;
		this._loaded.add(chat);
		try {
			await this._connection.load(chat);
		} catch (error) {
			this.setError(chat, error instanceof Error ? error.message : String(error));
		}
	}

	async send(text: string): Promise<void> {
		const chat = this.selected();
		const body = text.trim();
		if (!chat || !body) return;
		this.setDraft(chat, "");
		this.clearError(chat);
		try {
			await this._connection.request("prompt", { chat, text: body });
		} catch (error) {
			this.setError(chat, error instanceof Error ? error.message : String(error));
		}
	}

	append(chat: string, entry: SeqEntry): void {
		this.state.update((current) => {
			const existing = current.logs[chat] ?? NO_ENTRIES;
			if (existing.some((seen) => seen.seq === entry.seq)) return current;
			return { ...current, logs: { ...current.logs, [chat]: [...existing, entry] } };
		});
	}

	setStatus(chat: string, running: boolean, error?: string): void {
		this.state.update((current) => ({
			...current,
			running: { ...current.running, [chat]: running },
			...(error ? { errors: { ...current.errors, [chat]: error } } : {}),
		}));
	}

	setDraft(chat: string, draft: string): void {
		this.state.update((current) => ({ ...current, drafts: { ...current.drafts, [chat]: draft } }));
	}

	/** A dropped link forgets nothing but the loaded set: the transcript is replayed on reconnect. */
	setLinked(up: boolean): void {
		this.linked.set(up);
		if (!up) this._loaded.clear();
	}

	/** Picks the first chat when nothing is selected — the boot choice until `last-session` is read. */
	async chooseFirst(rows: readonly ChatRow[]): Promise<void> {
		if (this.selected()) return;
		const first = rows[0];
		if (first) await this.select(first.name);
	}

	dispose(): void {
		this.state.dispose();
		this.linked.dispose();
	}

	private setError(chat: string, message: string): void {
		this.state.update((current) => ({ ...current, errors: { ...current.errors, [chat]: message } }));
	}

	private clearError(chat: string): void {
		this.state.update((current) => {
			if (!(chat in current.errors)) return current;
			const errors = { ...current.errors };
			delete errors[chat];
			return { ...current, errors };
		});
	}
}

export const SessionsServiceId = createServiceId<SessionsService>("SessionsService");
