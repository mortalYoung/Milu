/**
 * Mini markdown → HTML renderer (safe subset).
 * Supports: headings (#/##/###), bold, inline code, fenced code blocks, unordered/ordered lists,
 * quotes, links, pipe tables (including :---: alignment). HTML is escaped before any transformation,
 * so user content is never executed as tags.
 */

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline transforms: escape → inline code → bold → links. */
function inline(s: string): string {
	return esc(s)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/** Pipe tables: strip the leading/trailing pipes, then split by | and trim. */
function cellSplit(line: string): string[] {
	const inner = line.trim();
	const body = inner.startsWith("|") ? inner.slice(1) : inner;
	const trimmed = body.endsWith("|") ? body.slice(0, -1) : body;
	return trimmed.split("|").map((s) => s.trim());
}

/** Separator row: every cell matches :?---:? and at least one contains -. */
function isSeparatorRow(cells: string[]): boolean {
	return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c)) && cells.some((c) => c.includes("-"));
}

/** Aligned-column style (value comes from the parsed fixed three-way choice, not user input). */
function alignAttr(align: string): string {
	return align === "left" ? "" : ` style="text-align:${align}"`;
}

export function renderMarkdown(src: string): string {
	const lines = src.split("\n");
	const out: string[] = [];
	let inCode = false;
	let codeBuf: string[] = [];
	let list: { type: "ul" | "ol"; items: string[] } | null = null;
	let para: string[] = [];

	const flushList = () => {
		if (list) {
			const tag = list.type === "ol" ? "ol" : "ul";
			out.push(`<${tag}>${list.items.map((li) => `<li>${li}</li>`).join("")}</${tag}>`);
			list = null;
		}
	};
	const flushPara = () => {
		if (para.length) {
			out.push(`<p>${para.join(" ")}</p>`);
			para = [];
		}
	};
	const flushAll = () => {
		flushList();
		flushPara();
	};

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		// Fenced code blocks
		if (raw.trimStart().startsWith("```")) {
			flushAll();
			if (inCode) {
				out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
				inCode = false;
				codeBuf = [];
			} else {
				inCode = true;
			}
			continue;
		}
		if (inCode) {
			codeBuf.push(esc(raw));
			continue;
		}

		const t = raw.trim();
		// Pipe table: the current line contains | and the next line is a separator row (---)
		if (t.includes("|")) {
			const headCells = cellSplit(raw);
			const sepCells = lines[i + 1] ? cellSplit(lines[i + 1]) : [];
			if (headCells.length > 0 && isSeparatorRow(sepCells) && sepCells.length === headCells.length) {
				flushAll();
				const aligns = sepCells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
				const rows: string[][] = [headCells];
				i += 2;
				while (i < lines.length && lines[i].trim().includes("|")) {
					rows.push(cellSplit(lines[i]));
					i += 1;
				}
				const head = rows[0].map((c, j) => `<th${alignAttr(aligns[j] ?? "left")}>${inline(c)}</th>`).join("");
				const body = rows
					.slice(1)
					.filter((r) => r.length > 0)
					.map((r) => `<tr>${r.map((c, j) => `<td${alignAttr(aligns[j] ?? "left")}>${inline(c)}</td>`).join("")}</tr>`)
					.join("");
				out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
				continue;
			}
		}

		if (!t) {
			flushAll();
			continue;
		}
		// Heading
		const h = t.match(/^(#{1,6}) (.*)$/);
		if (h) {
			flushAll();
			out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
			continue;
		}
		// Quote
		if (t.startsWith("> ")) {
			flushAll();
			out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`);
			continue;
		}
		// List
		const listMatch = t.match(/^(?:[-*] |\d+\. )(.*)$/);
		if (listMatch) {
			flushPara();
			const type = /^\d+\. /.test(t) ? "ol" : "ul";
			if (list && list.type !== type) flushList();
			(list ??= { type, items: [] }).items.push(inline(listMatch[1]));
			continue;
		}
		// Plain paragraph line
		flushList();
		para.push(inline(t));
	}

	if (inCode) out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
	flushAll();
	return out.join("\n");
}
