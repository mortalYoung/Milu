import { createServiceId, type Service } from "@milu/di";
import { type Connection, IConnection, ISelectionService, type SelectionService } from "@milu/window/api";
import { createStore } from "zustand/vanilla";

import type { ExplorerEntry, ExplorerListing, OpenFile } from "../types.ts";

export interface DirState {
	readonly status: "loading" | "ready" | "error";
	readonly entries?: readonly ExplorerEntry[];
	readonly error?: string;
}

export interface ExplorerTree {
	readonly session: string;
	readonly root: string;
	readonly dirs: Readonly<Record<string, DirState>>;
	readonly expanded: ReadonlySet<string>;
	readonly focus: { readonly path: string; readonly seq: number } | null;
	readonly opened: readonly OpenFile[];
	readonly activeFile: string | null;
	readonly listOpen: boolean;
}

const LIST_KEY = "milu.explorer.list";

const listOpen = (): boolean => localStorage.getItem(LIST_KEY) !== "0";

const EMPTY: ExplorerTree = { session: "", root: "", dirs: {}, expanded: new Set(), focus: null, opened: [], activeFile: null, listOpen: listOpen() };

async function call<T>(connection: Connection, action: string, session: string, args?: unknown): Promise<T | undefined> {
	const result = await connection.request("invoke", { action, session, ...(args === undefined ? {} : { args }) });
	if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);
	return result.data as T | undefined;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One owner for the workspace tree: the pane draws it, a file tab asks it to reveal a directory. */
export class ExplorerTreeService implements Service {
	readonly store = createStore<ExplorerTree>()(() => EMPTY);

	private readonly _tokens = new Map<string, number>();
	private _seq = 0;
	private _stop: (() => void) | null = null;

	constructor(
		@IConnection private readonly _connection: Connection,
		@ISelectionService private readonly _selection: SelectionService,
	) {}

	initialize(): void {
		this._stop = this._selection.store.subscribe(() => {
			this._reset();
			void this.ensureRoot();
		});
		void this.ensureRoot();
	}

	dispose(): void {
		this._stop?.();
		this._stop = null;
		this._tokens.clear();
		this.store.setState({ ...EMPTY }, true);
	}

	async ensureRoot(): Promise<void> {
		if (this._session() === "" || this.store.getState().dirs[""] !== undefined) return;
		await this.load("");
	}

	async load(path: string): Promise<void> {
		const session = this._session();
		if (session === "") return;
		const token = (this._tokens.get(path) ?? 0) + 1;
		this._tokens.set(path, token);
		this._patch((tree) => ({ ...tree, dirs: { ...tree.dirs, [path]: { status: "loading" } } }));
		try {
			const listing = await call<ExplorerListing>(this._connection, "explorer.list", session, path === "" ? undefined : { path });
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

	/** The neighbour takes over, like editors do. */
	closeFile(path: string): void {
		this._patch((tree) => {
			const index = tree.opened.findIndex((file) => file.path === path);
			if (index < 0) return tree;
			const opened = tree.opened.filter((file) => file.path !== path);
			const activeFile = tree.activeFile === path ? (opened[index]?.path ?? opened[index - 1]?.path ?? null) : tree.activeFile;
			return { ...tree, opened, activeFile };
		});
	}

	toggleList(): void {
		const next = !this.store.getState().listOpen;
		localStorage.setItem(LIST_KEY, next ? "1" : "0");
		this._patch((tree) => ({ ...tree, listOpen: next }));
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

	/** Expand every segment up to `path`, load what is missing, and ask the pane to scroll there. */
	async focusDir(path: string): Promise<void> {
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
		this.store.setState((state) => change(state.session === session ? state : { ...EMPTY, session }), true);
	}

	private _reset(): void {
		this._tokens.clear();
		this.store.setState({ ...EMPTY, session: this._session(), listOpen: listOpen() }, true);
	}

	private _session(): string {
		return this._selection.store.getState().selected;
	}
}

export const IExplorerTreeService = createServiceId<ExplorerTreeService>("explorer.tree");
