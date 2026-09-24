import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderSymlink, MessageSquareQuote, Pilcrow, Pin, WrapText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ExplorerEntry } from "../../shared/rpc";
import { useComposer } from "../lib/contexts/composer-context";
import { useSession } from "../lib/contexts/session-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useToast } from "../lib/contexts/toast-context";
import type { RevealRange, RevealTarget } from "../lib/dock";
import { DOCK_PANE_MAX, DOCK_PANE_MIN } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { fileGlyph, linkGlyph } from "../lib/file-icons";
import { languageForPath, paintMarkdown, renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { CodeReader, PreviewBusy } from "./CodeReader";
import { type DockListControls, DockShell } from "./DockShell";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu";

interface DirState {
	status: "loading" | "ready" | "error";
	entries?: ExplorerEntry[];
	error?: string;
}

interface SelectedFile {
	path: string;
	name: string;
	range?: RevealRange;
	raw?: boolean;
}

interface FileData {
	content?: string;
	binary?: boolean;
	truncated?: boolean;
	size?: number;
	error?: string;
	frontmatter?: { end: number; raw: string; data: Record<string, unknown> | null };
}

function explorerGlyph(entry: ExplorerEntry) {
	if (entry.kind === "link") return linkGlyph("explorer-row-icon");
	return fileGlyph(entry.name, "explorer-row-icon");
}

const LANGUAGE_LABELS: Record<string, string> = {
	ts: "TS",
	tsx: "TSX",
	js: "JS",
	jsx: "JSX",
	python: "PY",
	html: "HTML",
	css: "CSS",
	json: "JSON",
	jsonc: "JSONC",
	markdown: "MD",
	yaml: "YAML",
	bash: "SH",
	sql: "SQL",
	toml: "TOML",
	ini: "INI",
	diff: "DIFF",
	xml: "XML",
};

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function contentLines(content: string): string[] {
	if (content === "") return [];
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function fileMetrics(path: string, data: FileData | null | undefined): string {
	if (data?.content == null) return "";
	const lang = languageForPath(path);
	const count = contentLines(data.content).length;
	const label = lang ? (LANGUAGE_LABELS[lang] ?? lang.toUpperCase()) : null;
	return [label, `${count} ${count === 1 ? "line" : "lines"}`, formatBytes(data.size ?? data.content.length)].filter(Boolean).join(" · ");
}

const FRONTMATTER_HEAD = 4;
const FRONTMATTER_LIMIT = 8;
const PROSE_CLAMP_CHARS = 150;

interface FrontmatterLine {
	key: string;
	value: string;
	prose: boolean;
	long: boolean;
}

function scalarText(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value) ?? "—";
}

function frontmatterLines(data: Record<string, unknown>, prefix = ""): FrontmatterLine[] {
	const lines: FrontmatterLine[] = [];
	for (const [key, value] of Object.entries(data)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value)) lines.push(...frontmatterLines(value as Record<string, unknown>, path));
		else {
			const text = Array.isArray(value) ? value.map(scalarText).join(" · ") : scalarText(value);
			const prose = text.includes("\n") || text.length > 72;
			lines.push({ key: path, value: text, prose, long: prose && (text.length > PROSE_CLAMP_CHARS || text.split("\n").length > 2) });
		}
	}
	return lines;
}

type Frontmatter = { end: number; raw: string; data: Record<string, unknown> | null };

function FrontmatterHeader(props: { frontmatter: Frontmatter }) {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);
	const lines = props.frontmatter.data ? frontmatterLines(props.frontmatter.data) : [];
	const collapsible = lines.length > FRONTMATTER_LIMIT;
	const shown = collapsible && !open ? lines.slice(0, FRONTMATTER_HEAD) : lines;
	const rawHtml = props.frontmatter.data ? "" : renderMarkdown(`\`\`\`yaml\n${props.frontmatter.raw}\n\`\`\``);

	return (
		<div className="md-frontmatter">
			<div className="md-frontmatter-head">
				<span className="md-frontmatter-mark">frontmatter</span>
				{props.frontmatter.data && collapsible && (
					<button type="button" className="md-frontmatter-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
						{open ? "show fewer" : `show all ${lines.length} fields`}
					</button>
				)}
				{!props.frontmatter.data && (
					<button type="button" className="md-frontmatter-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
						{open ? "hide" : "not valid YAML — show it"}
					</button>
				)}
			</div>
			{!props.frontmatter.data
				? open && <div className="md" dangerouslySetInnerHTML={{ __html: rawHtml }} />
				: shown.map((line) =>
						line.prose ? (
							<div className="md-frontmatter-prose-row" key={line.key}>
								<span className="md-frontmatter-key">{line.key}</span>
								<p className={"md-frontmatter-prose" + (line.long && expanded !== line.key ? " clamped" : "")}>{line.value}</p>
								{line.long && (
									<button
										type="button"
										className="md-frontmatter-toggle"
										aria-expanded={expanded === line.key}
										onClick={() => setExpanded(expanded === line.key ? null : line.key)}
									>
										{expanded === line.key ? "show less" : "show more"}
									</button>
								)}
							</div>
						) : (
							<div className="md-frontmatter-row" key={line.key}>
								<span className="md-frontmatter-key">{line.key}</span>
								<span className="md-frontmatter-value">{line.value}</span>
							</div>
						),
					)}
		</div>
	);
}

function MarkdownFile(props: { content: string; frontmatter?: Frontmatter; partner?: string | null; path?: string }) {
	const [busy, setBusy] = useState(false);
	const images = useRef(new Map<string, string>());
	const failures = useRef(new Map<string, string>());
	const ref = useRef<HTMLDivElement>(null);
	const body = props.frontmatter ? props.content.slice(props.frontmatter.end) : props.content;

	async function resolveImages(el: HTMLElement) {
		const partner = props.partner;
		const from = props.path;
		if (!partner || !from) return images.current;
		const srcs = [...new Set([...el.querySelectorAll<HTMLElement>("[data-md-src]")].map((node) => node.dataset["mdSrc"] ?? ""))].filter(Boolean).slice(0, 24);
		await Promise.all(
			srcs.map(async (src) => {
				if (images.current.has(src)) return;
				const res = await rpc.request.explorer_read_image({ name: partner, root: "workspace", from, path: src });
				if (res.ok && res.dataUrl) images.current.set(src, res.dataUrl);
				else if (res.error) failures.current.set(src, res.error);
			}),
		);
		return images.current;
	}

	function explainFailures(el: HTMLElement) {
		if (failures.current.size === 0) return;
		for (const node of el.querySelectorAll<HTMLElement>("[data-md-src]")) {
			const reason = failures.current.get(node.dataset["mdSrc"] ?? "");
			if (reason) node.title = reason;
		}
	}

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		setBusy(true);
		const text = body;
		paintMarkdown(el, renderMarkdown(text));
		void (async () => {
			const resolved = await resolveImages(el).catch(() => images.current);
			const html = await renderMarkdownReady(text, undefined, resolved);
			if (!cancelled && el.isConnected) {
				paintMarkdown(el, html);
				explainFailures(el);
			}
		})().finally(() => {
			if (!cancelled) setBusy(false);
		});
		return () => {
			cancelled = true;
		};
	}, [body, props.partner, props.path]);

	return (
		<>
			<div className="explorer-md-scroll">
				{props.frontmatter && <FrontmatterHeader frontmatter={props.frontmatter} />}
				<div ref={ref} className="md explorer-md" />
			</div>
			<PreviewBusy when={busy && props.content !== ""} />
		</>
	);
}

interface ExplorerRowMenu {
	reveal: (entry: ExplorerEntry) => void;
	copyName: (entry: ExplorerEntry) => void;
	copyPath: (entry: ExplorerEntry) => void;
	copyRelative: (entry: ExplorerEntry) => void;
	collapseAll: () => void;
}

function ExplorerNode(props: {
	entry: ExplorerEntry;
	menu: ExplorerRowMenu;
	depth: number;
	dirs: Record<string, DirState>;
	expanded: Set<string>;
	selectedKey: string | null;
	onToggle: (entry: ExplorerEntry) => void;
	onSelect: (entry: ExplorerEntry, opts?: { raw?: boolean }) => void;
}) {
	const key = props.entry.path;
	const isDir = props.entry.kind === "dir" || (props.entry.kind === "link" && props.entry.linkKind === "dir");
	const isOpen = props.expanded.has(key);
	const state = props.dirs[key];
	const selected = props.selectedKey === key;
	const [menuOpen, setMenuOpen] = useState(false);
	const activate = () => (isDir ? props.onToggle(props.entry) : props.onSelect(props.entry));

	return (
		<div className="explorer-node">
			<ContextMenu onOpenChange={setMenuOpen}>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						className={"explorer-row" + (selected ? " selected" : "") + (props.entry.ignored ? " ignored" : "") + (menuOpen ? " menu-open" : "")}
						data-path={props.entry.path}
						style={{ paddingLeft: `${10 + props.depth * 16}px` }}
						title={props.entry.kind === "link" && props.entry.linkTarget ? `${props.entry.name} → ${props.entry.linkTarget}` : undefined}
						onClick={activate}
					>
						{isDir && (isOpen ? <ChevronDown size={11} className="explorer-chevron" /> : <ChevronRight size={11} className="explorer-chevron" />)}
						{isDir ? (
							props.entry.kind === "link" ? (
								<FolderSymlink size={14} className="explorer-row-icon" />
							) : isOpen ? (
								<FolderOpen size={14} className="explorer-row-icon" />
							) : (
								<Folder size={14} className="explorer-row-icon" />
							)
						) : (
							explorerGlyph(props.entry)
						)}
						<span className="explorer-name">{props.entry.name}</span>
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent size="sm">
					<ContextMenuItem size="sm" onSelect={() => props.menu.reveal(props.entry)}>
						Reveal in Finder
					</ContextMenuItem>
					<ContextMenuItem size="sm" onSelect={() => (isDir ? props.onToggle(props.entry) : props.onSelect(props.entry, { raw: false }))}>
						Open
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem size="sm" onSelect={() => props.menu.copyName(props.entry)}>
						Copy Name
					</ContextMenuItem>
					<ContextMenuItem size="sm" onSelect={() => props.menu.copyPath(props.entry)}>
						Copy Path
					</ContextMenuItem>
					<ContextMenuItem size="sm" onSelect={() => props.menu.copyRelative(props.entry)}>
						Copy Relative Path
					</ContextMenuItem>
					{isDir && (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem size="sm" onSelect={() => props.menu.collapseAll()}>
								Collapse All
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
			{isDir && isOpen && (
				<>
					{state?.status !== "ready" ? (
						<div className="explorer-node-note" style={{ paddingLeft: `${24 + props.depth * 16}px` }}>
							{state?.status === "error" ? (state?.error ?? "failed to load") : "…"}
						</div>
					) : (
						(state?.entries ?? []).map((child) => (
							<ExplorerNode
								key={child.path}
								entry={child}
								menu={props.menu}
								depth={props.depth + 1}
								dirs={props.dirs}
								expanded={props.expanded}
								selectedKey={props.selectedKey}
								onToggle={props.onToggle}
								onSelect={props.onSelect}
							/>
						))
					)}
				</>
			)}
		</div>
	);
}

const openFilesStore = createStore<{ files: Record<string, SelectedFile> }>()(() => ({ files: {} }));

export function ExplorerDrawer(props: {
	open: boolean;
	partner: string | null;
	reveal?: RevealTarget | null;
	side?: "left" | "right";
	pinned: boolean;
	onTogglePin: () => void;
	letterWidth: number | null;
	setLetterWidth: (width: number | null) => void;
	commitLetterWidth: () => void;
	paneWidth: number;
	onPaneResize: (px: number) => void;
	onPaneCommit: () => void;
	wrap: boolean;
	onToggleWrap: () => void;
	onClose: () => void;
}) {
	const settingsView = useSettings();
	const toast = useToast();
	const composer = useComposer();
	const session = useSession();
	const openFiles = useStore(openFilesStore, (state) => state.files);
	const settingsSnapshot = useStore(settingsView.store, (state) => state.snapshot);
	const codeLineGap = settingsSnapshot.settings?.explorer?.lineGap ?? 0.2;
	const codeLineHeight = 1 + codeLineGap;

	const [liveRange, setLiveRange] = useState<{ start: number; end: number } | null>(null);
	const [dirs, setDirs] = useState<Record<string, DirState>>({});
	const [dirReal, setDirReal] = useState<Record<string, string>>({});
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [fileData, setFileData] = useState<FileData | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const readKey = useRef<string | null>(null);

	const tokens = useRef(new Map<string, number>());
	const treeEl = useRef<HTMLDivElement>(null);
	const treeScrollTop = useRef(0);
	const scope = useRef<string | null | undefined>(undefined);
	const lastRevealSeq = useRef(0);
	const shownFileRef = useRef<SelectedFile | null>(null);

	const selected = props.partner ? (openFiles[props.partner] ?? null) : null;
	if (selected) shownFileRef.current = selected;
	const shownFile = shownFileRef.current;

	const dirsRef = useRef(dirs);
	dirsRef.current = dirs;
	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;

	function setSelected(next: SelectedFile | null) {
		const partner = props.partner;
		if (!partner) return;
		openFilesStore.setState((state) => {
			if ((state.files[partner] ?? null) === next) return state;
			const copy = { ...state.files };
			if (next) copy[partner] = next;
			else delete copy[partner];
			return { files: copy };
		});
	}

	async function loadDir(path: string) {
		const partner = props.partner;
		if (!partner) return;
		const token = (tokens.current.get(path) ?? 0) + 1;
		tokens.current.set(path, token);
		setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
		const res = await rpc.request.explorer_children({ name: partner, root: "workspace", path });
		if (tokens.current.get(path) !== token) return;
		setDirs((prev) => ({
			...prev,
			[path]: res.ok && res.entries ? { status: "ready", entries: res.entries } : { status: "error", error: res.error ?? "failed to load" },
		}));
		if (res.ok) {
			const realUpdates: Record<string, string> = {};
			if (res.realPath) realUpdates[path] = res.realPath;
			for (const entry of res.entries ?? []) {
				if ((entry.kind === "dir" || (entry.kind === "link" && entry.linkKind === "dir")) && entry.realPath) realUpdates[entry.path] = entry.realPath;
			}
			if (Object.keys(realUpdates).length > 0) setDirReal((prev) => ({ ...prev, ...realUpdates }));
		}
	}

	function reset() {
		tokens.current.clear();
		setDirs({});
		setDirReal({});
		setExpanded(new Set<string>());
		treeScrollTop.current = 0;
	}

	async function expandTo(path: string) {
		const segments = path.split("/").filter(Boolean);
		if (segments.length === 0) return;
		const chain = [""];
		for (let i = 0; i < segments.length - 1; i++) chain.push(segments.slice(0, i + 1).join("/"));
		const next = new Set(expandedRef.current);
		for (const dir of chain) {
			next.add(dir);
			await loadDir(dir);
		}
		setExpanded(next);
	}

	function scrollToRow(path: string) {
		const find = () => [...(treeEl.current?.querySelectorAll<HTMLElement>(".explorer-row[data-path]") ?? [])].find((el) => el.dataset["path"] === path);
		requestAnimationFrame(() => {
			const row = find();
			if (row) {
				row.scrollIntoView({ block: "center" });
				return;
			}
			requestAnimationFrame(() => find()?.scrollIntoView({ block: "center" }));
		});
	}

	async function revealFile(path: string, range?: RevealRange) {
		await expandTo(path);
		const segments = path.split("/").filter(Boolean);
		setSelected({ path, name: segments[segments.length - 1]!, ...(range ? { range, raw: true } : {}) });
		scrollToRow(path);
	}

	useEffect(() => {
		const partner = props.partner;
		if (scope.current === partner) return;
		scope.current = partner;
		reset();
		const remembered = partner ? openFilesStore.getState().files[partner] : undefined;
		if (remembered) void expandTo(remembered.path);
	}, [props.partner]);

	useEffect(() => {
		if (!props.open || !props.partner) return;
		if (!dirsRef.current[""]) void loadDir("");
	}, [props.open, props.partner, dirs]);

	useEffect(() => {
		const target = props.reveal;
		if (!target || !props.open || target.seq === lastRevealSeq.current) return;
		lastRevealSeq.current = target.seq;
		void revealFile(target.path, target.range);
	}, [props.reveal, props.open]);

	useEffect(() => {
		if (!props.open) return;
		requestAnimationFrame(() => {
			if (treeEl.current) treeEl.current.scrollTop = treeScrollTop.current;
		});
	}, [props.open]);

	const [fileRev, setFileRev] = useState(0);
	const shownPathRef = useRef<string | null>(null);
	shownPathRef.current = shownFile?.path ?? null;

	useEffect(() => {
		rpc.addMessageListener("file_changed", ({ path }) => {
			if (path === shownPathRef.current) setFileRev((rev) => rev + 1);
		});
	}, []);

	useEffect(() => {
		if (!props.partner) return;
		void rpc.request.watch_file({ name: props.partner, root: "workspace", path: props.open && shownFile ? shownFile.path : null });
	}, [props.open, props.partner, shownFile]);

	useEffect(() => {
		if (!shownFile || !props.partner) {
			setFileData(null);
			readKey.current = null;
			return;
		}
		let cancelled = false;
		const key = `${props.partner}|${shownFile.path}`;
		if (readKey.current !== key) setFileLoading(true);
		readKey.current = key;
		void rpc.request.explorer_read_file({ name: props.partner, root: "workspace", path: shownFile.path }).then((res) => {
			if (cancelled) return;
			setFileData(res.ok ? res : { error: res.error ?? "failed to read file" });
			setFileLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [shownFile, props.partner, fileRev]);

	useEscapeLayer({
		id: "explorer.detail",
		order: ESCAPE_ORDER.dockDetail,
		isOpen: () => props.open && selected != null,
		close: () => setSelected(null),
	});

	function hasCycleToAncestor(entry: ExplorerEntry): boolean {
		if (!entry.realPath || !entry.path) return false;
		const segments = entry.path.split("/");
		const ancestors = [""];
		let current = "";
		for (let i = 0; i < segments.length - 1; i++) {
			current = current ? `${current}/${segments[i]}` : segments[i]!;
			ancestors.push(current);
		}
		return ancestors.some((ancestor) => dirReal[ancestor] === entry.realPath);
	}

	function toggleDir(entry: ExplorerEntry) {
		const key = entry.path;
		const next = new Set(expanded);
		if (next.has(key)) {
			next.delete(key);
		} else {
			if (hasCycleToAncestor(entry)) return;
			next.add(key);
			const state = dirs[key];
			if (!state || state.status === "error") void loadDir(entry.path);
		}
		setExpanded(next);
	}

	function selectFile(entry: ExplorerEntry, opts?: { raw?: boolean }) {
		const raw = opts?.raw === true;
		if (selected?.path === entry.path && (opts === undefined || raw === (selected.raw === true))) return;
		setSelected({ path: entry.path, name: entry.name, ...(raw ? { raw: true } : {}) });
	}

	function entryAbsPath(path: string) {
		const root = dirReal[""];
		if (!root) return path;
		return root.endsWith("/") ? `${root}${path}` : `${root}/${path}`;
	}

	async function revealRow(path: string) {
		if (!props.partner) return;
		const res = await rpc.request.explorer_reveal({ name: props.partner, path });
		if (!res.ok) toast.push({ title: "Couldn't reveal in Finder", body: res.error ?? "Unknown error" }, "error");
	}

	const rowMenu: ExplorerRowMenu = {
		reveal: (entry) => void revealRow(entry.path),
		copyName: (entry) => void navigator.clipboard?.writeText(entry.name),
		copyPath: (entry) => void navigator.clipboard?.writeText(entryAbsPath(entry.path)),
		copyRelative: (entry) => void navigator.clipboard?.writeText(entry.path),
		collapseAll: () => setExpanded(new Set<string>()),
	};

	const selectedKey = selected?.path ?? null;
	const rootState = dirs[""];
	const dirSegments = (shownFile?.path || shownFile?.name || "").split("/").filter(Boolean).slice(0, -1);
	const metrics = shownFile ? fileMetrics(shownFile.path, fileData) : "";
	const isRaw = shownFile?.raw === true;
	const rawToggle = !!shownFile?.path && languageForPath(shownFile.path) === "markdown";
	const stampLabel = (() => {
		if (!liveRange) return "";
		const start = liveRange.start + 1;
		const end = liveRange.end + 1;
		return start === end ? `${start}` : `${start}–${end}`;
	})();

	function toggleRaw() {
		if (!selected) return;
		setSelected({ ...selected, raw: !(selected.raw === true) });
	}

	function copyLiveRange() {
		if (!selected || !liveRange) return;
		void navigator.clipboard?.writeText(`${selected.path}#${stampLabel}`);
	}

	function quoteInLetter() {
		if (!selected || !liveRange) return;
		const ref = `${selected.path}#${stampLabel}`;
		const draft = composer.store.getState().drafts[session.store.getState().selected ?? ""] ?? "";
		composer.prefill(draft ? `${draft} ${ref} ` : `${ref} `);
	}

	async function focusDir(path: string) {
		if (!props.partner) return;
		const open = expanded;
		const next = new Set(open);
		const missing: string[] = [];
		let current = "";
		for (const segment of path.split("/").filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			next.add(current);
			const state = dirs[current];
			if (!state || state.status === "error") missing.push(current);
		}
		if (next.size !== open.size) setExpanded(next);
		for (const dir of missing) await loadDir(dir);
		scrollToRow(path);
	}

	const foldable = (() => {
		const path = shownFile?.path;
		if (!path) return false;
		const lang = languageForPath(path);
		if (!lang) return false;
		const fold = settingsSnapshot.settings?.explorer?.fold;
		return lang === "markdown" ? fold?.markdown !== false : fold?.braces !== false;
	})();
	const rendered = !!shownFile && shownFile.raw !== true && languageForPath(shownFile.path) === "markdown";

	return (
		<DockShell
			open={props.open}
			panelId="explorer"
			side={props.side ?? "right"}
			pinned={props.pinned}
			onTogglePin={props.onTogglePin}
			letterWidth={props.letterWidth}
			setLetterWidth={props.setLetterWidth}
			commitLetterWidth={props.commitLetterWidth}
			width={props.paneWidth}
			min={DOCK_PANE_MIN}
			max={DOCK_PANE_MAX}
			resizeLabel="Resize the file tree"
			onResize={props.onPaneResize}
			onCommit={props.onPaneCommit}
			title="Explorer"
			onClose={props.onClose}
			detail={{
				open: selected != null,
				render: (leaving: boolean, list: DockListControls) =>
					shownFile ? (
						<div className={"explorer-reader dock-detail" + (leaving ? " leaving" : "")}>
							<div className="explorer-reader-head">
								<button
									type="button"
									className={"dock-btn" + (list.pinned ? " on" : "")}
									aria-pressed={list.pinned}
									disabled={!list.canPin && !list.pinned}
									title={list.pinned ? "Let the file cover the letter again" : "Pin the letter beside the file"}
									onClick={() => list.togglePin()}
								>
									<Pin size={11} />
								</button>
								{list.pinned && (
									<button
										type="button"
										className={"dock-btn" + (list.listOpen ? " on" : "")}
										aria-pressed={list.listOpen}
										title={list.listOpen ? "Hide the file tree" : "Show the file tree"}
										onClick={() => list.openList()}
									>
										☰
									</button>
								)}
								{!list.pinned && (
									<button type="button" className="explorer-back" title="Close this file" onClick={() => setSelected(null)}>
										← {props.partner}
									</button>
								)}
								<span className="explorer-file-name">{shownFile.name}</span>
								<nav className="explorer-dir" aria-label="File path" title={shownFile.path}>
									{dirSegments.map((segment, index) => (
										<button
											type="button"
											className="explorer-dir-seg"
											key={dirSegments.slice(0, index + 1).join("/")}
											onClick={() => {
												if (list.pinned) list.openList();
												void focusDir(dirSegments.slice(0, index + 1).join("/"));
											}}
										>
											{segment}/
										</button>
									))}
								</nav>
								{liveRange && (
									<>
										<button type="button" className="explorer-stamp" title={`Copy ${shownFile.path}#${stampLabel}`} onClick={copyLiveRange}>
											⧉ {stampLabel}
										</button>
										<button
											type="button"
											className="dock-btn"
											title={`Quote ${shownFile.path}#${stampLabel} in the letter`}
											aria-label="Quote in the letter"
											onClick={quoteInLetter}
										>
											<MessageSquareQuote size={11} />
										</button>
									</>
								)}
								{rawToggle && (
									<button
										type="button"
										className={"dock-btn" + (isRaw ? " on" : "")}
										aria-pressed={isRaw}
										aria-label={isRaw ? "Show rendered markdown" : "Show raw markdown"}
										title={isRaw ? "Show rendered markdown" : "Show raw markdown"}
										onClick={toggleRaw}
									>
										<Pilcrow size={11} />
									</button>
								)}
								<button
									type="button"
									className={"dock-btn" + (props.wrap ? " on" : "")}
									aria-pressed={props.wrap}
									aria-label="Wrap long lines"
									title={props.wrap ? "Stop wrapping long lines" : "Wrap long lines"}
									onClick={props.onToggleWrap}
								>
									<WrapText size={11} />
								</button>
							</div>
							{fileLoading ? (
								<div className="explorer-reader-note">
									<span className="work-dot" />
									<span className="work-dot" />
									<span className="work-dot" />
								</div>
							) : fileData?.binary ? (
								<div className="explorer-reader-note">binary file · preview unavailable</div>
							) : fileData?.error ? (
								<div className="explorer-reader-note">{fileData.error}</div>
							) : (
								<>
									{rendered && (
										<div className="explorer-reader-tools">
											<span className="explorer-metrics">{metrics}</span>
										</div>
									)}
									{rendered ? (
										<div className="explorer-file-body">
											<MarkdownFile content={fileData?.content ?? ""} frontmatter={fileData?.frontmatter} partner={props.partner} path={shownFile.path} />
										</div>
									) : (
										<div
											className="explorer-file-body"
											style={
												{
													"--explorer-line-gap": codeLineGap,
													"--explorer-line-height": codeLineHeight,
													"--explorer-line-height-em": `${codeLineHeight}em`,
												} as React.CSSProperties
											}
										>
											<CodeReader
												content={fileData?.content ?? ""}
												lang={languageForPath(shownFile.path) ?? null}
												fold={foldable}
												locate={shownFile.range ?? null}
												metrics={metrics}
												panelOpen={props.open}
												wrap={props.wrap}
												onSelection={(range) => setLiveRange(range)}
											/>
										</div>
									)}
									{fileData?.truncated && <div className="explorer-reader-foot">truncated · file larger than preview limit</div>}
								</>
							)}
						</div>
					) : null,
			}}
		>
			<div className="explorer-tree" ref={treeEl} onScroll={(event) => (treeScrollTop.current = event.currentTarget.scrollTop)}>
				{rootState?.status !== "ready" ? (
					<div className="explorer-empty">{rootState?.status === "error" ? (rootState?.error ?? "failed to load") : "loading workspace…"}</div>
				) : (
					(rootState?.entries ?? []).map((entry) => (
						<ExplorerNode
							key={entry.path}
							entry={entry}
							menu={rowMenu}
							depth={0}
							dirs={dirs}
							expanded={expanded}
							selectedKey={selectedKey}
							onToggle={toggleDir}
							onSelect={selectFile}
						/>
					))
				)}
			</div>
		</DockShell>
	);
}
