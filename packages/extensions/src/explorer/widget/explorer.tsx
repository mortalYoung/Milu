import { type Host, type IconKind, type SlotProps, tildifyPath } from "@milu/window/api";
import { ensureLanguages, getHighlighter, highlightLines, resolveLanguage } from "@milu/window/api/markdown";
import { Copy, MessageSquareQuote, PanelLeft, PanelLeftClose, PanelLeftOpen, Pilcrow, WrapText, X } from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { IExplorerTreeService } from "../service/tree.ts";
import type { ExplorerEntry, ExplorerFile, ExplorerSource, OpenFile } from "../types.ts";

const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const MAX_LINES = 3000;
const LIST_WIDTH = 232;
const LIST_MIN = 140;
const READER_MIN = 260;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const extensionOf = (name: string): string => {
	const at = name.lastIndexOf(".");
	return at <= 0 ? "" : name.slice(at + 1).toLowerCase();
};

const isMarkdown = (path: string): boolean => MARKDOWN.has(extensionOf(path));

const relativeOf = (root: string, path: string): string => (root !== "" && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

const unescapeHtml = (text: string): string => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

function imageSourcesOf(html: string): string[] {
	const sources = new Set<string>();
	for (const match of html.matchAll(/data-md-src="([^"]*)"/g)) {
		const src = unescapeHtml(match[1] ?? "");
		if (src !== "") sources.add(src);
	}
	return [...sources].slice(0, 24);
}

function FileIcon(props: { host: Host; name: string; kind: IconKind; open?: boolean }) {
	const { host } = props;
	useStore(host.icons.store, (state) => state.id);
	const svg = host.icons.resolve(props.name, props.kind, props.open === true);
	return <span className="file-icon" dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface ListControls {
	readonly shown: boolean;
	readonly toggle: () => void;
}

function ListToggle(props: { shown: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="explorer-btn explorer-list-toggle"
			aria-expanded={props.shown}
			aria-label={props.shown ? "Collapse the list" : "Show the list"}
			title={props.shown ? "Collapse the list" : "Show the list"}
			onClick={props.onToggle}
		>
			{props.shown ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
		</button>
	);
}

interface RowMenu {
	readonly entry: ExplorerEntry;
	readonly x: number;
	readonly y: number;
}

function useRoots(host: Host): { readonly workspace: string | null; readonly storage: string } {
	const selected = useStore(host.selection.store, (state) => state.selected);
	const workspace = useStore(host.sessions.store, (state) => state.rows.find((each) => each.name === selected)?.workspace ?? null);
	const storage = useStore(host.sessions.store, (state) => state.rows.find((each) => each.name === selected)?.storage ?? "");
	return { workspace, storage };
}

const SOURCES: readonly { readonly source: ExplorerSource; readonly label: string }[] = [
	{ source: "workspace", label: "Workspace" },
	{ source: "storage", label: "Storage" },
];

export function ExplorerHead(props: SlotProps) {
	const { host } = props;
	const roots = useRoots(host);
	const active = useStore(host.dock.store, (current) => current.active);
	const tree = host.get(IExplorerTreeService);
	const state = useStore(tree.store);
	const [menu, setMenu] = useState<{ readonly right: number; readonly top: number } | null>(null);
	const sheet = useRef<HTMLDivElement>(null);

	const root = state.dirs[""];
	const count = root?.entries?.length ?? 0;
	const rootName = state.root === "" ? "workspace" : (state.root.split("/").filter(Boolean).pop() ?? state.root);
	const switchable = roots.workspace !== null;

	useEffect(() => {
		if (menu === null) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".explorer-title") !== null) return;
			if (target instanceof Node && sheet.current?.contains(target) === true) return;
			setMenu(null);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenu(null);
		};
		window.addEventListener("pointerdown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [menu]);

	if (active !== "explorer") return null;

	return (
		<>
			{switchable ? (
				<button
					type="button"
					className={`explorer-title${menu === null ? "" : " open"}`}
					aria-label={`Choose the tree root — currently ${rootName}`}
					aria-haspopup="menu"
					aria-expanded={menu !== null}
					title="Choose the tree root"
					onClick={(event) => {
						const box = event.currentTarget.getBoundingClientRect();
						const bar = event.currentTarget.closest(".dock-bar")?.getBoundingClientRect();
						setMenu(menu === null ? { right: Math.round(window.innerWidth - box.right), top: Math.round((bar?.bottom ?? box.bottom) + 6) } : null);
					}}
				>
					{rootName} · {count}
					<span className="explorer-title-caret" aria-hidden="true">
						▾
					</span>
				</button>
			) : (
				<span className="dock-bar-title">
					{rootName} · {count}
				</span>
			)}
			{state.reading === null ? null : (
				<span className="dock-bar-status">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
					Loading…
				</span>
			)}
			{menu === null ? null : (
				<div className="explorer-menu explorer-source-menu" ref={sheet} role="menu" style={{ right: menu.right, top: menu.top }}>
					{SOURCES.map((each) => {
						const current = state.source === each.source;
						const path = each.source === "workspace" ? tildifyPath(roots.workspace ?? "") : roots.storage;
						return (
							<button
								key={each.source}
								type="button"
								role="menuitemradio"
								aria-checked={current}
								className={`explorer-menu-item${current ? " on" : ""}`}
								title={path}
								onClick={() => {
									setMenu(null);
									void tree.setSource(each.source);
								}}
							>
								<span className="explorer-menu-tick">{current ? "✓" : ""}</span>
								<span className="explorer-menu-text">
									<span className="explorer-menu-title">{each.label}</span>
									{path === "" ? null : <span className="explorer-menu-path">{path}</span>}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</>
	);
}

export function ExplorerPane(props: SlotProps) {
	const { host } = props;
	const tree = host.get(IExplorerTreeService);
	const state = useStore(tree.store);
	const dockWidth = useStore(host.columns.store, (current) => current.columns.dock.width);
	const session = useStore(host.selection.store, (current) => current.selected);
	const rows = useRef<HTMLDivElement>(null);
	const peek = useRef<HTMLDivElement>(null);
	const origin = useRef<{ x: number; width: number } | null>(null);
	const [menu, setMenu] = useState<RowMenu | null>(null);
	const [peeking, setPeeking] = useState(false);

	const detailOpen = state.activeFile !== null;
	const listShown = !detailOpen || state.listOpen;
	const listMax = Math.max(LIST_MIN, dockWidth - READER_MIN);
	const listWidth = clamp(state.listWidth, LIST_MIN, listMax);
	const root = state.dirs[""];
	const rootName = state.root === "" ? "workspace" : (state.root.split("/").filter(Boolean).pop() ?? state.root);
	const active = state.opened.find((file) => file.path === state.activeFile) ?? null;
	const list: ListControls = {
		shown: listShown,
		toggle: () => {
			if (listShown) tree.setList(false);
			else setPeeking((open) => !open);
		},
	};

	useEffect(() => {
		const element = rows.current;
		if (element !== null) element.scrollTop = tree.scrollTop;
	}, [tree, listShown, peeking, state.dirs, state.expanded]);

	useEffect(() => {
		const target = state.focus;
		if (target === null) return;
		const row = rows.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(target.path)}"]`);
		row?.scrollIntoView({ block: "center" });
	}, [state.focus]);

	useEffect(() => {
		if (menu === null) return;
		const close = () => setMenu(null);
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [menu]);

	useEffect(() => {
		if (!peeking) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && peek.current?.contains(target) === true) return;
			if (target instanceof Element && target.closest(".explorer-list-toggle") !== null) return;
			setPeeking(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPeeking(false);
		};
		window.addEventListener("pointerdown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [peeking]);

	useEffect(() => () => document.body.classList.remove("explorer-resizing"), []);

	const open = (entry: ExplorerEntry): void => {
		tree.openFile(entry.path, entry.name);
		setPeeking(false);
	};

	const copy = (text: string): void => {
		void navigator.clipboard?.writeText(text);
	};

	const pin = (path: string): void => {
		host.dock.select("explorer");
		void tree.focusDir(path);
	};

	const resize = (width: number): void => {
		tree.setListWidth(clamp(width, LIST_MIN, listMax));
	};

	const onSplitDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		origin.current = { x: event.clientX, width: listWidth };
		document.body.classList.add("explorer-resizing");
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onSplitMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const start = origin.current;
		if (start !== null) resize(start.width + event.clientX - start.x);
	};

	const onSplitUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (origin.current === null) return;
		origin.current = null;
		document.body.classList.remove("explorer-resizing");
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	const onSplitKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (step === 0) return;
		event.preventDefault();
		resize(listWidth + step);
	};

	const node = (entry: ExplorerEntry, depth: number): ReactNode => {
		const directory = entry.kind === "directory";
		const isOpen = directory && state.expanded.has(entry.path);
		const dir = state.dirs[entry.path];
		const row = (
			<button
				type="button"
				className={`explorer-row${isOpen ? " sticky" : ""}${entry.path === state.activeFile ? " selected" : ""}${entry.ignored === true ? " ignored" : ""}`}
				data-path={entry.path}
				style={{ paddingLeft: 10 + depth * 16, "--depth": String(depth) } as CSSProperties}
				title={entry.path}
				onClick={() => (directory ? tree.toggle(entry.path) : open(entry))}
				onContextMenu={(event) => {
					event.preventDefault();
					setMenu({ entry, x: event.clientX, y: event.clientY });
				}}
			>
				<FileIcon host={host} name={entry.name} kind={directory ? "directory" : "file"} open={isOpen} />
				<span className="explorer-name">{entry.name}</span>
			</button>
		);
		if (!directory) return <Fragment key={entry.path}>{row}</Fragment>;
		return (
			<div className="explorer-node" key={entry.path}>
				{row}
				{!isOpen ? null : dir === undefined || dir.status === "loading" ? (
					<p className="explorer-note" style={{ paddingLeft: 26 + depth * 16 }}>
						…
					</p>
				) : dir.status === "error" ? (
					<p className="explorer-note" style={{ paddingLeft: 26 + depth * 16 }}>
						{dir.error ?? "failed to load"}
					</p>
				) : (
					<div className="explorer-children">{(dir.entries ?? []).map((child) => node(child, depth + 1))}</div>
				)}
			</div>
		);
	};

	if (session === "") return <p className="explorer-note">no chat selected</p>;

	const treeBody = (
		<div className="explorer-tree" ref={rows} onScroll={(event) => tree.rememberScroll(event.currentTarget.scrollTop)}>
			{root === undefined || root.status === "loading" ? (
				<p className="explorer-note">reading the tree…</p>
			) : root.status === "error" ? (
				<p className="explorer-note">{root.error ?? "failed to load"}</p>
			) : (
				(root.entries ?? []).map((entry) => node(entry, 0))
			)}
		</div>
	);

	return (
		<div className={`explorer-dock${detailOpen && listShown ? " split" : ""}`}>
			{listShown ? (
				<div className="explorer-list" style={detailOpen ? { width: listWidth } : undefined}>
					{treeBody}
				</div>
			) : null}

			{detailOpen && listShown ? (
				<div
					className="explorer-split"
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize the file tree"
					aria-valuemin={LIST_MIN}
					aria-valuemax={Math.round(listMax)}
					aria-valuenow={Math.round(listWidth)}
					tabIndex={0}
					onDoubleClick={() => resize(LIST_WIDTH)}
					onPointerDown={onSplitDown}
					onPointerMove={onSplitMove}
					onPointerUp={onSplitUp}
					onPointerCancel={onSplitUp}
					onKeyDown={onSplitKey}
				/>
			) : null}

			{detailOpen && active !== null ? <FileReader host={host} file={active} list={list} root={state.root} onPin={pin} /> : null}

			{!listShown && peeking ? (
				<div className="explorer-peek" ref={peek}>
					<div className="explorer-peek-head">
						<span className="dock-bar-title">
							{rootName} · {root?.entries?.length ?? 0}
						</span>
						<button
							type="button"
							className="explorer-btn"
							aria-label="Dock the list"
							title="Dock the list"
							onClick={() => {
								setPeeking(false);
								tree.setList(true);
							}}
						>
							<PanelLeft size={12} />
						</button>
					</div>
					{treeBody}
				</div>
			) : null}

			{menu === null ? null : (
				<div className="explorer-menu" style={{ left: menu.x, top: menu.y }}>
					<button
						type="button"
						className="explorer-menu-item"
						onClick={() => {
							setMenu(null);
							void host.actions.invoke("explorer.reveal", session, { path: menu.entry.path }).catch(() => undefined);
						}}
					>
						Reveal in Finder
					</button>
					<button
						type="button"
						className="explorer-menu-item"
						onClick={() => {
							const entry = menu.entry;
							setMenu(null);
							if (entry.kind === "directory") tree.toggle(entry.path);
							else open(entry);
						}}
					>
						Open
					</button>
					<div className="explorer-menu-sep" />
					<button
						type="button"
						className="explorer-menu-item"
						onClick={() => {
							setMenu(null);
							copy(menu.entry.name);
						}}
					>
						Copy Name
					</button>
					<button
						type="button"
						className="explorer-menu-item"
						onClick={() => {
							setMenu(null);
							copy(menu.entry.path);
						}}
					>
						Copy Path
					</button>
					<button
						type="button"
						className="explorer-menu-item"
						onClick={() => {
							setMenu(null);
							copy(relativeOf(state.root, menu.entry.path));
						}}
					>
						Copy Relative Path
					</button>
					{menu.entry.kind === "directory" ? (
						<>
							<div className="explorer-menu-sep" />
							<button
								type="button"
								className="explorer-menu-item"
								onClick={() => {
									setMenu(null);
									tree.collapseAll();
								}}
							>
								Collapse All
							</button>
						</>
					) : null}
				</div>
			)}
		</div>
	);
}

function FileReader(props: { host: Host; file: OpenFile; list: ListControls; root: string; onPin: (path: string) => void }) {
	const { host, file } = props;
	const tree = host.get(IExplorerTreeService);
	const state = useStore(tree.store);
	const session = useStore(host.selection.store, (current) => current.selected);
	const draft = useStore(host.transcript.store, (current) => current.drafts[session] ?? "");
	const revision = useStore(host.files.store, (current) => current.changed[file.path] ?? 0);
	const [loaded, setLoaded] = useState<{ path: string; file: ExplorerFile } | null>(null);
	const [failed, setFailed] = useState<{ path: string; message: string } | null>(null);
	const [full, setFull] = useState<{ path: string; html: string } | null>(null);
	const [markup, setMarkup] = useState<{ path: string; render: boolean } | null>(null);
	const [wrapped, setWrapped] = useState(false);
	const [range, setRange] = useState<{ path: string; start: number; end: number } | null>(null);
	const [painted, setPainted] = useState<{ path: string; lines: readonly string[] } | null>(null);
	const body = useRef<HTMLDivElement>(null);
	const strip = useRef<HTMLDivElement>(null);

	const data = loaded !== null && loaded.path === file.path ? loaded.file : null;
	const error = failed !== null && failed.path === file.path ? failed.message : "";
	const target = state.line !== null && state.line.path === file.path ? state.line : null;
	const chosen = markup !== null && markup.path === file.path ? markup.render : null;
	const render = data !== null && isMarkdown(file.path) && (chosen ?? target === null);
	const html = full !== null && full.path === file.path ? full.html : "";
	const language = resolveLanguage(extensionOf(file.path));
	const paintedLines = painted !== null && painted.path === file.path ? painted.lines : null;

	useEffect(() => {
		if (file.path === "" || session === "") return;
		void host.actions.invoke("explorer.watch", session, { path: file.path }).catch(() => undefined);
		return () => {
			host.files.clear(file.path);
			void host.actions.invoke("explorer.unwatch", session, { path: file.path }).catch(() => undefined);
		};
	}, [host, session, file.path]);

	useEffect(() => {
		if (file.path === "" || session === "") return;
		let alive = true;
		tree
			.read(file.path)
			.then((next) => {
				if (alive && next) setLoaded({ path: file.path, file: next });
			})
			.catch((reason: unknown) => {
				if (alive) setFailed({ path: file.path, message: reason instanceof Error ? reason.message : String(reason) });
			});
		return () => {
			alive = false;
		};
	}, [tree, session, file.path, revision]);

	useEffect(() => {
		if (!render || data === null) return;
		let alive = true;
		const path = data.path;
		const source = state.source;
		void (async () => {
			const rendered = await host.markdown.renderFull(data.text);
			if (!alive) return;
			setFull({ path, html: rendered });

			const sources = imageSourcesOf(rendered);
			if (sources.length === 0 || session === "") return;
			const images = new Map<string, string>();
			const resolved = await Promise.all(
				sources.map(async (src) => {
					try {
						const loaded = await host.actions.request<{ dataUrl?: string }>("explorer.image", session, { source, from: path, path: src });
						return [src, loaded?.dataUrl] as const;
					} catch {
						return [src, undefined] as const;
					}
				}),
			);
			for (const [src, dataUrl] of resolved) if (dataUrl !== undefined) images.set(src, dataUrl);
			if (!alive || images.size === 0) return;
			const withImages = await host.markdown.renderFull(data.text, { images });
			if (alive) setFull({ path, html: withImages });
		})();
		return () => {
			alive = false;
		};
	}, [host, render, data, session, state.source]);

	useEffect(() => {
		if (data === null || render || language === null) return;
		let alive = true;
		const code = data.text.replace(/\n$/, "").split("\n").slice(0, MAX_LINES).join("\n");
		void ensureLanguages([language])
			.then(() => getHighlighter())
			.then((core) => {
				const lines = highlightLines(core, code, language);
				if (alive && lines.length > 0) setPainted({ path: data.path, lines });
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [data, render, language]);

	useEffect(() => {
		strip.current?.querySelector<HTMLElement>(".explorer-tab.on")?.scrollIntoView({ inline: "nearest", block: "nearest" });
	}, [state.activeFile]);

	const located = useRef(0);

	useEffect(() => {
		if (target === null || data === null || render || located.current === target.seq) return;
		const row = body.current?.querySelector<HTMLElement>(`[data-line="${Math.max(0, target.line - 1)}"]`);
		if (!row) return;
		located.current = target.seq;
		row.scrollIntoView({ block: "center" });
		row.classList.add("is-located");
		const timer = window.setTimeout(() => row.classList.remove("is-located"), 1400);
		return () => {
			window.clearTimeout(timer);
			row.classList.remove("is-located");
		};
	}, [target, data, render]);

	const relative = relativeOf(props.root, file.path);
	const segments = relative.split("/").filter(Boolean);
	const dirs = segments.slice(0, -1);
	const current = range !== null && range.path === file.path ? range : null;
	const label = current === null ? "" : current.start === current.end ? `${current.start + 1}` : `${current.start + 1}–${current.end + 1}`;

	const track = (): void => {
		const selection = window.getSelection();
		if (selection === null || selection.isCollapsed || body.current === null) {
			setRange(null);
			return;
		}
		const lineOf = (node: Node | null): number | null => {
			const element = node === null ? null : node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
			const row = element?.closest<HTMLElement>("[data-line]");
			const value = Number(row?.dataset["line"]);
			return Number.isFinite(value) ? value : null;
		};
		const start = lineOf(selection.anchorNode);
		const end = lineOf(selection.focusNode);
		if (start === null || end === null) {
			setRange(null);
			return;
		}
		setRange({ path: file.path, start: Math.min(start, end), end: Math.max(start, end) });
	};

	const lines = data === null || data.text === "" ? [] : data.text.replace(/\n$/, "").split("\n");
	const shown = lines.slice(0, MAX_LINES);

	return (
		<div className="explorer-reader">
			<div className="explorer-reader-head">
				<ListToggle shown={props.list.shown} onToggle={props.list.toggle} />
				<div className="explorer-tabs" ref={strip}>
					{state.opened.map((tab) => (
						<div className={`explorer-tab${tab.path === file.path ? " on" : ""}`} key={tab.path}>
							<button type="button" className="explorer-tab-main" onClick={() => tree.activateFile(tab.path)} title={tab.path}>
								<FileIcon host={host} name={tab.name} kind="file" />
								<span className="explorer-tab-name">{tab.name}</span>
							</button>
							<button type="button" className="explorer-tab-close" aria-label={`Close ${tab.name}`} onClick={() => tree.closeFile(tab.path)}>
								<X size={11} />
							</button>
						</div>
					))}
				</div>
				<div className="explorer-reader-actions">
					{current === null ? null : (
						<>
							<button type="button" className="explorer-tag" title={`Copy ${relative}#${label}`} onClick={() => void navigator.clipboard?.writeText(`${relative}#${label}`)}>
								<Copy size={10} /> {label}
							</button>
							<button
								type="button"
								className="explorer-btn"
								title="Quote in the composer"
								onClick={() => {
									const reference = `${relative}#${label}`;
									host.transcript.setDraft(session, draft === "" ? `${reference} ` : `${draft} ${reference} `);
								}}
							>
								<MessageSquareQuote size={11} />
							</button>
						</>
					)}
					{data !== null && isMarkdown(file.path) ? (
						<button
							type="button"
							className={`explorer-btn${render ? " on" : ""}`}
							aria-pressed={render}
							title={render ? "Show raw markdown" : "Show rendered markdown"}
							onClick={() => setMarkup({ path: file.path, render: !render })}
						>
							<Pilcrow size={11} />
						</button>
					) : null}
					<button
						type="button"
						className={`explorer-btn${wrapped ? " on" : ""}`}
						aria-pressed={wrapped}
						title={wrapped ? "Stop wrapping long lines" : "Wrap long lines"}
						onClick={() => setWrapped(!wrapped)}
					>
						<WrapText size={11} />
					</button>
				</div>
			</div>

			<div className="explorer-dir-row">
				<nav className="explorer-dir" aria-label="File path">
					{dirs.map((segment, index) => (
						<button
							type="button"
							key={dirs.slice(0, index + 1).join("/")}
							className="explorer-dir-seg"
							onClick={() => props.onPin(`${props.root}/${dirs.slice(0, index + 1).join("/")}`)}
						>
							{segment}/
						</button>
					))}
					<span className="explorer-dir-file">{segments[segments.length - 1] ?? file.name}</span>
				</nav>
			</div>

			{error !== "" ? (
				<p className="explorer-note">{error}</p>
			) : data === null ? (
				<p className="explorer-note">…</p>
			) : data.binary ? (
				<p className="explorer-note">binary file · preview unavailable</p>
			) : render ? (
				<div className="explorer-body md" ref={body} dangerouslySetInnerHTML={{ __html: html === "" ? host.markdown.render(data.text) : html }} />
			) : (
				<div className={`explorer-body${wrapped ? " wrap" : ""}`} ref={body} onMouseUp={track} onKeyUp={track}>
					{shown.map((line, index) => (
						<div className="explorer-line" key={index} data-line={index}>
							<span className="explorer-ln">{index + 1}</span>
							{paintedLines === null ? (
								<span className="explorer-code">{line === "" ? " " : line}</span>
							) : (
								<span className="explorer-code" dangerouslySetInnerHTML={{ __html: paintedLines[index] ?? "" }} />
							)}
						</div>
					))}
					{data.truncated ? (
						<p className="explorer-note">truncated · file larger than the preview limit</p>
					) : lines.length > MAX_LINES ? (
						<p className="explorer-note">showing the first {MAX_LINES} lines</p>
					) : null}
				</div>
			)}
		</div>
	);
}
