import { parseLineRange, workspaceRelativePath } from "../../shared/file-mentions";
import { rpc } from "./rpc";

/** How many of the mentioned lines the in-letter peek shows before you escalate. */
export const CITATION_LINES = 5;

const CLASS = "md-citation";

function escapeHtml(value: string) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function basename(path: string) {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** The mention's own paragraph inside the letter — the citation lands right after it. */
function mentionBlock(mention: HTMLElement, root: Element): Element | null {
	if (!root.contains(mention)) return null;
	let node: Element = mention;
	while (node.parentElement && node.parentElement !== root) node = node.parentElement;
	return node.parentElement === root ? node : null;
}

function mount(block: Element) {
	const el = document.createElement("div");
	el.className = CLASS;
	el.innerHTML = `<div class="${CLASS}-busy"><span class="work-dot"></span><span class="work-dot"></span><span class="work-dot"></span></div>`;
	block.after(el);
	return el;
}

function render(
	el: HTMLElement,
	opts: { path: string; range: { start: number; end: number }; content: string; onEscalate: (path: string, range: { start: number; end: number }) => void },
) {
	const lines = opts.content.split("\n");
	const first = opts.range.start;
	const withinRange = opts.range.end - first + 1;
	const shown = Math.max(0, Math.min(CITATION_LINES, withinRange, lines.length - first + 1));
	if (shown === 0) {
		el.className = `${CLASS}-note`;
		el.innerHTML = "这几行已经不在这个文件里了";
		return;
	}
	const body = lines
		.slice(first - 1, first - 1 + shown)
		.map((line, index) => `<div class="${CLASS}-line"><span class="${CLASS}-no">${first + index}</span><span class="${CLASS}-text">${escapeHtml(line)}</span></div>`)
		.join("");
	const rest = withinRange - shown;
	el.innerHTML = `
		<div class="${CLASS}-head">
			<span class="${CLASS}-kicker">§</span>
			<span class="${CLASS}-path">${escapeHtml(basename(opts.path))}</span>
			<span class="${CLASS}-range">${first}–${opts.range.end}</span>
			<button type="button" class="${CLASS}-fold" aria-label="Collapse the citation" title="Collapse">⌃</button>
		</div>
		<div class="${CLASS}-code">${body}</div>
		<div class="${CLASS}-foot">
			${rest > 0 ? `<span>还有 ${rest} 行</span>` : ""}
			<button type="button" class="${CLASS}-open">展开为校样 →</button>
		</div>`;
	el.querySelector(`.${CLASS}-fold`)?.addEventListener("click", () => el.remove());
	el.querySelector(`.${CLASS}-open`)?.addEventListener("click", () => opts.onEscalate(opts.path, opts.range));
}

/**
 * A mention that carries a line range peeks in place first — the reader is one click further.
 * Clicking the same mention again collapses the peek.
 */
export async function toggleCitation(opts: {
	mention: HTMLElement;
	partner: string;
	baseDir: string | null | undefined;
	onEscalate: (path: string, range: { start: number; end: number }) => void;
}) {
	const rawPath = opts.mention.getAttribute("data-path");
	const range = parseLineRange(opts.mention.getAttribute("data-range"));
	if (!rawPath || !range) return;
	const root = opts.mention.closest(".md");
	if (!root) return;
	const block = mentionBlock(opts.mention, root);
	if (!block) return;
	const existing = block.nextElementSibling;
	if (existing?.classList.contains(CLASS)) {
		existing.remove();
		return;
	}

	const el = mount(block);
	const path = workspaceRelativePath(rawPath, opts.baseDir);
	const res = await rpc.request.explorer_read_file({ name: opts.partner, root: "workspace", path });
	if (!el.isConnected) return;
	if (!res.ok || res.content == null) {
		el.className = `${CLASS}-note`;
		el.textContent = res.error ?? "could not read this file";
		return;
	}
	render(el, { path, range, content: res.content, onEscalate: opts.onEscalate });
}
