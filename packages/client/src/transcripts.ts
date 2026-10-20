import { createServiceId, type Service } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export interface TranscriptState {
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly hasMore: Readonly<Record<string, boolean>>;
	readonly loadingOlder: Readonly<Record<string, boolean>>;
	readonly drafts: Readonly<Record<string, string>>;
	readonly errors: Readonly<Record<string, string>>;
}

const EMPTY: TranscriptState = { logs: {}, hasMore: {}, loadingOlder: {}, drafts: {}, errors: {} };
const NO_ENTRIES: readonly SeqEntry[] = [];

export class TranscriptService implements Service {
	readonly state = new Store<TranscriptState>(EMPTY);
	readonly linked = new Store(false);
	readonly focused = new Store<{ id: string; at: number } | null>(null);

	private readonly _loaded = new Set<string>();

	constructor(private readonly _connection: Connection) {}

	entries(session: string): readonly SeqEntry[] {
		return this.state.get().logs[session] ?? NO_ENTRIES;
	}

	draft(session: string): string {
		return this.state.get().drafts[session] ?? "";
	}

	async open(session: string): Promise<void> {
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
			this._loaded.delete(session);
			this.fail(session, error instanceof Error ? error.message : String(error));
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
			this.fail(session, error instanceof Error ? error.message : String(error));
		} finally {
			this.state.update((state) => ({ ...state, loadingOlder: { ...state.loadingOlder, [session]: false } }));
		}
	}

	async send(session: string, text: string): Promise<void> {
		const body = text.trim();
		if (!session || !body) return;
		this.setDraft(session, "");
		this.clearError(session);
		try {
			await this._connection.request("prompt", { text: body });
		} catch (error) {
			this.fail(session, error instanceof Error ? error.message : String(error));
		}
	}

	focus(id: string): void {
		this.focused.set({ id, at: Date.now() });
	}

	clearFocus(): void {
		this.focused.set(null);
	}

	async abort(): Promise<void> {
		await this._connection.request("abort", {});
	}

	append(session: string, entry: SeqEntry): void {
		this.state.update((current) => {
			const existing = current.logs[session] ?? NO_ENTRIES;
			if (existing.some((seen) => seen.seq === entry.seq)) return current;
			return { ...current, logs: { ...current.logs, [session]: [...existing, entry] } };
		});
	}

	setDraft(session: string, draft: string): void {
		this.state.update((current) => ({ ...current, drafts: { ...current.drafts, [session]: draft } }));
	}

	setLinked(up: boolean): void {
		this.linked.set(up);
		if (!up) this._loaded.clear();
	}

	dispose(): void {
		this.state.dispose();
		this.linked.dispose();
		this.focused.dispose();
	}

	fail(session: string, message: string): void {
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
