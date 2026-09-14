import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Folder, FolderOpen, FolderSymlink, Regex, WholeWord, X } from "lucide-solid";
import { type Accessor, createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { ExplorerEntry } from "../../shared/rpc";
import { useSettings } from "../lib/contexts/settings-context";
import { useToast } from "../lib/contexts/toast-context";
import type { RevealRange, RevealTarget } from "../lib/dock";
import { fileGlyph, linkGlyph } from "../lib/file-icons";
import { type HighlightToken, highlightCodeToLines, languageForPath, renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { createPresence, DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS } from "../lib/presence";
import { rpc } from "../lib/rpc";
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
}

function explorerGlyph(entry: ExplorerEntry) {
	if (entry.kind === "link") return linkGlyph("explorer-row-icon");
	return fileGlyph(entry.name, "explorer-row-icon");
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

interface FindMatch {
	line: number;
	start: number;
	end: number;
}

interface CodePiece {
	content: string;
	htmlStyle?: Record<string, string>;
	matchId?: number;
}

function buildPieces(tokens: HighlightToken[], ranges: { start: number; end: number; id: number }[]): CodePiece[] {
	const pieces: CodePiece[] = [];
	let offset = 0;
	for (const token of tokens) {
		const content = token.content;
		const tokenStart = offset;
		let cursor = 0;
		for (const range of ranges) {
			const start = Math.max(range.start - tokenStart, 0);
			const end = Math.min(range.end - tokenStart, content.length);
			if (end <= start) continue;
			if (start > cursor) pieces.push({ content: content.slice(cursor, start), htmlStyle: token.htmlStyle });
			pieces.push({ content: content.slice(start, end), htmlStyle: token.htmlStyle, matchId: range.id });
			cursor = end;
		}
		if (cursor < content.length) pieces.push({ content: content.slice(cursor), htmlStyle: token.htmlStyle });
		offset += content.length;
	}
	return pieces;
}

const findHistory: string[] = [];
const MAX_FIND_HISTORY = 50;

/** The preview is already readable while the highlighter works; the pill only fades in if the
 * upgrade takes longer than a beat, so small files never flash it. */
function PreviewBusy(props: { when: boolean }) {
	return (
		<Show when={props.when}>
			<div class="explorer-busy">
				<span class="work-dot" />
				<span class="work-dot" />
				<span class="work-dot" />
			</div>
		</Show>
	);
}

function MarkdownFile(props: { content: string }) {
	const [busy, setBusy] = createSignal(false);
	let ref: HTMLDivElement | undefined;
	createEffect(() => {
		const el = ref;
		if (!el) return;
		let cancelled = false;
		setBusy(true);
		el.innerHTML = renderMarkdown(props.content);
		void renderMarkdownReady(props.content)
			.then((html) => {
				if (!cancelled && el.isConnected) el.innerHTML = html;
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		onCleanup(() => {
			cancelled = true;
		});
	});
	return (
		<>
			<div class="explorer-md-scroll">
				<div ref={ref} class="md explorer-md" />
			</div>
			<PreviewBusy when={busy() && props.content !== ""} />
		</>
	);
}

function CodeViewer(props: { content: string; lang: string | null; foldable: boolean; path: string; locate?: RevealRange | null }) {
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
	const [selection, setSelection] = createSignal<{ anchor: number; head: number } | null>(null);
	createEffect(() => {
		void props.content;
		void props.locate;
		setCollapsed(new Set<number>());
		// A `path#16` / `path#74-80` request selects that range; plain opens start with no selection.
		// Tracking content as well means the range is (re)applied once the file body actually arrives.
		setSelection(props.locate ? { anchor: props.locate.start - 1, head: props.locate.end - 1 } : null);
		if (props.locate) requestAnimationFrame(() => revealMatch(props.locate!.start - 1));
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
	const lineRange = createMemo(() => {
		const sel = selection();
		if (!sel) return null;
		return { start: Math.min(sel.anchor, sel.head), end: Math.max(sel.anchor, sel.head) };
	});
	const selectedLines = createMemo(() => {
		const range = lineRange();
		const set = new Set<number>();
		if (range) for (let i = range.start; i <= range.end; i++) set.add(i);
		return set;
	});
	const multiLine = () => {
		const range = lineRange();
		return !!range && range.end > range.start;
	};
	function selectLine(index: number, extend: boolean) {
		setSelection((prev) => (extend && prev ? { anchor: prev.anchor, head: index } : { anchor: index, head: index }));
	}
	function selectForContext(index: number) {
		setSelection((prev) => {
			if (prev) {
				const start = Math.min(prev.anchor, prev.head);
				const end = Math.max(prev.anchor, prev.head);
				if (index >= start && index <= end) return prev;
			}
			return { anchor: index, head: index };
		});
	}
	function copy(text: string) {
		void navigator.clipboard?.writeText(text);
	}
	const copyLineNumber = () => {
		const range = lineRange();
		if (range) copy(String(range.start + 1));
	};
	const copyRelativePath = () => {
		const range = lineRange();
		if (!range) return;
		const start = range.start + 1;
		const end = range.end + 1;
		copy(`${props.path}#${start === end ? start : `${start}-${end}`}`);
	};
	function toggleFold(start: number) {
		const next = new Set(collapsed());
		if (next.has(start)) next.delete(start);
		else next.add(start);
		setCollapsed(next);
	}

	// ——— find in file ———
	const [findOpen, setFindOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [caseSensitive, setCaseSensitive] = createSignal(false);
	const [wholeWord, setWholeWord] = createSignal(false);
	const [useRegex, setUseRegex] = createSignal(false);
	const [activeMatch, setActiveMatch] = createSignal(0);
	const [navigated, setNavigated] = createSignal(false);
	let findInputEl: HTMLInputElement | undefined;
	let scrollEl: HTMLDivElement | undefined;
	let historyIndex = -1;
	let historyDraft = "";

	const search = createMemo(() => {
		const term = query();
		if (!findOpen() || !term) return { valid: true, matches: [] as FindMatch[] };
		let source = useRegex() ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (wholeWord()) source = `\\b(?:${source})\\b`;
		let pattern: RegExp;
		try {
			pattern = new RegExp(source, caseSensitive() ? "g" : "gi");
		} catch {
			return { valid: false, matches: [] as FindMatch[] };
		}
		const matches: FindMatch[] = [];
		for (const line of visible()) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(line.text)) !== null) {
				if (match[0].length === 0) {
					pattern.lastIndex += 1;
					continue;
				}
				matches.push({ line: line.index, start: match.index, end: match.index + match[0].length });
			}
		}
		return { valid: true, matches };
	});
	const matchCount = () => search().matches.length;
	const matchesByLine = createMemo(() => {
		const map = new Map<number, { start: number; end: number; id: number }[]>();
		search().matches.forEach((match, id) => {
			const ranges = map.get(match.line);
			if (ranges) ranges.push({ start: match.start, end: match.end, id });
			else map.set(match.line, [{ start: match.start, end: match.end, id }]);
		});
		return map;
	});

	createEffect(() => {
		void query();
		void caseSensitive();
		void wholeWord();
		void useRegex();
		setActiveMatch(0);
		setNavigated(false);
	});
	createEffect(() => {
		if (activeMatch() >= matchCount()) setActiveMatch(0);
	});

	function revealMatch(line: number) {
		if (!scrollEl) return;
		const row = scrollEl.querySelector<HTMLElement>(`[data-line="${line}"]`);
		if (row) scrollEl.scrollTop = Math.max(0, row.offsetTop - (scrollEl.clientHeight - row.offsetHeight) / 2);
	}
	function selectionText(): string | null {
		if (!scrollEl) return null;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
		const node = selection.anchorNode;
		if (!node || !scrollEl.contains(node)) return null;
		const text = selection.toString().trim();
		if (!text || text.includes("\n")) return null;
		return text;
	}
	function openFind() {
		historyIndex = -1;
		const picked = selectionText();
		if (picked) setQuery(picked);
		setFindOpen(true);
		requestAnimationFrame(() => {
			findInputEl?.focus();
			findInputEl?.select();
		});
	}
	function closeFind() {
		setFindOpen(false);
	}
	function commitHistory() {
		const term = query().trim();
		if (!term) return;
		const existing = findHistory.indexOf(term);
		if (existing >= 0) findHistory.splice(existing, 1);
		findHistory.push(term);
		if (findHistory.length > MAX_FIND_HISTORY) findHistory.shift();
		historyIndex = -1;
	}
	function recallHistory(direction: number) {
		if (findHistory.length === 0) return;
		if (direction < 0) {
			if (historyIndex === -1) {
				historyDraft = query();
				historyIndex = findHistory.length - 1;
			} else if (historyIndex > 0) {
				historyIndex -= 1;
			}
			setQuery(findHistory[historyIndex]);
		} else if (historyIndex !== -1) {
			if (historyIndex < findHistory.length - 1) {
				historyIndex += 1;
				setQuery(findHistory[historyIndex]);
			} else {
				historyIndex = -1;
				setQuery(historyDraft);
			}
		}
	}
	function stepMatch(direction: number) {
		commitHistory();
		const total = matchCount();
		if (total === 0) return;
		if (!navigated()) {
			setNavigated(true);
			setActiveMatch(direction > 0 ? 0 : total - 1);
		} else {
			setActiveMatch((index) => (index + direction + total) % total);
		}
		const match = search().matches[activeMatch()];
		if (match) revealMatch(match.line);
	}
	const findCountLabel = () => {
		if (!query()) return "";
		const result = search();
		if (!result.valid || result.matches.length === 0) return "No results";
		return `${activeMatch() + 1} of ${result.matches.length}`;
	};

	createEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
			const active = document.activeElement as HTMLElement | null;
			if (active && active !== findInputEl && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
			e.preventDefault();
			openFind();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	createEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !findOpen()) return;
			e.stopPropagation();
			closeFind();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	});
	return (
		<>
			<div class="explorer-code-scroll" ref={scrollEl}>
				<ContextMenu>
					<ContextMenuTrigger as="div" class="explorer-code-lines">
						<For each={visible()}>
							{(line) => {
								const tokens = createMemo(() => tokenData()?.[line.index]?.tokens ?? [{ content: line.text }]);
								const ranges = createMemo(() => matchesByLine().get(line.index) ?? []);
								const pieces = createMemo(() => buildPieces(tokens(), ranges()));
								const end = foldEndByStart().get(line.index);
								const isCollapsed = collapsed().has(line.index);
								return (
									<div
										class={"explorer-code-line" + (selectedLines().has(line.index) ? " selected" : "")}
										data-line={line.index}
										onContextMenu={() => selectForContext(line.index)}
									>
										<button
											type="button"
											class={"explorer-code-fold" + (end == null ? " empty" : "")}
											aria-label={end == null ? undefined : isCollapsed ? "Expand block" : "Collapse block"}
											onClick={() => end != null && toggleFold(line.index)}
											onContextMenu={(e) => e.stopPropagation()}
										>
											{end != null ? isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}
										</button>
										<button type="button" class="explorer-code-no" onClick={(e) => selectLine(line.index, e.shiftKey)} title={`Select line ${line.index + 1}`}>
											{line.index + 1}
										</button>
										<span class="explorer-code-text" onContextMenu={(e) => e.stopPropagation()}>
											<Show when={ranges().length > 0} fallback={<For each={tokens()}>{(token) => <span style={token.htmlStyle}>{token.content}</span>}</For>}>
												<For each={pieces()}>
													{(piece) => (
														<span
															style={piece.htmlStyle}
															classList={{ "explorer-find-match": piece.matchId !== undefined, current: piece.matchId !== undefined && piece.matchId === activeMatch() }}
														>
															{piece.content}
														</span>
													)}
												</For>
											</Show>
										</span>
									</div>
								);
							}}
						</For>
					</ContextMenuTrigger>
					<ContextMenuContent size="sm">
						<Show when={!multiLine()}>
							<ContextMenuItem size="sm" disabled={!lineRange()} onSelect={copyLineNumber}>
								Copy
							</ContextMenuItem>
						</Show>
						<ContextMenuItem size="sm" disabled={!lineRange()} onSelect={copyRelativePath}>
							Copy Relative Path
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			</div>
			<Show when={findOpen()}>
				<div class="explorer-find" role="search" aria-label="Find in file">
					<input
						ref={findInputEl}
						class={"explorer-find-input" + (search().valid ? "" : " invalid")}
						placeholder="Find"
						aria-label="Find"
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						value={query()}
						onInput={(e) => {
							historyIndex = -1;
							setQuery(e.currentTarget.value);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								stepMatch(e.shiftKey ? -1 : 1);
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								recallHistory(-1);
							} else if (e.key === "ArrowDown") {
								e.preventDefault();
								recallHistory(1);
							}
						}}
					/>
					<button
						type="button"
						class={"explorer-find-toggle" + (caseSensitive() ? " on" : "")}
						title="Match Case"
						aria-label="Match case"
						aria-pressed={caseSensitive()}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => setCaseSensitive((value) => !value)}
					>
						<CaseSensitive size={13} />
					</button>
					<button
						type="button"
						class={"explorer-find-toggle" + (wholeWord() ? " on" : "")}
						title="Match Whole Word"
						aria-label="Match whole word"
						aria-pressed={wholeWord()}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => setWholeWord((value) => !value)}
					>
						<WholeWord size={13} />
					</button>
					<button
						type="button"
						class={"explorer-find-toggle" + (useRegex() ? " on" : "") + (search().valid ? "" : " error")}
						title="Use Regular Expression"
						aria-label="Use regular expression"
						aria-pressed={useRegex()}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => setUseRegex((value) => !value)}
					>
						<Regex size={13} />
					</button>
					<span class="explorer-find-count" aria-live="polite">
						{findCountLabel()}
					</span>
					<button
						type="button"
						class="explorer-find-nav"
						title="Previous Match (Shift+Enter)"
						aria-label="Previous match"
						disabled={matchCount() === 0}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => stepMatch(-1)}
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						class="explorer-find-nav"
						title="Next Match (Enter)"
						aria-label="Next match"
						disabled={matchCount() === 0}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => stepMatch(1)}
					>
						<ChevronDown size={14} />
					</button>
					<button type="button" class="explorer-find-close" title="Close (Esc)" aria-label="Close find" onClick={closeFind}>
						<X size={14} />
					</button>
				</div>
			</Show>
			<PreviewBusy when={tokenData.loading && props.content !== ""} />
		</>
	);
}

interface ExplorerRowMenu {
	reveal: (entry: ExplorerEntry) => void;
	copyPath: (entry: ExplorerEntry) => void;
	copyRelative: (entry: ExplorerEntry) => void;
	collapseAll: () => void;
}

function ExplorerNode(props: {
	entry: ExplorerEntry;
	menu: ExplorerRowMenu;
	depth: number;
	dirs: Accessor<Record<string, DirState>>;
	expanded: Accessor<Set<string>>;
	selectedKey: Accessor<string | null>;
	onToggle: (entry: ExplorerEntry) => void;
	onSelect: (entry: ExplorerEntry, opts?: { raw?: boolean }) => void;
}) {
	const key = () => props.entry.path;
	const isDir = () => props.entry.kind === "dir" || (props.entry.kind === "link" && props.entry.linkKind === "dir");
	const isOpen = () => props.expanded().has(key());
	const state = () => props.dirs()[key()];
	const selected = () => props.selectedKey() === key();
	const markdown = () => !isDir() && languageForPath(props.entry.path) === "markdown";
	const [menuOpen, setMenuOpen] = createSignal(false);
	const activate = () => (isDir() ? props.onToggle(props.entry) : props.onSelect(props.entry));

	return (
		<div class="explorer-node">
			<ContextMenu onOpenChange={setMenuOpen}>
				<ContextMenuTrigger
					as="button"
					type="button"
					class={"explorer-row" + (selected() ? " selected" : "") + (props.entry.ignored ? " ignored" : "")}
					classList={{ "menu-open": menuOpen() }}
					data-path={props.entry.path}
					style={{ "padding-left": `${10 + props.depth * 16}px` }}
					title={props.entry.kind === "link" && props.entry.linkTarget ? `${props.entry.name} → ${props.entry.linkTarget}` : undefined}
					onClick={activate}
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
						explorerGlyph(props.entry)
					)}
					<span class="explorer-name">{props.entry.name}</span>
				</ContextMenuTrigger>
				<ContextMenuContent size="sm">
					<ContextMenuItem size="sm" onSelect={() => props.menu.reveal(props.entry)}>
						Reveal in Finder
					</ContextMenuItem>
					<ContextMenuItem size="sm" onSelect={() => (isDir() ? props.onToggle(props.entry) : props.onSelect(props.entry, { raw: false }))}>
						Open
					</ContextMenuItem>
					<Show when={markdown()}>
						<ContextMenuItem size="sm" onSelect={() => props.onSelect(props.entry, { raw: true })}>
							Open as Raw
						</ContextMenuItem>
					</Show>
					<ContextMenuSeparator />
					<ContextMenuItem size="sm" onSelect={() => props.menu.copyPath(props.entry)}>
						Copy Path
					</ContextMenuItem>
					<ContextMenuItem size="sm" onSelect={() => props.menu.copyRelative(props.entry)}>
						Copy Relative Path
					</ContextMenuItem>
					<Show when={isDir()}>
						<ContextMenuSeparator />
						<ContextMenuItem size="sm" onSelect={() => props.menu.collapseAll()}>
							Collapse All
						</ContextMenuItem>
					</Show>
				</ContextMenuContent>
			</ContextMenu>
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
								menu={props.menu}
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

export function ExplorerDrawer(props: { open: boolean; partner: string | null; reveal?: RevealTarget | null; side?: "left" | "right"; onClose: () => void }) {
	const settingsView = useSettings();
	const toast = useToast();
	const codeLineGap = () => settingsView.data()?.settings?.explorer?.lineGap ?? 0.2;
	const codeLineHeight = () => 1 + codeLineGap();
	const [dirs, setDirs] = createSignal<Record<string, DirState>>({});
	const [dirReal, setDirReal] = createSignal<Record<string, string>>({});
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
	const [selected, setSelected] = createSignal<SelectedFile | null>(null);
	const drawer = createPresence(() => props.open, DOCK_EXIT_MS);
	const viewer = createPresence(() => props.open && selected() != null, DOCK_POPOVER_EXIT_MS);
	const shownFile = createMemo<SelectedFile | null>((prev) => selected() ?? prev, null);
	const tokens = new Map<string, number>();
	let treeEl: HTMLDivElement | undefined;
	let treeScrollTop = 0;

	async function loadDir(path: string) {
		if (!props.partner) return;
		const token = (tokens.get(path) ?? 0) + 1;
		tokens.set(path, token);
		setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
		const res = await rpc.request.explorer_children({ name: props.partner, root: "workspace", path });
		if (tokens.get(path) !== token) return;
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
		tokens.clear();
		setDirs({});
		setDirReal({});
		setExpanded(new Set<string>());
		setSelected(null);
		treeScrollTop = 0;
	}

	let scope: string | null | undefined;
	createEffect(() => {
		const partner = props.partner;
		if (scope === partner) return;
		scope = partner;
		reset();
	});

	createEffect(() => {
		if (!props.open || !props.partner) return;
		if (!untrack(dirs)[""]) void loadDir("");
	});

	let lastRevealSeq = 0;
	createEffect(() => {
		const target = props.reveal;
		// Read `open` before consuming the seq: the dock sets reveal and panel in two writes, and an
		// unbatched flush would otherwise burn the request while the drawer is still closed.
		if (!target || !props.open || target.seq === lastRevealSeq) return;
		lastRevealSeq = target.seq;
		void revealFile(target.path, target.range);
	});

	async function revealFile(path: string, range?: RevealRange) {
		if (!props.partner) return;
		const segments = path.split("/").filter(Boolean);
		if (segments.length === 0) return;
		const chain = [""];
		for (let i = 0; i < segments.length - 1; i++) chain.push(segments.slice(0, i + 1).join("/"));
		const next = new Set(expanded());
		for (const dir of chain) {
			next.add(dir);
			await loadDir(dir);
		}
		setExpanded(next);
		setSelected({ path, name: segments[segments.length - 1], ...(range ? { range, raw: true } : {}) });
		scrollToRow(path);
	}

	function scrollToRow(path: string) {
		const row = () => [...(treeEl?.querySelectorAll<HTMLElement>(".explorer-row[data-path]") ?? [])].find((el) => el.dataset["path"] === path);
		requestAnimationFrame(() => {
			if (row()) {
				row()!.scrollIntoView({ block: "center" });
				return;
			}
			requestAnimationFrame(() => row()?.scrollIntoView({ block: "center" }));
		});
	}

	createEffect(() => {
		if (!props.open) return;
		requestAnimationFrame(() => {
			if (treeEl) treeEl.scrollTop = treeScrollTop;
		});
	});

	createEffect(() => {
		if (!props.open) setSelected(null);
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
		return ancestors.some((ancestor) => dirReal()[ancestor] === entry.realPath);
	}

	function toggleDir(entry: ExplorerEntry) {
		const key = entry.path;
		const next = new Set(expanded());
		if (next.has(key)) {
			next.delete(key);
		} else {
			if (hasCycleToAncestor(entry)) return;
			next.add(key);
			const state = dirs()[key];
			if (!state || state.status === "error") void loadDir(entry.path);
		}
		setExpanded(next);
	}

	function selectFile(entry: ExplorerEntry, opts?: { raw?: boolean }) {
		const current = selected();
		const raw = opts?.raw === true;
		if (current?.path === entry.path && (opts === undefined || raw === (current.raw === true))) return;
		setSelected({ path: entry.path, name: entry.name, ...(raw ? { raw: true } : {}) });
	}

	const workspaceRoot = () => dirReal()[""];

	function entryAbsPath(path: string) {
		const root = workspaceRoot();
		if (!root) return path;
		return root.endsWith("/") ? `${root}${path}` : `${root}/${path}`;
	}

	async function revealRow(path: string) {
		if (!props.partner) return;
		const res = await rpc.request.explorer_reveal({ name: props.partner, path });
		if (!res.ok) toast.push({ title: "Couldn't reveal in Finder", body: res.error ?? "Unknown error" }, "error");
	}

	// Row context menu: Finder / clipboard paths, plus a tree-wide collapse for folders.
	const rowMenu: ExplorerRowMenu = {
		reveal: (entry) => void revealRow(entry.path),
		copyPath: (entry) => void navigator.clipboard?.writeText(entryAbsPath(entry.path)),
		copyRelative: (entry) => void navigator.clipboard?.writeText(entry.path),
		collapseAll: () => setExpanded(new Set<string>()),
	};

	const selectedKey = () => selected()?.path ?? null;
	const rootState = () => dirs()[""];
	const crumbs = () => (shownFile()?.path || shownFile()?.name || "").split("/").filter(Boolean);
	const foldable = () => {
		const path = shownFile()?.path;
		if (!path) return false;
		const lang = languageForPath(path);
		return lang === "json" || lang === "jsonc" || lang === "markdown";
	};
	const rendered = () => {
		const file = shownFile();
		return !!file && file.raw !== true && languageForPath(file.path) === "markdown";
	};

	const [fileData] = createResource(shownFile, async (sel: SelectedFile): Promise<FileData | null> => {
		if (!props.partner) return null;
		const res = await rpc.request.explorer_read_file({ name: props.partner, root: "workspace", path: sel.path });
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
			<Show when={drawer.visible()}>
				<aside class={"explorer-drawer dock-panel side-" + (props.side ?? "right")} classList={{ leaving: drawer.leaving() }}>
					<div class="explorer-head">
						<span class="explorer-title">Explorer</span>
						<button type="button" class="explorer-close" title="Close" onClick={props.onClose}>
							×
						</button>
					</div>
					<div class="explorer-tree" ref={treeEl} onScroll={(e) => (treeScrollTop = e.currentTarget.scrollTop)}>
						<Show
							when={rootState()?.status === "ready"}
							fallback={<div class="explorer-empty">{rootState()?.status === "error" ? (rootState()?.error ?? "failed to load") : "loading workspace…"}</div>}
						>
							<For each={rootState()?.entries ?? []}>
								{(entry) => (
									<ExplorerNode entry={entry} menu={rowMenu} depth={0} dirs={dirs} expanded={expanded} selectedKey={selectedKey} onToggle={toggleDir} onSelect={selectFile} />
								)}
							</For>
						</Show>
					</div>
				</aside>

				<Show when={viewer.visible()}>
					<Show when={shownFile()}>
						{(file) => (
							<div class={"explorer-popover dock-pop side-" + (props.side ?? "right")} classList={{ leaving: viewer.leaving() }}>
								<div class="explorer-popover-head">
									<nav class="explorer-popover-crumbs" aria-label="File path" title={file().path || file().name}>
										<For each={crumbs()}>
											{(segment, index) => (
												<>
													<Show when={index() > 0}>
														<ChevronRight size={11} class="explorer-crumb-sep" />
													</Show>
													<span class={"explorer-crumb" + (index() === crumbs().length - 1 ? " current" : "")}>{segment}</span>
												</>
											)}
										</For>
									</nav>
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
										<Show
											when={!rendered()}
											fallback={
												<div class="explorer-file-body">
													<MarkdownFile content={fileData()?.content ?? ""} />
												</div>
											}
										>
											<div
												class="explorer-file-body"
												style={`--explorer-line-gap: ${codeLineGap()}; --explorer-line-height: ${codeLineHeight()}; --explorer-line-height-em: ${codeLineHeight()}em`}
											>
												<CodeViewer
													content={fileData()?.content ?? ""}
													lang={languageForPath(file().path) ?? null}
													foldable={foldable()}
													path={file().path}
													locate={file().range ?? null}
												/>
											</div>
										</Show>
										<Show when={fileData()?.truncated}>
											<div class="explorer-popover-foot">truncated · file larger than preview limit</div>
										</Show>
									</Show>
								</Show>
							</div>
						)}
					</Show>
				</Show>
			</Show>
		</>
	);
}
