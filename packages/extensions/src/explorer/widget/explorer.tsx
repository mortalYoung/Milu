import type { Host, SlotProps } from "@milu/window/api";
import { ensureLanguages, getHighlighter, highlightLines, resolveLanguage } from "@milu/window/api/markdown";
import { Tip } from "@milu/window/api/tooltip";
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	File,
	FileCode2,
	FileImage,
	FileJson,
	FileText,
	Folder,
	FolderOpen,
	FolderTree,
	MessageSquareQuote,
	PanelLeft,
	Pilcrow,
	WrapText,
	X,
} from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { IExplorerTreeService } from "../service/tree.ts";
import type { ExplorerEntry, ExplorerFile, OpenFile } from "../types.ts";

const CODE = new Set([
	"c",
	"cc",
	"cpp",
	"css",
	"go",
	"h",
	"html",
	"java",
	"js",
	"jsx",
	"kt",
	"mjs",
	"php",
	"py",
	"rb",
	"rs",
	"sh",
	"swift",
	"ts",
	"tsx",
	"yml",
	"yaml",
	"toml",
	"sql",
	"zsh",
]);
const JSONISH = new Set(["json", "jsonc", "lock"]);
const IMAGES = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
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

function Glyph(props: { name: string; className?: string }) {
	const className = props.className ?? "explorer-row-icon";
	const extension = extensionOf(props.name);
	if (MARKDOWN.has(extension)) return <FileText size={13} className={className} />;
	if (JSONISH.has(extension)) return <FileJson size={13} className={className} />;
	if (IMAGES.has(extension)) return <FileImage size={13} className={className} />;
	if (CODE.has(extension)) return <FileCode2 size={13} className={className} />;
	return <File size={13} className={className} />;
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
			{props.shown ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
		</button>
	);
}

interface RowMenu {
	readonly entry: ExplorerEntry;
	readonly x: number;
	readonly y: number;
}

export function ExplorerButton(props: SlotProps) {
	const { host } = props;
	const visible = useStore(host.dock.store, (state) => state.visible);
	const active = useStore(host.dock.store, (state) => state.active);
	const open = visible && active === "explorer";
	return (
		<>
			<span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />
			<Tip label="Explorer (⌘J)">
				<button
					type="button"
					className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-ink transition-colors duration-150 hover:bg-hover ${open ? "bg-hover" : "bg-transparent"}`}
					aria-label="Toggle explorer"
					aria-pressed={open}
					onClick={() => host.dock.toggleView("explorer")}
				>
					<FolderTree size={15} />
				</button>
			</Tip>
		</>
	);
}

export function ExplorerHead(props: SlotProps) {
	const { host } = props;
	const tree = host.get(IExplorerTreeService);
	const state = useStore(tree.store);

	const root = state.dirs[""];
	const rootName = state.root === "" ? "workspace" : (state.root.split("/").filter(Boolean).pop() ?? state.root);

	return (
		<>
			<span className="dock-bar-title">
				{rootName} · {root?.entries?.length ?? 0}
			</span>
			{state.reading === null ? null : (
				<span className="dock-bar-status">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
					Loading…
				</span>
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
				{directory ? isOpen ? <FolderOpen size={13} className="explorer-row-icon" /> : <Folder size={13} className="explorer-row-icon" /> : <Glyph name={entry.name} />}
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

	const treeBody = (
		<div className="explorer-tree" ref={rows} onScroll={(event) => tree.rememberScroll(event.currentTarget.scrollTop)}>
			{root === undefined || root.status === "loading" ? (
				<p className="explorer-note">loading workspace…</p>
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
	const render = data !== null && isMarkdown(file.path) && (markup === null || markup.path !== file.path || markup.render);
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
		void host.markdown.renderFull(data.text).then((rendered) => {
			if (alive) setFull({ path: data.path, html: rendered });
		});
		return () => {
			alive = false;
		};
	}, [host, render, data]);

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
								<Glyph name={tab.name} className="explorer-tab-icon" />
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
