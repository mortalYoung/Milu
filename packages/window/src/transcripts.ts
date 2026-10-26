import { createServiceId, type Service } from "@milu/di";
import type { PartialMessage, SeqEntry } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import { type Connection, IConnection } from "./connection.ts";

export interface TranscriptState {
	readonly logs: Readonly<Record<string, readonly SeqEntry[]>>;
	readonly hasMore: Readonly<Record<string, boolean>>;
	readonly loadingOlder: Readonly<Record<string, boolean>>;
	readonly drafts: Readonly<Record<string, string>>;
	readonly errors: Readonly<Record<string, string>>;
	readonly loading: Readonly<Record<string, boolean>>;
	readonly focused: { readonly id: string; readonly at: number } | null;
	readonly partials: Readonly<Record<string, PartialMessage>>;
	readonly started: Readonly<Record<string, number>>;
	readonly stopping: Readonly<Record<string, boolean>>;
}

const EMPTY: TranscriptState = { logs: {}, hasMore: {}, loadingOlder: {}, drafts: {}, errors: {}, loading: {}, focused: null, partials: {}, started: {}, stopping: {} };
const NO_ENTRIES: readonly SeqEntry[] = [];

function without<T>(record: Readonly<Record<string, T>>, names: readonly string[]): Record<string, T> {
	const next = { ...record };
	for (const name of names) delete next[name];
	return next;
}

export class TranscriptService implements Service {
	readonly store = createStore<TranscriptState>()(() => EMPTY);

	private readonly _loaded = new Set<string>();
	private _generations: Readonly<Record<string, number>> = {};

	constructor(@IConnection private readonly _connection: Connection) {}

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

	retain(rows: readonly { readonly name: string; readonly createdAt: number }[]): readonly string[] {
		const live = new Map(rows.map((row) => [row.name, row.createdAt] as const));
		const dropped: string[] = [];
		const replaced: string[] = [];
		for (const [name, generation] of Object.entries(this._generations)) {
			if (live.get(name) === generation) continue;
			dropped.push(name);
			if (live.has(name)) replaced.push(name);
		}
		this._generations = Object.fromEntries(live);
		if (dropped.length === 0) return dropped;
		for (const name of dropped) this._loaded.delete(name);
		this.store.setState(
			(current) => ({
				...current,
				logs: without(current.logs, dropped),
				hasMore: without(current.hasMore, dropped),
				loadingOlder: without(current.loadingOlder, dropped),
				errors: without(current.errors, dropped),
				partials: without(current.partials, dropped),
				stopping: without(current.stopping, dropped),
				drafts: without(current.drafts, replaced),
			}),
			true,
		);
		return dropped;
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

	async abort(session: string): Promise<void> {
		if (session === "" || this.store.getState().stopping[session] === true) return;
		this.setStopping(session, true);
		try {
			const result = await this._connection.request("abort", {});
			if (!result.aborted) this.setStopping(session, false);
		} catch (error) {
			this.setStopping(session, false);
			this.fail(session, error instanceof Error ? error.message : String(error));
		}
	}

	setStopping(session: string, stopping: boolean): void {
		this.store.setState((current) => {
			if ((current.stopping[session] === true) === stopping) return current;
			const next = { ...current.stopping };
			if (stopping) next[session] = true;
			else delete next[session];
			return { ...current, stopping: next };
		}, true);
	}

	markRunning(session: string, running: boolean): void {
		this.store.setState((current) => {
			if (!running) {
				if (!(session in current.started)) return current;
				const started = { ...current.started };
				delete started[session];
				return { ...current, started };
			}
			if (session in current.started) return current;
			return { ...current, started: { ...current.started, [session]: Date.now() } };
		}, true);
	}

	partial(session: string): PartialMessage | undefined {
		return this.store.getState().partials[session];
	}

	setPartial(session: string, message: PartialMessage): void {
		this.store.setState(
			(current) => ({
				...current,
				partials: { ...current.partials, [session]: message },
				started: session in current.started ? current.started : { ...current.started, [session]: Date.now() },
			}),
			true,
		);
	}

	clearPartial(session: string): void {
		this.store.setState((current) => {
			if (!(session in current.partials)) return current;
			const partials = { ...current.partials };
			delete partials[session];
			return { ...current, partials };
		}, true);
	}

	append(session: string, entry: SeqEntry): void {
		if (entry.entry.type === "message") this.clearPartial(session);
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

	dispose(): void {
		this.store.setState({ ...EMPTY }, true);
	}

	private clearError(session: string): void {
		this.store.setState((current) => {
			if (!(session in current.errors)) return current;
			const errors = { ...current.errors };
			delete errors[session];
			return { ...current, errors };
		}, true);
	}
}

export const ITranscriptService = createServiceId<TranscriptService>("TranscriptService");
