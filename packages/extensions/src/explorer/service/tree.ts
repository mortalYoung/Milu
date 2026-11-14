import { createServiceId, type Service } from "@milu/di";
import { type Connection, IConnection, ISelectionService, ISessionListService, type SelectionService, type SessionListService } from "@milu/window/api";
import { createStore } from "zustand/vanilla";

import type { ExplorerEntry, ExplorerFile, ExplorerListing, ExplorerSource, OpenFile } from "../types.ts";

export interface DirState {
	readonly status: "loading" | "ready" | "error";
	readonly entries?: readonly ExplorerEntry[];
	readonly error?: string;
}

export interface ExplorerTree {
	readonly session: string;
	readonly source: ExplorerSource;
	readonly root: string;
	readonly dirs: Readonly<Record<string, DirState>>;
	readonly expanded: ReadonlySet<string>;
	readonly focus: { readonly path: string; readonly seq: number } | null;
	readonly line: { readonly path: string; readonly line: number; readonly seq: number } | null;
	readonly opened: readonly OpenFile[];
	readonly activeFile: string | null;
	readonly listOpen: boolean;
	readonly listWidth: number;
	readonly reading: string | null;
}

const SOURCE_KEY = "milu.explorer.source";
const LIST_KEY = "milu.explorer.list";
const WIDTH_KEY = "milu.explorer.width";
const LIST_WIDTH = 232;
const LIST_MIN = 140;

const listOpen = (): boolean => localStorage.getItem(LIST_KEY) !== "0";

const storedSource = (hasWorkspace: boolean): ExplorerSource => (hasWorkspace && localStorage.getItem(SOURCE_KEY) !== "storage" ? "workspace" : "storage");

const listWidth = (): number => {
	const stored = Number(localStorage.getItem(WIDTH_KEY));
	return Number.isFinite(stored) && stored >= LIST_MIN ? stored : LIST_WIDTH;
};

const EMPTY: ExplorerTree = {
	session: "",
	source: "workspace",
	root: "",
	dirs: {},
	expanded: new Set(),
	focus: null,
	line: null,
	opened: [],
	activeFile: null,
	listOpen: listOpen(),
	listWidth: listWidth(),
	reading: null,
};

async function call<T>(connection: Connection, action: string, session: string, args?: unknown): Promise<T | undefined> {
	const result = await connection.request("invoke", { action, session, ...(args === undefined ? {} : { args }) });
	if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);
	return result.data as T | undefined;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class ExplorerTreeService implements Service {
	readonly store = createStore<ExplorerTree>()(() => EMPTY);

	private readonly _tokens = new Map<string, number>();
	private _scrollTop = 0;
	private _seq = 0;
	private _stop: (() => void) | null = null;
	private _rowsStop: (() => void) | null = null;

	constructor(
		@IConnection private readonly _connection: Connection,
		@ISelectionService private readonly _selection: SelectionService,
		@ISessionListService private readonly _sessions: SessionListService,
	) {}

	initialize(): void {
		this._stop = this._selection.store.subscribe(() => {
			this._reset();
			void this.ensureRoot();
		});
		this._rowsStop = this._sessions.store.subscribe((state, previous) => {
			const session = this._session();
			if (session === "") return;
			const current = state.rows.find((row) => row.name === session)?.workspace ?? null;
			const before = previous.rows.find((row) => row.name === session)?.workspace ?? null;
			if (current === before) return;
			this._reset();
			void this.ensureRoot();
		});
		void this.ensureRoot();
	}

	dispose(): void {
		this._stop?.();
		this._stop = null;
		this._rowsStop?.();
		this._rowsStop = null;
		this._tokens.clear();
		this.store.setState({ ...EMPTY }, true);
	}

	async ensureRoot(): Promise<void> {
		if (this._session() === "" || this.store.getState().dirs[""] !== undefined) return;
		await this.load("");
	}

	async setSource(source: ExplorerSource): Promise<void> {
		localStorage.setItem(SOURCE_KEY, source === "storage" ? "storage" : "workspace");
		if (this.store.getState().source === source) return;
		this._reset();
		await this.ensureRoot();
	}

	async load(path: string): Promise<void> {
		const session = this._session();
		if (session === "") return;
		const token = (this._tokens.get(path) ?? 0) + 1;
		this._tokens.set(path, token);
		this._patch((tree) => ({ ...tree, dirs: { ...tree.dirs, [path]: { status: "loading" } } }));
		try {
			const listing = await call<ExplorerListing>(this._connection, "explorer.list", session, {
				source: this.store.getState().source,
				...(path === "" ? {} : { path }),
			});
			if (this._tokens.get(path) !== token) return;
			this._patch((tree) => ({
				...tree,
				root: tree.root === "" ? (listing?.root ?? path) : tree.root,
				dirs: { ...tree.dirs, [path]: { status: "ready", entries: listing?.entries ?? [] } },
			}));
		} catch (error) {
			if (this._tokens.get(path) !== token) return;
			this._patch((tree) => ({ ...tree, dirs: { ...tree.dirs, [path]: { status: "error", error: reason(error) } } }));
		}
	}

	openFile(path: string, name: string): void {
		this._patch((tree) => ({
			...tree,
			opened: tree.opened.some((file) => file.path === path) ? tree.opened : [...tree.opened, { path, name }],
			activeFile: path,
		}));
	}

	activateFile(path: string): void {
		this._patch((tree) => ({ ...tree, activeFile: path }));
	}

	closeFile(path: string): void {
		this._patch((tree) => {
			const index = tree.opened.findIndex((file) => file.path === path);
			if (index < 0) return tree;
			const opened = tree.opened.filter((file) => file.path !== path);
			const activeFile = tree.activeFile === path ? (opened[index]?.path ?? opened[index - 1]?.path ?? null) : tree.activeFile;
			return { ...tree, opened, activeFile };
		});
	}

	setList(open: boolean): void {
		localStorage.setItem(LIST_KEY, open ? "1" : "0");
		this._patch((tree) => ({ ...tree, listOpen: open }));
	}

	get scrollTop(): number {
		return this._scrollTop;
	}

	rememberScroll(top: number): void {
		this._scrollTop = top;
	}

	async read(path: string): Promise<ExplorerFile | undefined> {
		const session = this._session();
		if (session === "") return undefined;
		this._patch((tree) => ({ ...tree, reading: path }));
		try {
			return await call<ExplorerFile>(this._connection, "explorer.read", session, { source: this.store.getState().source, path });
		} finally {
			this._patch((tree) => ({ ...tree, reading: tree.reading === path ? null : tree.reading }));
		}
	}

	setListWidth(width: number): void {
		localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
		this._patch((tree) => ({ ...tree, listWidth: width }));
	}

	toggle(path: string): void {
		const tree = this.store.getState();
		const expanded = new Set(tree.expanded);
		if (expanded.has(path)) expanded.delete(path);
		else expanded.add(path);
		this._patch((current) => ({ ...current, expanded }));
		if (!expanded.has(path)) return;
		const dir = tree.dirs[path];
		if (dir === undefined || dir.status === "error") void this.load(path);
	}

	collapseAll(): void {
		this._patch((tree) => ({ ...tree, expanded: new Set() }));
	}

	revealLine(path: string, line: number): void {
		this._seq += 1;
		this._patch((tree) => ({ ...tree, line: { path, line, seq: this._seq } }));
	}

	async focusDir(path: string): Promise<void> {
		if (this.store.getState().source === "storage" && this._hasWorkspace()) await this.setSource("workspace");
		const tree = this.store.getState();
		const relative = tree.root !== "" && path.startsWith(`${tree.root}/`) ? path.slice(tree.root.length + 1) : path;
		const expanded = new Set(tree.expanded);
		const chain: string[] = [""];
		let current = tree.root;
		for (const segment of relative.split("/").filter(Boolean)) {
			current = current === "" ? segment : `${current}/${segment}`;
			chain.push(current);
		}
		const missing: string[] = [];
		for (const dir of chain) {
			expanded.add(dir);
			const state = this.store.getState().dirs[dir];
			if (state === undefined || state.status === "error") missing.push(dir);
		}
		this._patch((tree) => ({ ...tree, expanded }));
		await Promise.all(missing.map((dir) => this.load(dir)));
		this._seq += 1;
		this._patch((tree) => ({ ...tree, focus: { path, seq: this._seq } }));
	}

	private _patch(change: (tree: ExplorerTree) => ExplorerTree): void {
		const session = this._session();
		this.store.setState((state) => change(state.session === session ? state : this._blank(session)), true);
	}

	private _reset(): void {
		this._tokens.clear();
		this._scrollTop = 0;
		this.store.setState(this._blank(this._session()), true);
	}

	private _blank(session: string): ExplorerTree {
		return { ...EMPTY, session, source: storedSource(this._hasWorkspace()), listOpen: listOpen(), listWidth: listWidth() };
	}

	private _hasWorkspace(): boolean {
		const session = this._session();
		return this._sessions.store.getState().rows.find((row) => row.name === session)?.workspace != null;
	}

	private _session(): string {
		return this._selection.store.getState().selected;
	}
}

export const IExplorerTreeService = createServiceId<ExplorerTreeService>("explorer.tree");
