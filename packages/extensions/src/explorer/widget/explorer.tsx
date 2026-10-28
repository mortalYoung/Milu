import type { Host, SlotProps } from "@milu/window/api";
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
	Pilcrow,
	WrapText,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
const PANE_MIN = 520;
const LIST_PANE = 232;

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
	readonly open: boolean;
	readonly fits: boolean;
	readonly toggle: () => void;
}

function ListToggle(props: { open: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="explorer-btn"
			aria-expanded={props.open}
			aria-label={props.open ? "Collapse the list" : "Show the list"}
			title={props.open ? "Collapse the list" : "Show the list"}
			onClick={props.onToggle}
		>
			{props.open ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
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
	const mode = useStore(host.columns.store, (current) => current.columns.dock.mode);
	const dockWidth = useStore(host.columns.store, (current) => current.columns.dock.width);

	const root = state.dirs[""];
	const rootName = state.root === "" ? "workspace" : (state.root.split("/").filter(Boolean).pop() ?? state.root);
	const fits = mode === "overlay" || dockWidth >= PANE_MIN;
	const detailOpen = state.activeFile !== null;

	return (
		<>
			<span className="dock-bar-title">
				{rootName} · {root?.entries?.length ?? 0}
			</span>
			{detailOpen && fits ? <ListToggle open={state.listOpen} onToggle={() => tree.toggleList()} /> : null}
		</>
	);
}

export function ExplorerPane(props: SlotProps) {
	const { host } = props;
	const tree = host.get(IExplorerTreeService);
	const state = useStore(tree.store);
	const mode = useStore(host.columns.store, (current) => current.columns.dock.mode);
	const dockWidth = useStore(host.columns.store, (current) => current.columns.dock.width);
	const session = useStore(host.selection.store, (current) => current.selected);
	const rows = useRef<HTMLDivElement>(null);
	const [menu, setMenu] = useState<RowMenu | null>(null);

	const floating = mode === "overlay";
	const fits = floating || dockWidth >= PANE_MIN;
	const detailOpen = state.activeFile !== null;
	const faceList = !detailOpen || (floating ? state.listOpen : state.listOpen && fits);
	const collapsed = detailOpen && !faceList;
	const both = detailOpen && faceList;
	const list: ListControls = { open: state.listOpen, fits, toggle: () => tree.toggleList() };
	const active = state.opened.find((file) => file.path === state.activeFile) ?? null;

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

	const open = (entry: ExplorerEntry): void => {
		tree.openFile(entry.path, entry.name);
		if (floating && state.listOpen) tree.toggleList();
	};

	const copy = (text: string): void => {
		void navigator.clipboard?.writeText(text);
	};

	const pin = (path: string): void => {
		host.dock.select("explorer");
		void tree.focusDir(path);
	};

	const node = (entry: ExplorerEntry, depth: number): ReactNode[] => {
		const directory = entry.kind === "directory";
		const isOpen = directory && state.expanded.has(entry.path);
		const dir = state.dirs[entry.path];
		const row = (
			<button
				key={entry.path}
				type="button"
				className={`explorer-row${entry.path === state.activeFile ? " selected" : ""}${entry.ignored === true ? " ignored" : ""}`}
				data-path={entry.path}
				style={{ paddingLeft: 10 + depth * 16 }}
				title={entry.path}
				onClick={() => (directory ? tree.toggle(entry.path) : open(entry))}
				onContextMenu={(event) => {
					event.preventDefault();
					setMenu({ entry, x: event.clientX, y: event.clientY });
				}}
			>
				{directory ? <ChevronRight size={11} className={`explorer-chevron${isOpen ? " open" : ""}`} /> : <span className="explorer-chevron-space" />}
				{directory ? isOpen ? <FolderOpen size={13} className="explorer-row-icon" /> : <Folder size={13} className="explorer-row-icon" /> : <Glyph name={entry.name} />}
				<span className="explorer-name">{entry.name}</span>
			</button>
		);
		if (!isOpen) return [row];
		if (dir === undefined || dir.status === "loading")
			return [
				row,
				<div key={`${entry.path}:loading`} className="explorer-note" style={{ paddingLeft: 26 + depth * 16 }}>
					…
				</div>,
			];
		if (dir.status === "error")
			return [
				row,
				<div key={`${entry.path}:error`} className="explorer-note" style={{ paddingLeft: 26 + depth * 16 }}>
					{dir.error ?? "failed to load"}
				</div>,
			];
		return [row, ...(dir.entries ?? []).flatMap((child) => node(child, depth + 1))];
	};

	const root = state.dirs[""];

	return (
		<div className={`explorer-dock${floating ? " floating" : ""}`}>
			<div className={`explorer-list${collapsed ? " collapsed" : ""}`} style={both ? { width: LIST_PANE } : undefined} inert={collapsed}>
				<div className="explorer-tree" ref={rows}>
					{root === undefined || root.status === "loading" ? (
						<p className="explorer-note">loading workspace…</p>
					) : root.status === "error" ? (
						<p className="explorer-note">{root.error ?? "failed to load"}</p>
					) : (
						(root.entries ?? []).flatMap((entry) => node(entry, 0))
					)}
				</div>
			</div>

			{detailOpen && active !== null && (!floating || !state.listOpen) ? <FileReader host={host} file={active} list={list} root={state.root} onPin={pin} /> : null}

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
	const body = useRef<HTMLDivElement>(null);
	const strip = useRef<HTMLDivElement>(null);

	const data = loaded !== null && loaded.path === file.path ? loaded.file : null;
	const error = failed !== null && failed.path === file.path ? failed.message : "";
	const render = data !== null && isMarkdown(file.path) && (markup === null || markup.path !== file.path || markup.render);
	const html = full !== null && full.path === file.path ? full.html : "";

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
		host.actions
			.request<ExplorerFile>("explorer.read", session, { path: file.path })
			.then((next) => {
				if (alive && next) setLoaded({ path: file.path, file: next });
			})
			.catch((reason: unknown) => {
				if (alive) setFailed({ path: file.path, message: reason instanceof Error ? reason.message : String(reason) });
			});
		return () => {
			alive = false;
		};
	}, [host, session, file.path, revision]);

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
				{props.list.open ? null : props.list.fits ? <ListToggle open={false} onToggle={props.list.toggle} /> : null}
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
							<span className="explorer-code">{line === "" ? " " : line}</span>
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
