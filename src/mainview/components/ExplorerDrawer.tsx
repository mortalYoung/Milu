import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Folder, FolderOpen, FolderSymlink, Pin, Regex, WholeWord, X } from "lucide-solid";
import { type Accessor, createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { ExplorerEntry } from "../../shared/rpc";
import { useComposer } from "../lib/contexts/composer-context";
import { useSession } from "../lib/contexts/session-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useToast } from "../lib/contexts/toast-context";
import type { RevealRange, RevealTarget } from "../lib/dock";
import { DOCK_PANE_MAX, DOCK_PANE_MIN } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { fileGlyph, linkGlyph } from "../lib/file-icons";
import { type HighlightToken, highlightCodeToLines, languageForPath, renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { DockShell } from "./DockShell";
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

interface FoldRange {
	start: number;
	end: number;
}

/**
 * Folds bracket blocks that span more than one line. Quotes, template literals and both comment
 * styles are skipped, so a brace inside a message cannot swallow the rest of the file. Regex
 * literals are not recognised: a `}` inside one may close a block early.
 */
function findBracketFoldRanges(text: string, brackets: string): FoldRange[] {
	const openers = new Set<string>();
	const closers = new Map<string, string>();
	if (brackets.includes("{")) {
		openers.add("{");
		closers.set("}", "{");
	}
	if (brackets.includes("[")) {
		openers.add("[");
		closers.set("]", "[");
	}
	const ranges: FoldRange[] = [];
	const stack: { char: string; line: number }[] = [];
	let line = 0;
	let quote: string | null = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n") {
			line += 1;
			lineComment = false;
			continue;
		}
		if (lineComment) continue;
		if (blockComment) {
			if (ch === "*" && text[i + 1] === "/") {
				blockComment = false;
				i += 1;
			}
			continue;
		}
		if (quote) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "/" && text[i + 1] === "/") {
			lineComment = true;
			i += 1;
			continue;
		}
		if (ch === "/" && text[i + 1] === "*") {
			blockComment = true;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (openers.has(ch)) {
			stack.push({ char: ch, line });
			continue;
		}
		const opener = closers.get(ch);
		if (!opener) continue;
		const open = stack.pop();
		if (open && open.char === opener && line > open.line) ranges.push({ start: open.line, end: line });
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

/** Which languages fold on brackets, and which brackets. */
const BRACKET_FOLD_LANGS: Record<string, string> = {
	ts: "{}",
	tsx: "{}",
	js: "{}",
	jsx: "{}",
	css: "{}",
	json: "{}[]",
	jsonc: "{}[]",
};

type FoldRule = { kind: "markdown" } | { kind: "brackets"; brackets: string };

/** A trailing newline is not a line — the count and the gutter agree with what an editor shows. */
function contentLines(content: string): string[] {
	if (content === "") return [];
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** `TS · 143 lines · 4.2 KB` — the reader header's second row is the only place these live. */
function fileMetrics(path: string, data: FileData | null | undefined): string {
	if (data?.content == null) return "";
	const lang = languageForPath(path);
	const count = contentLines(data.content).length;
	const label = lang ? (LANGUAGE_LABELS[lang] ?? lang.toUpperCase()) : null;
	return [label, `${count} ${count === 1 ? "line" : "lines"}`, formatBytes(data.size ?? data.content.length)].filter(Boolean).join(" · ");
}

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

/** How many dotted rows the header shows before it asks to be opened. */
const FRONTMATTER_HEAD = 4;
const FRONTMATTER_LIMIT = 8;
/** Past this, a prose value shows its opening lines only: a skill's description can run to 600+ characters. */
const PROSE_CLAMP_CHARS = 150;

interface FrontmatterLine {
	key: string;
	value: string;
	/** Long or multi-line values read as prose under their key instead of on the key's line. */
	prose: boolean;
	/** Prose long enough that the header should show its opening lines only. */
	long: boolean;
}

function scalarText(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value) ?? "—";
}

/** Flatten a YAML head into dotted rows: `colors.paper  #f7f3ea`, `typography.serif-family  Newsreader`. */
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

/**
 * A YAML head drawn as a document header rather than as raw text.
 *
 * GitHub renders frontmatter as a two-column table; a table is the wrong shape here — the values are
 * often a long block scalar (a skill's whole description), a fixed-width cell turns that into a
 * narrow column, and the header would then outweigh the document's own tables. As a header it keeps
 * the document's heading hierarchy intact and stays honest: the metadata is still shown, it just
 * stops pretending to be data.
 *
 * A head that does not parse (this repo's own DESIGN.md) keeps its bytes too, but behind a closed
 * disclosure as a highlighted YAML block — the markdown parser used to eat it, turning YAML lines
 * into paragraphs and, when a line began with `-` or `+`, into a list item.
 */
function FrontmatterHeader(props: { frontmatter: Frontmatter }) {
	const [open, setOpen] = createSignal(false);
	/** One prose value at a time: the key of the line whose full text is showing. */
	const [expanded, setExpanded] = createSignal<string | null>(null);
	const lines = createMemo(() => (props.frontmatter.data ? frontmatterLines(props.frontmatter.data) : []));
	const collapsible = () => lines().length > FRONTMATTER_LIMIT;
	const shown = () => (collapsible() && !open() ? lines().slice(0, FRONTMATTER_HEAD) : lines());
	const rawHtml = createMemo(() => (props.frontmatter.data ? "" : renderMarkdown(`\`\`\`yaml\n${props.frontmatter.raw}\n\`\`\``)));

	return (
		<div class="md-frontmatter">
			<div class="md-frontmatter-head">
				<span class="md-frontmatter-mark">frontmatter</span>
				<Show when={props.frontmatter.data && collapsible()}>
					<button type="button" class="md-frontmatter-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
						{open() ? "show fewer" : `show all ${lines().length} fields`}
					</button>
				</Show>
				<Show when={!props.frontmatter.data}>
					<button type="button" class="md-frontmatter-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
						{open() ? "hide" : "not valid YAML — show it"}
					</button>
				</Show>
			</div>
			<Show
				when={props.frontmatter.data}
				fallback={
					<Show when={open()}>
						<div class="md" innerHTML={rawHtml()} />
					</Show>
				}
			>
				<For each={shown()}>
					{(line) =>
						line.prose ? (
							<div class="md-frontmatter-prose-row">
								<span class="md-frontmatter-key">{line.key}</span>
								<p class="md-frontmatter-prose" classList={{ clamped: line.long && expanded() !== line.key }}>
									{line.value}
								</p>
								<Show when={line.long}>
									<button
										type="button"
										class="md-frontmatter-toggle"
										aria-expanded={expanded() === line.key}
										onClick={() => setExpanded(expanded() === line.key ? null : line.key)}
									>
										{expanded() === line.key ? "show less" : "show more"}
									</button>
								</Show>
							</div>
						) : (
							<div class="md-frontmatter-row">
								<span class="md-frontmatter-key">{line.key}</span>
								<span class="md-frontmatter-value">{line.value}</span>
							</div>
						)
					}
				</For>
			</Show>
		</div>
	);
}

function MarkdownFile(props: { content: string; frontmatter?: Frontmatter; partner?: string | null; path?: string }) {
	const [busy, setBusy] = createSignal(false);
	/** Resolved data URLs, kept for the life of this file so the second pass does not re-read them. */
	const images = new Map<string, string>();
	/** Why a source could not be inlined, shown on the chip that stays behind. */
	const failures = new Map<string, string>();
	let ref: HTMLDivElement | undefined;
	/** The head is drawn as a header, so the renderer only ever sees the body. */
	const body = () => (props.frontmatter ? props.content.slice(props.frontmatter.end) : props.content);

	/** A relative source is a chip after the first paint; this turns the ones we can read into images. */
	async function resolveImages(el: HTMLElement) {
		const partner = props.partner;
		const from = props.path;
		if (!partner || !from) return images;
		const srcs = [...new Set([...el.querySelectorAll<HTMLElement>("[data-md-src]")].map((node) => node.dataset["mdSrc"] ?? ""))].filter(Boolean).slice(0, 24);
		await Promise.all(
			srcs.map(async (src) => {
				if (images.has(src)) return;
				const res = await rpc.request.explorer_read_image({ name: partner, root: "workspace", from, path: src });
				if (res.ok && res.dataUrl) images.set(src, res.dataUrl);
				else if (res.error) failures.set(src, res.error);
			}),
		);
		return images;
	}

	/** Say why a chip stayed a chip — a refusal the reader cannot see is a dead end. */
	function explainFailures(el: HTMLElement) {
		if (failures.size === 0) return;
		for (const node of el.querySelectorAll<HTMLElement>("[data-md-src]")) {
			const reason = failures.get(node.dataset["mdSrc"] ?? "");
			if (reason) node.title = reason;
		}
	}

	createEffect(() => {
		const el = ref;
		if (!el) return;
		let cancelled = false;
		setBusy(true);
		const text = body();
		el.innerHTML = renderMarkdown(text);
		void (async () => {
			const resolved = await resolveImages(el).catch(() => images);
			const html = await renderMarkdownReady(text, undefined, resolved);
			if (!cancelled && el.isConnected) {
				el.innerHTML = html;
				explainFailures(el);
			}
		})().finally(() => {
			if (!cancelled) setBusy(false);
		});
		onCleanup(() => {
			cancelled = true;
		});
	});
	return (
		<>
			<div class="explorer-md-scroll">
				<Show when={props.frontmatter}>{(head) => <FrontmatterHeader frontmatter={head()} />}</Show>
				<div ref={ref} class="md explorer-md" />
			</div>
			<PreviewBusy when={busy() && props.content !== ""} />
		</>
	);
}

function CodeViewer(props: {
	content: string;
	lang: string | null;
	fold: FoldRule | null;
	locate?: RevealRange | null;
	metrics: string;
	/** The panel this reader belongs to is showing, so its Esc layers are live. */
	panelOpen: boolean;
	onSelection?: (range: { start: number; end: number } | null) => void;
}) {
	const [tokenData] = createResource(
		() => ({ content: props.content, lang: props.lang }),
		async ({ content, lang }) => highlightCodeToLines(content, lang),
	);
	const lines = createMemo(() => contentLines(props.content));
	const folds = createMemo(() => {
		const rule = props.fold;
		if (!rule) return [];
		return rule.kind === "markdown" ? findMarkdownFoldRanges(props.content) : findBracketFoldRanges(props.content, rule.brackets);
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
	createEffect(() => props.onSelection?.(lineRange()));
	function selectLine(index: number, extend: boolean) {
		setSelection((prev) => (extend && prev ? { anchor: prev.anchor, head: index } : { anchor: index, head: index }));
	}
	const codeText = () => {
		const range = lineRange();
		if (!range) return "";
		return lines()
			.slice(range.start, range.end + 1)
			.join("\n");
	};
	// Arrow keys walk the visible lines and carry the selection; Shift extends it from the anchor.
	function onCodeKeyDown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const rows = visible();
		if (rows.length === 0) return;
		e.preventDefault();
		const sel = selection();
		const at = sel ? rows.findIndex((row) => row.index === sel.head) : -1;
		const step = e.key === "ArrowDown" ? 1 : -1;
		const next = at === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, at + step));
		const target = rows[next].index;
		if (e.shiftKey && sel) setSelection({ anchor: sel.anchor, head: target });
		else setSelection({ anchor: target, head: target });
		revealMatch(target);
	}
	function inField(target: EventTarget | null) {
		const el = target as HTMLElement | null;
		return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
	}
	// Cmd+A anywhere in the pane takes the whole file into the line selection; line numbers stay out.
	function onReaderKeyDown(e: KeyboardEvent) {
		if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "a") return;
		if (inField(e.target)) return;
		e.preventDefault();
		const total = lines().length;
		if (total > 0) setSelection({ anchor: 0, head: total - 1 });
	}
	// Cmd+C on a line selection copies the code; a drag-selection is still the browser's to copy.
	function onReaderCopy(e: ClipboardEvent) {
		const native = window.getSelection();
		if (native && !native.isCollapsed && scrollEl?.contains(native.anchorNode)) return;
		const text = codeText();
		if (!text) return;
		e.clipboardData?.setData("text/plain", text);
		e.preventDefault();
	}
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

	// Esc reaches the reader's own layers before the dock's: the find row sits over a line selection.
	useEscapeLayer({
		id: "explorer.readerFind",
		order: ESCAPE_ORDER.readerFind,
		isOpen: () => props.panelOpen && findOpen(),
		close: () => closeFind(),
	});
	useEscapeLayer({
		id: "explorer.readerSelection",
		order: ESCAPE_ORDER.readerSelection,
		isOpen: () => props.panelOpen && lineRange() != null,
		close: () => setSelection(null),
	});
	return (
		<div class="explorer-code-pane" onKeyDown={onReaderKeyDown} onCopy={onReaderCopy}>
			<div class="explorer-reader-tools" role="search" aria-label="Find in file">
				<Show
					when={findOpen()}
					fallback={
						<button type="button" class="explorer-tool" title="Find in file (⌘F)" aria-label="Find in file" onClick={openFind}>
							⌕
						</button>
					}
				>
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
				</Show>
				<span class="explorer-metrics">{props.metrics}</span>
			</div>
			<div class="explorer-code-scroll" ref={scrollEl} tabIndex={0} onKeyDown={onCodeKeyDown}>
				<div class="explorer-code-lines">
					<For each={lines()}>
						{(line, index) => {
							const tokens = createMemo(() => tokenData()?.[index()]?.tokens ?? ([{ content: line, htmlStyle: undefined }] as HighlightToken[]));
							const ranges = createMemo(() => matchesByLine().get(index()) ?? []);
							const pieces = createMemo(() => buildPieces(tokens(), ranges()));
							const end = createMemo(() => foldEndByStart().get(index()));
							const isCollapsed = () => collapsed().has(index());
							return (
								<Show when={!hidden().has(index())}>
									<div class={"explorer-code-line" + (selectedLines().has(index()) ? " selected" : "")} data-line={index()}>
										<button
											type="button"
											class={"explorer-code-fold" + (end() == null ? " empty" : "")}
											aria-label={end() == null ? undefined : isCollapsed() ? "Expand block" : "Collapse block"}
											onClick={() => end() != null && toggleFold(index())}
										>
											{end() != null ? isCollapsed() ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}
										</button>
										<button type="button" class="explorer-code-no" onClick={(e) => selectLine(index(), e.shiftKey)} title={`Select line ${index() + 1}`}>
											{index() + 1}
										</button>
										<span class="explorer-code-text">
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
								</Show>
							);
						}}
					</For>
				</div>
			</div>
			<PreviewBusy when={tokenData.loading && props.content !== ""} />
		</div>
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

/**
 * What each partner left open in the dock, kept outside the component: the reader outlives a partner
 * switch, a panel switch and a remount, so a partner comes back to the file (and the pin) it left.
 * Only the reader's own dismissal forgets it.
 */
const [openFiles, setOpenFiles] = createSignal<Record<string, SelectedFile>>({});

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
	/** The dock's one pane width, shared with every other docked panel. */
	paneWidth: number;
	onPaneResize: (px: number) => void;
	onPaneCommit: () => void;
	onClose: () => void;
}) {
	const settingsView = useSettings();
	const toast = useToast();
	const composer = useComposer();
	const session = useSession();
	const codeLineGap = () => settingsView.data()?.settings?.explorer?.lineGap ?? 0.2;
	const [liveRange, setLiveRange] = createSignal<{ start: number; end: number } | null>(null);
	const codeLineHeight = () => 1 + codeLineGap();
	const [dirs, setDirs] = createSignal<Record<string, DirState>>({});
	const [dirReal, setDirReal] = createSignal<Record<string, string>>({});
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
	const selected = () => (props.partner ? (openFiles()[props.partner] ?? null) : null);
	function setSelected(next: SelectedFile | null) {
		const partner = props.partner;
		if (!partner) return;
		setOpenFiles((prev) => {
			if ((prev[partner] ?? null) === next) return prev;
			const copy = { ...prev };
			if (next) copy[partner] = next;
			else delete copy[partner];
			return copy;
		});
	}
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
		treeScrollTop = 0;
	}

	let scope: string | null | undefined;
	createEffect(() => {
		const partner = props.partner;
		if (scope === partner) return;
		scope = partner;
		reset();
		// The reader comes back with the partner; the tree has to catch up to where that file lives.
		const remembered = partner ? untrack(() => openFiles()[partner]) : undefined;
		if (remembered) void expandTo(remembered.path);
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

	/** Opens every folder on a file's path, so the tree can show and scroll to it. */
	async function expandTo(path: string) {
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
	}

	async function revealFile(path: string, range?: RevealRange) {
		await expandTo(path);
		const segments = path.split("/").filter(Boolean);
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

	// The open file is the dock's detail layer: Esc closes it, and the pin lets go with it.
	useEscapeLayer({
		id: "explorer.detail",
		order: ESCAPE_ORDER.dockDetail,
		isOpen: () => props.open && selected() != null,
		close: () => setSelected(null),
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
		copyName: (entry) => void navigator.clipboard?.writeText(entry.name),
		copyPath: (entry) => void navigator.clipboard?.writeText(entryAbsPath(entry.path)),
		copyRelative: (entry) => void navigator.clipboard?.writeText(entry.path),
		collapseAll: () => setExpanded(new Set<string>()),
	};

	const selectedKey = () => selected()?.path ?? null;
	const rootState = () => dirs()[""];
	const crumbs = () => (shownFile()?.path || shownFile()?.name || "").split("/").filter(Boolean);
	const dirSegments = () => crumbs().slice(0, -1);
	const metrics = () => {
		const file = shownFile();
		return file ? fileMetrics(file.path, fileData()) : "";
	};
	const isRaw = () => shownFile()?.raw === true;
	const rawToggle = () => {
		const path = shownFile()?.path;
		return !!path && languageForPath(path) === "markdown";
	};
	const stampLabel = () => {
		const range = liveRange();
		if (!range) return "";
		// `liveRange` indexes lines from 0; the stamp speaks the 1-based `path#74-96` language.
		const start = range.start + 1;
		const end = range.end + 1;
		return start === end ? `${start}` : `${start}–${end}`;
	};

	function toggleRaw() {
		const file = selected();
		if (!file) return;
		setSelected({ ...file, raw: !(file.raw === true) });
	}

	function copyLiveRange() {
		const file = selected();
		if (!file || !liveRange()) return;
		void navigator.clipboard?.writeText(`${file.path}#${stampLabel()}`);
	}

	// The reference the agent can act on is the same `path#74-96` the stamp copies.
	function quoteInLetter() {
		const file = selected();
		if (!file || !liveRange()) return;
		const ref = `${file.path}#${stampLabel()}`;
		const draft = composer.drafts()[session.data.selected ?? ""] ?? "";
		composer.prefill(draft ? `${draft} ${ref} ` : `${ref} `);
	}

	// Only walk down the chain for folders that are not open and loaded yet: clicking the crumb of
	// a folder already on screen should not re-ask the workspace for its children.
	async function focusDir(path: string) {
		if (!props.partner) return;
		const open = expanded();
		const next = new Set(open);
		const missing: string[] = [];
		let current = "";
		for (const segment of path.split("/").filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			next.add(current);
			const state = dirs()[current];
			if (!state || state.status === "error") missing.push(current);
		}
		if (next.size !== open.size) setExpanded(next);
		for (const dir of missing) await loadDir(dir);
		scrollToRow(path);
	}

	const foldRule = createMemo<FoldRule | null>(() => {
		const path = shownFile()?.path;
		if (!path) return null;
		const lang = languageForPath(path);
		if (!lang) return null;
		const fold = settingsView.data()?.settings?.explorer?.fold;
		if (lang === "markdown") return fold?.markdown === false ? null : { kind: "markdown" as const };
		if (fold?.braces === false) return null;
		const brackets = BRACKET_FOLD_LANGS[lang];
		return brackets ? { kind: "brackets" as const, brackets } : null;
	});
	const rendered = () => {
		const file = shownFile();
		return !!file && file.raw !== true && languageForPath(file.path) === "markdown";
	};

	const [fileData] = createResource(shownFile, async (sel: SelectedFile): Promise<FileData | null> => {
		if (!props.partner) return null;
		const res = await rpc.request.explorer_read_file({ name: props.partner, root: "workspace", path: sel.path });
		if (!res.ok) return { error: res.error ?? "failed to read file" };
		return res.ok ? res : { error: res.error ?? "failed to read file" };
	});

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
				open: selected() != null,
				render: (leaving, list) => (
					<Show when={shownFile()}>
						{(file) => (
							<div class="explorer-reader dock-detail" classList={{ leaving }}>
								<div class="explorer-reader-head">
									<button
										type="button"
										class="dock-btn"
										classList={{ on: list.pinned }}
										aria-pressed={list.pinned}
										disabled={!list.canPin && !list.pinned}
										title={list.pinned ? "Let the file cover the letter again" : "Pin the letter beside the file"}
										onClick={() => list.togglePin()}
									>
										<Pin size={11} />
									</button>
									<Show when={list.pinned}>
										<button
											type="button"
											class="dock-btn"
											classList={{ on: list.listOpen }}
											aria-pressed={list.listOpen}
											title={list.listOpen ? "Hide the file tree" : "Show the file tree"}
											onClick={() => list.openList()}
										>
											☰
										</button>
									</Show>
									<Show when={!list.pinned}>
										<button type="button" class="explorer-back" title="Close this file" onClick={() => setSelected(null)}>
											← {props.partner}
										</button>
									</Show>
									<span class="explorer-file-name">{file().name}</span>
									<nav class="explorer-dir" aria-label="File path" title={file().path}>
										<For each={dirSegments()}>
											{(segment, index) => (
												<button
													type="button"
													class="explorer-dir-seg"
													onClick={() => {
														if (list.pinned) list.openList();
														void focusDir(
															dirSegments()
																.slice(0, index() + 1)
																.join("/"),
														);
													}}
												>
													{segment}/
												</button>
											)}
										</For>
									</nav>
									<Show when={liveRange()}>
										<button type="button" class="explorer-stamp" title={`Copy ${file().path}#${stampLabel()}`} onClick={copyLiveRange}>
											⧉ {stampLabel()}
										</button>
										<button type="button" class="explorer-quote" title={`Quote ${file().path}#${stampLabel()} in the letter`} onClick={quoteInLetter}>
											Quote
										</button>
									</Show>
									<Show when={rawToggle()}>
										<button
											type="button"
											class="explorer-raw"
											classList={{ on: isRaw() }}
											aria-pressed={isRaw()}
											title={isRaw() ? "Show rendered markdown" : "Show raw markdown"}
											onClick={toggleRaw}
										>
											Raw
										</button>
									</Show>
								</div>
								<Show
									when={!fileData.loading}
									fallback={
										<div class="explorer-reader-note">
											<span class="work-dot" />
											<span class="work-dot" />
											<span class="work-dot" />
										</div>
									}
								>
									<Show when={fileData()?.binary}>
										<div class="explorer-reader-note">binary file · preview unavailable</div>
									</Show>
									<Show when={!fileData()?.binary && fileData()?.error}>
										<div class="explorer-reader-note">{fileData()!.error}</div>
									</Show>
									<Show when={!fileData()?.binary && !fileData()?.error}>
										<Show when={rendered()}>
											<div class="explorer-reader-tools">
												<span class="explorer-metrics">{metrics()}</span>
											</div>
										</Show>
										<Show
											when={!rendered()}
											fallback={
												<div class="explorer-file-body">
													<MarkdownFile content={fileData()?.content ?? ""} frontmatter={fileData()?.frontmatter} partner={props.partner} path={shownFile()?.path} />
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
													fold={foldRule()}
													locate={file().range ?? null}
													metrics={metrics()}
													panelOpen={props.open}
													onSelection={(range) => setLiveRange(range)}
												/>
											</div>
										</Show>
										<Show when={fileData()?.truncated}>
											<div class="explorer-reader-foot">truncated · file larger than preview limit</div>
										</Show>
									</Show>
								</Show>
							</div>
						)}
					</Show>
				),
			}}
		>
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
		</DockShell>
	);
}
