import { createServiceId, type Service } from "@milu/di";
import type { SessionRow, SeqEntry } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import type { SessionListService } from "./sessions.ts";
import { Store } from "./store.ts";

export interface TranscriptState {
	/** The session on screen; empty until the first row arrives. */
	readonly selected: string;
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly running: Readonly<Record<string, boolean>>;
	readonly errors: Readonly<Record<string, string>>;
	readonly drafts: Readonly<Record<string, string>>;
}

const EMPTY: TranscriptState = { selected: "", logs: {}, running: {}, errors: {}, drafts: {} };
const NO_ENTRIES: readonly SeqEntry[] = [];

/** What each session is doing and what has been said in it — one entry per session, never merged. */
export class TranscriptService implements Service {
	readonly state = new Store<TranscriptState>(EMPTY);
	readonly linked = new Store(false);

	private readonly _loaded = new Set<string>();

	constructor(
		private readonly _connection: Connection,
		private readonly _sessions: SessionListService,
	) {}

	selected(): string {
		return this.state.get().selected;
	}

	entries(session: string): readonly SeqEntry[] {
		return this.state.get().logs[session] ?? NO_ENTRIES;
	}

	/** Live status wins; the row's own flag covers sessions this client never saw run. */
	running(session: string): boolean {
		return this.state.get().running[session] ?? this._sessions.get(session)?.running ?? false;
	}

	error(session: string): string {
		return this.state.get().errors[session] ?? "";
	}

	draft(session: string): string {
		return this.state.get().drafts[session] ?? "";
	}

	/** Switch sessions: mark the old one read, load the new one once. Never blocks on a run. */
	async select(session: string): Promise<void> {
		this.state.update((current) => ({ ...current, selected: session }));

		const row = this._sessions.get(session);
		const at = row?.lastMessageAt ?? 0;
		if (at > (row?.readAt ?? 0)) await this._sessions.markRead(session, at);

		if (this._loaded.has(session)) return;
		this._loaded.add(session);
		try {
			await this._connection.load(session);
		} catch (error) {
			this.setError(session, error instanceof Error ? error.message : String(error));
		}
	}

	async send(text: string): Promise<void> {
		const session = this.selected();
		const body = text.trim();
		if (!session || !body) return;
		this.setDraft(session, "");
		this.clearError(session);
		try {
			await this._connection.request("prompt", { session, text: body });
		} catch (error) {
			this.setError(session, error instanceof Error ? error.message : String(error));
		}
	}

	append(session: string, entry: SeqEntry): void {
		this.state.update((current) => {
			const existing = current.logs[session] ?? NO_ENTRIES;
			if (existing.some((seen) => seen.seq === entry.seq)) return current;
			return { ...current, logs: { ...current.logs, [session]: [...existing, entry] } };
		});
	}

	setStatus(session: string, running: boolean, error?: string): void {
		this.state.update((current) => ({
			...current,
			running: { ...current.running, [session]: running },
			...(error ? { errors: { ...current.errors, [session]: error } } : {}),
		}));
	}

	setDraft(session: string, draft: string): void {
		this.state.update((current) => ({ ...current, drafts: { ...current.drafts, [session]: draft } }));
	}

	/** A dropped link forgets nothing but the loaded set: the transcript is replayed on reconnect. */
	setLinked(up: boolean): void {
		this.linked.set(up);
		if (!up) this._loaded.clear();
	}

	/** Picks the first session when nothing is selected — the boot choice until restore exists. */
	async chooseFirst(rows: readonly SessionRow[]): Promise<void> {
		if (this.selected()) return;
		const first = rows[0];
		if (first) await this.select(first.name);
	}

	dispose(): void {
		this.state.dispose();
		this.linked.dispose();
	}

	private setError(session: string, message: string): void {
		this.state.update((current) => ({ ...current, errors: { ...current.errors, [session]: message } }));
	}

	private clearError(session: string): void {
		this.state.update((current) => {
			if (!(session in current.errors)) return current;
			const errors = { ...current.errors };
			delete errors[session];
			return { ...current, errors };
		});
	}
}

export const TranscriptServiceId = createServiceId<TranscriptService>("TranscriptService");
