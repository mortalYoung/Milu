import { createServiceId, type Service } from "@milu/di";
import type { SessionRow, SeqEntry } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import type { SessionListService } from "./sessions.ts";
import { Store } from "./store.ts";

export interface TranscriptState {
	readonly selected: string;
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly hasMore: Readonly<Record<string, boolean>>;
	readonly loadingOlder: Readonly<Record<string, boolean>>;
	readonly running: Readonly<Record<string, boolean>>;
	readonly errors: Readonly<Record<string, string>>;
	readonly drafts: Readonly<Record<string, string>>;
}

const EMPTY: TranscriptState = { selected: "", logs: {}, hasMore: {}, loadingOlder: {}, running: {}, errors: {}, drafts: {} };
const NO_ENTRIES: readonly SeqEntry[] = [];

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

	running(session: string): boolean {
		return this.state.get().running[session] ?? this._sessions.get(session)?.running ?? false;
	}

	error(session: string): string {
		return this.state.get().errors[session] ?? "";
	}

	draft(session: string): string {
		return this.state.get().drafts[session] ?? "";
	}

	async select(session: string): Promise<void> {
		this.state.update((current) => ({ ...current, selected: session }));

		const row = this._sessions.get(session);
		const at = row?.lastMessageAt ?? 0;
		if (at > (row?.readAt ?? 0)) await this._sessions.markRead(session, at);

		if (this._loaded.has(session)) return;
		this._loaded.add(session);
		try {
			const window = await this._connection.load(session);
			this.state.update((current) => ({
				...current,
				logs: { ...current.logs, [session]: window.entries },
				hasMore: { ...current.hasMore, [session]: window.hasMore },
			}));
		} catch (error) {
			this.setError(session, error instanceof Error ? error.message : String(error));
		}
	}

	async loadOlder(session: string): Promise<void> {
		const current = this.state.get();
		if (!current.hasMore[session] || current.loadingOlder[session]) return;
		const oldest = current.logs[session]?.[0]?.entry.id;
		if (!oldest) return;
		this.state.update((state) => ({ ...state, loadingOlder: { ...state.loadingOlder, [session]: true } }));
		try {
			const window = await this._connection.load(session, { mode: "older", cursor: oldest });
			this.state.update((state) => {
				const existing = state.logs[session] ?? NO_ENTRIES;
				const known = new Set(existing.map((entry) => entry.seq));
				const prepended = window.entries.filter((entry) => !known.has(entry.seq));
				return {
					...state,
					logs: { ...state.logs, [session]: window.reset ? window.entries : [...prepended, ...existing] },
					hasMore: { ...state.hasMore, [session]: window.hasMore },
				};
			});
		} catch (error) {
			this.setError(session, error instanceof Error ? error.message : String(error));
		} finally {
			this.state.update((state) => ({ ...state, loadingOlder: { ...state.loadingOlder, [session]: false } }));
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

	async abort(): Promise<void> {
		const session = this.selected();
		if (!session) return;
		await this._connection.request("abort", { session });
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

	setLinked(up: boolean): void {
		this.linked.set(up);
		if (!up) this._loaded.clear();
	}

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
