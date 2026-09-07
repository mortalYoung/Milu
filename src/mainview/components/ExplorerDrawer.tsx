import {
	ChevronDown,
	ChevronRight,
	File,
	FileArchive,
	FileAudio,
	FileCode,
	FileCog,
	FileDiff,
	FileImage,
	FileJson,
	FileSymlink,
	FileTerminal,
	FileText,
	FileVideo,
	Folder,
	FolderOpen,
	FolderSymlink,
} from "lucide-solid";
import { type Accessor, createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { ExplorerEntry, ExplorerRoot } from "../../shared/rpc";
import { useSettings } from "../lib/contexts/settings-context";
import { highlightCodeToLines, languageForPath } from "../lib/markdown";
import { rpc } from "../lib/rpc";

interface DirState {
	status: "loading" | "ready" | "error";
	entries?: ExplorerEntry[];
	error?: string;
}

interface SelectedFile {
	root: ExplorerRoot;
	path: string;
	name: string;
}

interface FileData {
	content?: string;
	binary?: boolean;
	truncated?: boolean;
	size?: number;
	error?: string;
}

function dirKey(root: ExplorerRoot, path: string): string {
	return `${root}:${path}`;
}

function fileGlyph(entry: ExplorerEntry) {
	const base = entry.name.toLowerCase();
	if (entry.kind === "link") return <FileSymlink size={14} class="explorer-row-icon" />;
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot + 1) : "";
	switch (ext) {
		case "ts":
		case "mts":
		case "cts":
		case "tsx":
		case "js":
		case "mjs":
		case "cjs":
		case "jsx":
		case "py":
		case "pyw":
		case "html":
		case "htm":
		case "css":
		case "sql":
			return <FileCode size={14} class="explorer-row-icon" />;
		case "json":
		case "jsonc":
			return <FileJson size={14} class="explorer-row-icon" />;
		case "md":
		case "mdx":
		case "markdown":
		case "txt":
			return <FileText size={14} class="explorer-row-icon" />;
		case "yml":
		case "yaml":
		case "toml":
		case "ini":
		case "cfg":
		case "env":
			return <FileCog size={14} class="explorer-row-icon" />;
		case "sh":
		case "bash":
		case "zsh":
			return <FileTerminal size={14} class="explorer-row-icon" />;
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "webp":
		case "svg":
		case "ico":
		case "avif":
			return <FileImage size={14} class="explorer-row-icon" />;
		case "diff":
		case "patch":
			return <FileDiff size={14} class="explorer-row-icon" />;
		case "zip":
		case "gz":
		case "tar":
		case "rar":
		case "7z":
			return <FileArchive size={14} class="explorer-row-icon" />;
		case "mp3":
		case "wav":
		case "ogg":
		case "m4a":
			return <FileAudio size={14} class="explorer-row-icon" />;
		case "mp4":
		case "mov":
		case "mkv":
		case "webm":
			return <FileVideo size={14} class="explorer-row-icon" />;
		default:
			return <File size={14} class="explorer-row-icon" />;
	}
}

interface FoldRange {
	start: number;
	end: number;
}

function findJsonFoldRanges(text: string): FoldRange[] {
	const ranges: FoldRange[] = [];
	const stack: { char: string; line: number }[] = [];
	let line = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n") {
			line += 1;
			continue;
		}
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{" || ch === "[") stack.push({ char: ch, line });
		else if (ch === "}" || ch === "]") {
			const open = stack.pop();
			if (open && ((open.char === "{" && ch === "}") || (open.char === "[" && ch === "]")) && line > open.line) ranges.push({ start: open.line, end: line });
		}
	}
	return ranges;
}

function findMarkdownFoldRanges(text: string): FoldRange[] {
	const lines = text.split("\n");
	let fence: string | null = null;
	const levels = lines.map((line) => {
		const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1][0];
			if (!fence) fence = marker;
			else if (fence === marker) fence = null;
			return null;
		}
		if (fence) return null;
		const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(line);
		return match ? match[1].length : null;
	});
	const ranges: FoldRange[] = [];
	for (let i = 0; i < lines.length; i++) {
		const level = levels[i];
		if (level == null) continue;
		let end = lines.length - 1;
		for (let j = i + 1; j < lines.length; j++) {
			const next = levels[j];
			if (next != null && next <= level) {
				end = j - 1;
				break;
			}
		}
		if (end > i) ranges.push({ start: i, end });
	}
	return ranges;
}

function CodeViewer(props: { content: string; lang: string | null; foldable: boolean }) {
	const [tokenData] = createResource(
		() => ({ content: props.content, lang: props.lang }),
		async ({ content, lang }) => highlightCodeToLines(content, lang),
	);
	const lines = createMemo(() => props.content.split("\n"));
	const folds = createMemo(() => {
		if (!props.foldable) return [];
		if (props.lang === "json" || props.lang === "jsonc") return findJsonFoldRanges(props.content);
		if (props.lang === "markdown") return findMarkdownFoldRanges(props.content);
		return [];
	});
	const [collapsed, setCollapsed] = createSignal<Set<number>>(new Set());
	const [selectedLine, setSelectedLine] = createSignal<number | null>(null);
	createEffect(() => {
		void props.content;
		setCollapsed(new Set<number>());
		setSelectedLine(null);
	});
	const foldEndByStart = createMemo(() => {
		const map = new Map<number, number>();
		for (const fold of folds()) map.set(fold.start, fold.end);
		return map;
	});
	const hidden = createMemo(() => {
		const hiddenLines = new Set<number>();
		for (const start of collapsed()) {
			const end = foldEndByStart().get(start);
			if (end == null) continue;
			for (let i = start + 1; i <= end; i++) hiddenLines.add(i);
		}
		return hiddenLines;
	});
	const visible = createMemo(() =>
		lines()
			.map((text, index) => ({ index, text }))
			.filter((line) => !hidden().has(line.index)),
	);
	const rows = createMemo(() => {
		const data = tokenData();
		return visible().map((line) => ({ ...line, tokens: data?.[line.index]?.tokens }));
	});
	function toggleFold(start: number) {
		const next = new Set(collapsed());
		if (next.has(start)) next.delete(start);
		else next.add(start);
		setCollapsed(next);
	}
	return (
		<div class="explorer-code-lines">
			<For each={rows()}>
				{(line) => {
					const tokens = line.tokens;
					const end = foldEndByStart().get(line.index);
					const isCollapsed = collapsed().has(line.index);
					return (
						<div class={"explorer-code-line" + (selectedLine() === line.index ? " selected" : "")} data-line={line.index}>
							<button
								type="button"
								class={"explorer-code-fold" + (end == null ? " empty" : "")}
								aria-label={end == null ? undefined : isCollapsed ? "Expand block" : "Collapse block"}
								onClick={() => end != null && toggleFold(line.index)}
							>
								{end != null ? isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}
							</button>
							<button type="button" class="explorer-code-no" onClick={() => setSelectedLine(line.index)} title={`Select line ${line.index + 1}`}>
								{line.index + 1}
							</button>
							<span class="explorer-code-text">
								<For each={tokens ?? [{ content: line.text }]}>{(token) => <span style={token.htmlStyle}>{token.content}</span>}</For>
							</span>
						</div>
					);
				}}
			</For>
		</div>
	);
}

function ExplorerNode(props: {
	entry: ExplorerEntry;
	root: ExplorerRoot;
	depth: number;
	dirs: Accessor<Record<string, DirState>>;
	expanded: Accessor<Set<string>>;
	selectedKey: Accessor<string | null>;
	onToggle: (entry: ExplorerEntry) => void;
	onSelect: (entry: ExplorerEntry) => void;
}) {
	const key = () => dirKey(props.root, props.entry.path);
	const isDir = () => props.entry.kind === "dir" || (props.entry.kind === "link" && props.entry.linkKind === "dir");
	const isOpen = () => props.expanded().has(key());
	const state = () => props.dirs()[key()];
	const selected = () => props.selectedKey() === key();

	return (
		<div class="explorer-node">
			<button
				type="button"
				class={"explorer-row" + (selected() ? " selected" : "") + (props.entry.ignored ? " ignored" : "")}
				style={{ "padding-left": `${10 + props.depth * 16}px` }}
				title={props.entry.kind === "link" && props.entry.linkTarget ? `${props.entry.name} → ${props.entry.linkTarget}` : undefined}
				onClick={() => (isDir() ? props.onToggle(props.entry) : props.onSelect(props.entry))}
			>
				{isDir() && (isOpen() ? <ChevronDown size={11} class="explorer-chevron" /> : <ChevronRight size={11} class="explorer-chevron" />)}
				{isDir() ? (
					props.entry.kind === "link" ? (
						<FolderSymlink size={14} class="explorer-row-icon" />
					) : isOpen() ? (
						<FolderOpen size={14} class="explorer-row-icon" />
					) : (
						<Folder size={14} class="explorer-row-icon" />
					)
				) : (
					fileGlyph(props.entry)
				)}
				<span class="explorer-name">{props.entry.name}</span>
			</button>
			<Show when={isDir() && isOpen()}>
				<Show
					when={state()?.status === "ready"}
					fallback={
						<div class="explorer-node-note" style={{ "padding-left": `${24 + props.depth * 16}px` }}>
							{state()?.status === "error" ? (state()?.error ?? "failed to load") : "…"}
						</div>
					}
				>
					<For each={state()?.entries ?? []}>
						{(child) => (
							<ExplorerNode
								entry={child}
								root={props.root}
								depth={props.depth + 1}
								dirs={props.dirs}
								expanded={props.expanded}
								selectedKey={props.selectedKey}
								onToggle={props.onToggle}
								onSelect={props.onSelect}
							/>
						)}
					</For>
				</Show>
			</Show>
		</div>
	);
}

export function ExplorerDrawer(props: {
	open: boolean;
	partner: string | null;
	root: ExplorerRoot;
	hasWorkspace: boolean;
	onRootChange: (root: ExplorerRoot) => void;
	onClose: () => void;
}) {
	const settingsView = useSettings();
	const codeLineGap = () => settingsView.data()?.settings?.explorer?.lineGap ?? 0.2;
	const codeLineHeight = () => 1 + codeLineGap();
	const [dirs, setDirs] = createSignal<Record<string, DirState>>({});
	const [dirReal, setDirReal] = createSignal<Record<string, string>>({});
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
	const [selected, setSelected] = createSignal<SelectedFile | null>(null);
	const tokens = new Map<string, number>();

	async function loadDir(root: ExplorerRoot, path: string) {
		if (!props.partner) return;
		const key = dirKey(root, path);
		const token = (tokens.get(key) ?? 0) + 1;
		tokens.set(key, token);
		setDirs((prev) => ({ ...prev, [key]: { status: "loading" } }));
		const res = await rpc.request.explorer_children({ name: props.partner, root, path });
		if (tokens.get(key) !== token) return;
		setDirs((prev) => ({
			...prev,
			[key]: res.ok && res.entries ? { status: "ready", entries: res.entries } : { status: "error", error: res.error ?? "failed to load" },
		}));
		if (res.ok) {
			const realUpdates: Record<string, string> = {};
			if (res.realPath) realUpdates[key] = res.realPath;
			for (const entry of res.entries ?? []) {
				if ((entry.kind === "dir" || (entry.kind === "link" && entry.linkKind === "dir")) && entry.realPath) realUpdates[dirKey(root, entry.path)] = entry.realPath;
			}
			if (Object.keys(realUpdates).length > 0) setDirReal((prev) => ({ ...prev, ...realUpdates }));
		}
	}

	function reset() {
		tokens.clear();
		setDirs({});
		setDirReal({});
		setExpanded(new Set<string>());
		setSelected(null);
	}

	createEffect(() => {
		reset();
		if (props.open && props.partner) void loadDir(props.root, "");
	});

	function hasCycleToAncestor(entry: ExplorerEntry): boolean {
		if (!entry.realPath || !entry.path) return false;
		const segments = entry.path.split("/");
		const ancestors = [""];
		let current = "";
		for (let i = 0; i < segments.length - 1; i++) {
			current = current ? `${current}/${segments[i]}` : segments[i];
			ancestors.push(current);
		}
		return ancestors.some((ancestor) => dirReal()[dirKey(props.root, ancestor)] === entry.realPath);
	}

	function toggleDir(entry: ExplorerEntry) {
		const key = dirKey(props.root, entry.path);
		const next = new Set(expanded());
		if (next.has(key)) {
			next.delete(key);
		} else {
			if (hasCycleToAncestor(entry)) return;
			next.add(key);
			const state = dirs()[key];
			if (!state || state.status === "error") void loadDir(props.root, entry.path);
		}
		setExpanded(next);
	}

	function selectFile(entry: ExplorerEntry) {
		const current = selected();
		if (current && current.root === props.root && current.path === entry.path) return;
		setSelected({ root: props.root, path: entry.path, name: entry.name });
	}

	const selectedKey = () => (selected() ? dirKey(selected()!.root, selected()!.path) : null);
	const rootState = () => dirs()[dirKey(props.root, "")];
	const foldable = () => {
		const path = selected()?.path;
		if (!path) return false;
		const lang = languageForPath(path);
		return lang === "json" || lang === "jsonc" || lang === "markdown";
	};

	const [fileData] = createResource(selected, async (sel: SelectedFile): Promise<FileData | null> => {
		if (!props.partner) return null;
		const res = await rpc.request.explorer_read_file({ name: props.partner, root: sel.root, path: sel.path });
		if (!res.ok) return { error: res.error ?? "failed to read file" };
		return { content: res.content ?? "", binary: res.binary, truncated: res.truncated, size: res.size };
	});

	createEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (selected()) setSelected(null);
			else props.onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<>
			<Show when={props.open}>
				<aside class="explorer-drawer">
					<div class="explorer-head">
						<span class="explorer-title">Explorer</span>
						<Show when={props.hasWorkspace}>
							<div class="explorer-root-toggle" role="group" aria-label="Explorer root">
								{(["workspace", "storage"] as const).map((r) => (
									<button type="button" class={"explorer-root" + (props.root === r ? " on" : "")} onClick={() => props.onRootChange(r)} aria-pressed={props.root === r}>
										{r}
									</button>
								))}
							</div>
						</Show>
						<button type="button" class="explorer-close" title="Close" onClick={props.onClose}>
							×
						</button>
					</div>
					<div class="explorer-tree">
						<Show
							when={rootState()?.status === "ready"}
							fallback={
								<div class="explorer-empty">
									{rootState()?.status === "error" ? (rootState()?.error ?? "failed to load") : props.root === "workspace" ? "loading workspace…" : "loading storage…"}
								</div>
							}
						>
							<For each={rootState()?.entries ?? []}>
								{(entry) => (
									<ExplorerNode entry={entry} root={props.root} depth={0} dirs={dirs} expanded={expanded} selectedKey={selectedKey} onToggle={toggleDir} onSelect={selectFile} />
								)}
							</For>
						</Show>
					</div>
				</aside>

				<Show when={selected()}>
					<div class="explorer-popover">
						<div class="explorer-popover-head">
							<span class="explorer-popover-path" title={selected()!.path}>
								{selected()!.path || selected()!.name}
							</span>
							<button type="button" class="explorer-popover-close" title="Close" onClick={() => setSelected(null)}>
								×
							</button>
						</div>
						<Show
							when={!fileData.loading}
							fallback={
								<div class="explorer-popover-note">
									<span class="work-dot" />
									<span class="work-dot" />
									<span class="work-dot" />
								</div>
							}
						>
							<Show when={fileData()?.binary}>
								<div class="explorer-popover-note">binary file · preview unavailable</div>
							</Show>
							<Show when={!fileData()?.binary && fileData()?.error}>
								<div class="explorer-popover-note">{fileData()!.error}</div>
							</Show>
							<Show when={!fileData()?.binary && !fileData()?.error}>
								<div
									class="explorer-file-body"
									style={`--explorer-line-gap: ${codeLineGap()}; --explorer-line-height: ${codeLineHeight()}; --explorer-line-height-em: ${codeLineHeight()}em`}
								>
									<CodeViewer content={fileData()?.content ?? ""} lang={languageForPath(selected()!.path) ?? null} foldable={foldable()} />
								</div>
								<Show when={fileData()?.truncated}>
									<div class="explorer-popover-foot">truncated · file larger than preview limit</div>
								</Show>
							</Show>
						</Show>
					</div>
				</Show>
			</Show>
		</>
	);
}
