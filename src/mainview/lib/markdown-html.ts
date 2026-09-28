/**
 * A small allowlist of HTML that documents actually use, lifted out of the source before markdown-it
 * sees it and put back as **constructed** tags afterwards.
 *
 * markdown-it runs with `html: false`, so raw HTML is escaped and shows up as literal text. That is
 * right for chat, but wrong for a file preview: `<details>` sections, in-page anchor targets and
 * screenshots inside a docs table are how those files are written — this repo's own skill README has
 * all three. Turning on `html: true` would fix it by trusting the whole language, which is not a
 * trade worth making in a view that holds the RPC bridge (an agent or a repo file could then inject
 * script). Instead we recognise a short list of shapes, read only the attributes we need, and emit
 * the tags ourselves — source markup is never copied through, so there is nothing to sanitize.
 */

const SLOT_OPEN = "\uE000";
const SLOT_CLOSE = "\uE001";
const SLOT_RE = /\uE000(\d+)\uE001/g;
const BLOCK_SLOT_RE = /<p>\s*\uE000(\d+)\uE001\s*<\/p>/g;
const BLOCK_LEAD = "^([ \\t]*(?:[-*+]|\\d{1,9}[.)]|>)?[ \\t]*)";
const BLOCK_TAIL = "[ \\t]*\\r?$";
const CODE_OPEN = "\uE002";
const CODE_CLOSE = "\uE003";
const CODE_RE = /\uE002(\d+)\uE003/g;
const FENCE_RE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2[^\n]*|$)/g;
const CODE_SPAN_RE = /(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g;

export interface SubsetEnv {
	/** Raw `src` → data URL, for relative images the renderer itself cannot read. */
	images?: ReadonlyMap<string, string>;
}

interface RestoreContext {
	env: SubsetEnv;
	/** Render a slice of markdown through the same pipeline (details bodies). */
	render: (source: string) => string;
	/** Render a single line as inline markdown (summary text). */
	renderInline: (source: string) => string;
}

interface Slot {
	block: boolean;
	fill: (ctx: RestoreContext) => string;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Attribute names are matched, never trusted: anything not listed here is dropped. */
function attributesOf(raw: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw) return out;
	for (const match of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
		out[(match[1] ?? "").toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
	}
	if (/(^|\s)open(\s|$)/i.test(raw)) out["open"] = "";
	return out;
}

/** Only the schemes a document may link to; control characters cannot smuggle a scheme past this. */
function safeHref(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	const value = raw.trim().replace(/[\u0000-\u001f\u007f]/g, "");
	if (value === "") return null;
	if (value.startsWith("#")) return value;
	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
	if (scheme === undefined) return value;
	return scheme === "http" || scheme === "https" || scheme === "mailto" ? value : null;
}

export function renderImageHtml(src: string, alt: string, attrs: Record<string, string>, images: SubsetEnv["images"]): string {
	const width = /^\d{1,4}$/.test(attrs["width"] ?? "") ? ` width="${attrs["width"]}"` : "";
	const height = /^\d{1,4}$/.test(attrs["height"] ?? "") ? ` style="height:${attrs["height"]}px"` : "";
	const resolved = images?.get(src);
	if (resolved) return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}"${width}${height} loading="lazy">`;
	if (/^https?:/i.test(src)) return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${width}${height} loading="lazy" referrerpolicy="no-referrer">`;
	// A relative path names a file the view cannot read on its own; it becomes a chip that says so,
	// and the preview upgrades it to a real image once it has resolved the bytes.
	return `<span class="md-image" data-md-src="${escapeHtml(src)}" title="${escapeHtml(alt || src)}">${escapeHtml(alt || src)}</span>`;
}

function linkHtml(href: string | null, inner: string): string {
	return href === null ? inner : `<a href="${escapeHtml(href)}">${inner}</a>`;
}

/**
 * Replace recognised HTML with placeholders. Later passes cannot see earlier ones: a placeholder
 * carries no `<`, and a `<details>` body is kept as source (not scanned) so nested markup inside it
 * goes through the pipeline later, in order.
 */
export function extractHtmlSubset(source: string): { source: string; slots: Slot[] } {
	const slots: Slot[] = [];
	const hold = (block: boolean, fill: Slot["fill"]): string => {
		slots.push({ block, fill });
		return `${SLOT_OPEN}${slots.length - 1}${SLOT_CLOSE}`;
	};

	const code: string[] = [];
	const stash = (match: string): string => {
		code.push(match);
		return `${CODE_OPEN}${code.length - 1}${CODE_CLOSE}`;
	};

	let out = source.replace(FENCE_RE, stash).replace(CODE_SPAN_RE, stash);

	// <div align="center"> … </div>
	out = out.replace(new RegExp(`${BLOCK_LEAD}<div\\s+([^>]*?)>([\\s\\S]*?)<\\/div>${BLOCK_TAIL}`, "gim"), (match, lead: string, rawAttrs: string, inner: string) => {
		const align = (attributesOf(rawAttrs)["align"] ?? "").trim().toLowerCase();
		if (align !== "center") return match;
		return lead + hold(true, (ctx) => `<div class="md-center">${ctx.render(inner)}</div>`);
	});

	// <h1>…</h1> through <h6>
	out = out.replace(
		new RegExp(`${BLOCK_LEAD}<h([1-6])(?:\\s[^>]*)?>([\\s\\S]*?)<\\/h\\2>${BLOCK_TAIL}`, "gim"),
		(_match, lead: string, level: string, inner: string) => lead + hold(true, (ctx) => `<h${level}>${ctx.renderInline(inner)}</h${level}>`),
	);

	// <sub>…</sub> / <sup>…</sup>
	out = out.replace(/<(sub|sup)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_match, tag: string, inner: string) => hold(false, (ctx) => `<${tag}>${ctx.renderInline(inner)}</${tag}>`));

	// <details open?> … <summary>…</summary> …body… </details>
	out = out.replace(
		new RegExp(`${BLOCK_LEAD}<details(\\s[^>]*?)?>([\\s\\S]*?)<\\/details>${BLOCK_TAIL}`, "gim"),
		(_match, lead: string, rawAttrs: string | undefined, inner: string) => {
			const open = "open" in attributesOf(rawAttrs);
			const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
			const body = summary ? inner.slice(0, summary.index) + inner.slice(summary.index + summary[0].length) : inner;
			const title = (summary?.[1] ?? "details").replace(/<[^>]*>/g, "").trim();
			return (
				lead +
				hold(true, (ctx) => {
					const label = summary ? ctx.renderInline(title) : escapeHtml(title);
					return `<details${open ? " open" : ""}><summary>${label}</summary>${ctx.render(body)}</details>`;
				})
			);
		},
	);

	// <a name="x"></a> / <a id="x"></a> — an in-page jump target, invisible by nature.
	out = out.replace(/<a\s+(?:name|id)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>\s*<\/a>/gi, (_match, double: string | undefined, single: string | undefined) => {
		const id = (double ?? single ?? "").trim();
		if (id === "") return "";
		return hold(true, () => `<a id="${escapeHtml(id)}" class="md-anchor" aria-hidden="true"></a>`);
	});

	// <a href="…"><img …></a> — the docs-table screenshot.
	out = out.replace(/<a\s+([^>]*?)>\s*(<img\s+[^>]*?>)\s*<\/a>/gi, (_match, linkAttrs: string, imgTag: string) => {
		const href = safeHref(attributesOf(linkAttrs)["href"]);
		const img = attributesOf(imgTag.replace(/^<img/i, ""));
		const src = img["src"] ?? "";
		return hold(false, (ctx) => linkHtml(href, renderImageHtml(src, img["alt"] ?? "", img, ctx.env.images)));
	});

	// <img …> on its own.
	out = out.replace(/<img\s+[^>]*?>/gi, (tag) => {
		const img = attributesOf(tag.replace(/^<img/i, ""));
		const src = img["src"] ?? "";
		return hold(false, (ctx) => renderImageHtml(src, img["alt"] ?? "", img, ctx.env.images));
	});

	// <a href="…">text</a> with plain text inside.
	out = out.replace(/<a\s+([^>]*?)>([^<]*)<\/a>/gi, (_match, linkAttrs: string, text: string) => {
		const href = safeHref(attributesOf(linkAttrs)["href"]);
		const label = text.trim();
		if (label === "") return "";
		return hold(false, (ctx) => linkHtml(href, ctx.renderInline(label)));
	});

	out = out.replace(/<br\s*\/?>/gi, () => hold(false, () => "<br>"));

	return { source: out.replace(CODE_RE, (_match, digits: string) => code[Number(digits)] ?? ""), slots };
}

/** Put the constructed tags back, unwrapping the paragraph markdown-it wrapped around block slots. */
export function restoreHtmlSubset(html: string, slots: Slot[], ctx: RestoreContext): string {
	if (slots.length === 0) return html;
	const after = html.replace(BLOCK_SLOT_RE, (match, digits: string) => {
		const slot = slots[Number(digits)];
		return slot?.block ? slot.fill(ctx) : match;
	});
	return after.replace(SLOT_RE, (_match, digits: string) => slots[Number(digits)]?.fill(ctx) ?? "");
}
