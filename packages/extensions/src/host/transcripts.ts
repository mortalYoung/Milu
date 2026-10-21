import { createServiceId, type Service } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import type { Connection } from "./connection.ts";

export interface TranscriptState {
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly hasMore: Readonly<Record<string, boolean>>;
	readonly loadingOlder: Readonly<Record<string, boolean>>;
	readonly drafts: Readonly<Record<string, string>>;
	readonly errors: Readonly<Record<string, string>>;
	readonly loading: Readonly<Record<string, boolean>>;
	readonly focused: { readonly id: string; readonly at: number } | null;
}

const EMPTY: TranscriptState = { logs: {}, hasMore: {}, loadingOlder: {}, drafts: {}, errors: {}, loading: {}, focused: null };
const NO_ENTRIES: readonly SeqEntry[] = [];

export class TranscriptService implements Service {
	readonly store = createStore<TranscriptState>()(() => EMPTY);

	private readonly _loaded = new Set<string>();

	constructor(private readonly _connection: Connection) {}

	entries(session: string): readonly SeqEntry[] {
		return this.store.getState().logs[session] ?? NO_ENTRIES;
	}

	draft(session: string): string {
		return this.store.getState().drafts[session] ?? "";
	}

	async open(session: string): Promise<void> {
		if (this._loaded.has(session)) return;
		this._loaded.add(session);
		this.store.setState((state) => ({ ...state, loading: { ...state.loading, [session]: true } }), true);
		try {
			const window = await this._connection.load(session);
			this.store.setState(
				(current) => ({
					...current,
					logs: { ...current.logs, [session]: window.entries },
					hasMore: { ...current.hasMore, [session]: window.hasMore },
				}),
				true,
			);
		} catch (error) {
			this._loaded.delete(session);
			this.fail(session, error instanceof Error ? error.message : String(error));
		} finally {
			this.store.setState((state) => ({ ...state, loading: { ...state.loading, [session]: false } }), true);
		}
	}

	async reload(session: string): Promise<void> {
		this._loaded.delete(session);
		await this.open(session);
	}

	async loadOlder(session: string): Promise<void> {
		const current = this.store.getState();
		if (!current.hasMore[session] || current.loadingOlder[session]) return;
		const oldest = current.logs[session]?.[0]?.entry.id;
		if (!oldest) return;
		this.store.setState((state) => ({ ...state, loadingOlder: { ...state.loadingOlder, [session]: true } }), true);
		try {
			const window = await this._connection.load(session, { mode: "older", cursor: oldest });
			this.store.setState((state) => {
				const existing = state.logs[session] ?? NO_ENTRIES;
				const known = new Set(existing.map((entry) => entry.seq));
				const prepended = window.entries.filter((entry) => !known.has(entry.seq));
				return {
					...state,
					logs: { ...state.logs, [session]: window.reset ? window.entries : [...prepended, ...existing] },
					hasMore: { ...state.hasMore, [session]: window.hasMore },
				};
			}, true);
		} catch (error) {
			this.fail(session, error instanceof Error ? error.message : String(error));
		} finally {
			this.store.setState((state) => ({ ...state, loadingOlder: { ...state.loadingOlder, [session]: false } }), true);
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
		this.store.setState((state) => ({ ...state, focused: { id, at: Date.now() } }), true);
	}

	clearFocus(): void {
		this.store.setState((state) => ({ ...state, focused: null }), true);
	}

	async abort(): Promise<void> {
		await this._connection.request("abort", {});
	}

	append(session: string, entry: SeqEntry): void {
		this.store.setState((current) => {
			const existing = current.logs[session] ?? NO_ENTRIES;
			if (existing.some((seen) => seen.seq === entry.seq)) return current;
			return { ...current, logs: { ...current.logs, [session]: [...existing, entry] } };
		}, true);
	}

	setDraft(session: string, draft: string): void {
		this.store.setState((current) => ({ ...current, drafts: { ...current.drafts, [session]: draft } }), true);
	}

	setLinked(up: boolean): void {
		if (!up) this._loaded.clear();
	}

	fail(session: string, message: string): void {
		this.store.setState((current) => ({ ...current, errors: { ...current.errors, [session]: message } }), true);
	}

	dispose(): void {}

	private clearError(session: string): void {
		this.store.setState((current) => {
			if (!(session in current.errors)) return current;
			const errors = { ...current.errors };
			delete errors[session];
			return { ...current, errors };
		}, true);
	}
}

export const TranscriptServiceId = createServiceId<TranscriptService>("TranscriptService");
