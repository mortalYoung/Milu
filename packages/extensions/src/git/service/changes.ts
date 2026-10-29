import { createServiceId, type Service } from "@milu/di";
import { type Connection, IConnection, ISelectionService, type SelectionService } from "@milu/window/api";
import { createStore } from "zustand/vanilla";

import type { GitChange, GitChanges } from "../types.ts";

const LIST_KEY = "milu.git.list";
const WIDTH_KEY = "milu.git.width";
const SPLIT_KEY = "milu.git.split";
const WRAP_KEY = "milu.git.wrap";
const LIST_WIDTH = 232;
const LIST_MIN = 140;

export interface GitViewState {
	readonly session: string;
	readonly status: "idle" | "loading" | "ready" | "error";
	readonly error: string;
	readonly repoRoot: string;
	readonly changes: readonly GitChange[];
	readonly selected: string | null;
	/** Bumped on every read, so an open diff re-reads its two sides. */
	readonly revision: number;
	readonly listOpen: boolean;
	readonly listWidth: number;
	readonly sideBySide: boolean;
	readonly wrap: boolean;
}

/** A change is identified by its path and the side of the index it lives on. */
export const keyOf = (change: GitChange): string => `${change.staged ? "i" : "w"}${change.path}`;

const stored = (key: string, fallback: boolean): boolean => {
	const value = localStorage.getItem(key);
	return value === null ? fallback : value === "1";
};

const storedWidth = (): number => {
	const storedValue = Number(localStorage.getItem(WIDTH_KEY));
	return Number.isFinite(storedValue) && storedValue >= LIST_MIN ? storedValue : LIST_WIDTH;
};

const EMPTY: GitViewState = {
	session: "",
	status: "idle",
	error: "",
	repoRoot: "",
	changes: [],
	selected: null,
	revision: 0,
	listOpen: stored(LIST_KEY, true),
	listWidth: storedWidth(),
	sideBySide: stored(SPLIT_KEY, true),
	wrap: stored(WRAP_KEY, true),
};

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One owner for the workspace's changes: the dock bar counts them, the pane lists them. */
export class GitChangesService implements Service {
	readonly store = createStore<GitViewState>()(() => EMPTY);

	private _stop: (() => void) | null = null;

	constructor(
		@IConnection private readonly _connection: Connection,
		@ISelectionService private readonly _selection: SelectionService,
	) {}

	initialize(): void {
		this._stop = this._selection.store.subscribe(() => {
			this._reset();
			void this.refresh();
		});
		void this.refresh();
	}

	dispose(): void {
		this._stop?.();
		this._stop = null;
		this.store.setState({ ...EMPTY }, true);
	}

	async ensure(): Promise<void> {
		if (this.store.getState().status === "idle") await this.refresh();
	}

	async refresh(): Promise<void> {
		const session = this._session();
		if (session === "") return;
		if (this.store.getState().status === "loading") return;
		this._patch((state) => ({ ...state, status: "loading" }));
		try {
			const result = await this._connection.request("invoke", { action: "git.changes", session });
			if (!result.ok) throw new Error(result.error ?? "git changes failed");
			const data = result.data as GitChanges | undefined;
			this._patch((state) => {
				const changes = data?.changes ?? [];
				const selected = state.selected === null ? null : changes.find((change) => keyOf(change) === state.selected) === undefined ? null : state.selected;
				return {
					...state,
					status: "ready",
					error: "",
					repoRoot: data?.repoRoot ?? "",
					changes,
					selected,
					revision: state.revision + 1,
				};
			});
		} catch (error) {
			this._patch((state) => ({ ...state, status: "error", error: reason(error), repoRoot: "", changes: [], selected: null, revision: state.revision + 1 }));
		}
	}

	change(): GitChange | null {
		const state = this.store.getState();
		return state.changes.find((change) => keyOf(change) === state.selected) ?? null;
	}

	select(key: string | null): void {
		this._patch((state) => ({ ...state, selected: key === state.selected ? null : key }));
	}

	setList(open: boolean): void {
		localStorage.setItem(LIST_KEY, open ? "1" : "0");
		this._patch((state) => ({ ...state, listOpen: open }));
	}

	setListWidth(width: number): void {
		localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
		this._patch((state) => ({ ...state, listWidth: width }));
	}

	setSideBySide(sideBySide: boolean): void {
		localStorage.setItem(SPLIT_KEY, sideBySide ? "1" : "0");
		this._patch((state) => ({ ...state, sideBySide }));
	}

	setWrap(wrap: boolean): void {
		localStorage.setItem(WRAP_KEY, wrap ? "1" : "0");
		this._patch((state) => ({ ...state, wrap }));
	}

	private _patch(change: (state: GitViewState) => GitViewState): void {
		const session = this._session();
		this.store.setState(
			(state) =>
				change(state.session === session ? state : { ...EMPTY, session, listOpen: state.listOpen, listWidth: state.listWidth, sideBySide: state.sideBySide, wrap: state.wrap }),
			true,
		);
	}

	private _reset(): void {
		const previous = this.store.getState();
		this.store.setState(
			{
				...EMPTY,
				session: this._session(),
				listOpen: previous.listOpen,
				listWidth: previous.listWidth,
				sideBySide: previous.sideBySide,
				wrap: previous.wrap,
			},
			true,
		);
	}

	private _session(): string {
		return this._selection.store.getState().selected;
	}
}

export const IGitChangesService = createServiceId<GitChangesService>("git.changes");
