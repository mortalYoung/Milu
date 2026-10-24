import { createServiceId } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";
import type { Connection, SelectionService, Service } from "@milu/window/api";
import { createStore } from "zustand/vanilla";

const PAGE = 20;

export type TrajectoryMode = "origin" | "slice" | "view";

export interface SliceItemView {
	readonly id: string;
	readonly message: unknown;
}

interface TrajectoryState {
	readonly open: boolean;
	readonly mode: TrajectoryMode;
	readonly entries: readonly SeqEntry[];
	readonly sliceItems: readonly SliceItemView[];
	readonly total: number;
	readonly hasMore: boolean;
	readonly loading: boolean;
	readonly error: string;
}

const EMPTY: TrajectoryState = { open: false, mode: "origin", entries: [], sliceItems: [], total: 0, hasMore: false, loading: false, error: "" };

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class TrajectoryService implements Service {
	readonly store = createStore<TrajectoryState>()(() => EMPTY);

	private readonly _connection: Connection;
	private readonly _selection: SelectionService;
	private readonly _disposables: { dispose(): void }[] = [];
	private _sliceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(connection: Connection, selection: SelectionService) {
		this._connection = connection;
		this._selection = selection;
		this._disposables.push({
			dispose: selection.store.subscribe(() => {
				if (!this.store.getState().open) return;
				this.store.setState(() => EMPTY, true);
			}),
		});
		this._disposables.push(
			connection.onEntry(({ session, entry }) => {
				const state = this.store.getState();
				if (!state.open || session !== this._selection.store.getState().selected) return;
				const last = state.entries[state.entries.length - 1];
				if (last && entry.seq <= last.seq) return;
				this.store.setState((current) => ({ ...current, entries: [...current.entries, entry], total: current.total + 1 }), true);
				if (state.mode === "slice") this._scheduleSlice();
			}),
		);
	}

	async toggle(): Promise<void> {
		if (this.store.getState().open) {
			this.store.setState((state) => ({ ...state, open: false }), true);
			return;
		}
		await this.open();
	}

	async open(): Promise<void> {
		const session = this._selection.store.getState().selected;
		if (!session) return;
		this.store.setState(() => ({ ...EMPTY, open: true, loading: true }), true);
		await this._read(session, {});
	}

	close(): void {
		if (!this.store.getState().open) return;
		this.store.setState(() => EMPTY, true);
	}

	setMode(mode: TrajectoryMode): void {
		const next = this.store.getState().mode === mode ? "origin" : mode;
		this.store.setState((state) => ({ ...state, mode: next }), true);
		if (next === "slice") void this._readSlice();
	}

	async loadOlder(): Promise<void> {
		const state = this.store.getState();
		const session = this._selection.store.getState().selected;
		const cursor = state.entries[0]?.entry.id;
		if (!session || !cursor || !state.hasMore || state.loading) return;
		this.store.setState((current) => ({ ...current, loading: true }), true);
		await this._read(session, { mode: "older", cursor });
	}

	dispose(): void {
		clearTimeout(this._sliceTimer);
		for (const disposable of this._disposables.splice(0)) disposable.dispose();
	}

	private _scheduleSlice(): void {
		clearTimeout(this._sliceTimer);
		this._sliceTimer = setTimeout(() => void this._readSlice(), 400);
	}

	private async _readSlice(): Promise<void> {
		const session = this._selection.store.getState().selected;
		if (!session) return;
		try {
			const slice = await this._connection.request("slice", { session });
			this.store.setState((current) => ({ ...current, sliceItems: slice.items }), true);
		} catch (error) {
			this.store.setState((current) => ({ ...current, error: reason(error) }), true);
		}
	}

	private async _read(session: string, options: { mode?: "older" | "newer"; cursor?: string }): Promise<void> {
		try {
			const page = await this._connection.request("origin", { session, conversations: PAGE, ...options });
			this.store.setState(
				(current) => ({
					...current,
					loading: false,
					total: page.total,
					hasMore: page.hasMore,
					entries: options.mode === "older" ? merge(page.entries, current.entries) : page.entries,
					error: "",
				}),
				true,
			);
		} catch (error) {
			this.store.setState((current) => ({ ...current, loading: false, error: reason(error) }), true);
		}
	}
}

function merge(older: readonly SeqEntry[], current: readonly SeqEntry[]): SeqEntry[] {
	const known = new Set(current.map((entry) => entry.seq));
	return [...older.filter((entry) => !known.has(entry.seq)), ...current];
}

export const ITrajectoryService = createServiceId<TrajectoryService>("trajectory.state");
