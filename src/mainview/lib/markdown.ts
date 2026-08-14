/**
 * 迷你 markdown → HTML 渲染器(安全子集)。
 * 支持:标题(#/##/###)、粗体、行内代码、围栏代码块、无序/有序列表、
 * 引用、链接。先转义 HTML 再做变换,用户内容不会被当作标签执行。
 */

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内变换:转义 → 行内代码 → 粗体 → 链接。 */
function inline(s: string): string {
	return esc(s)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
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

	for (const raw of lines) {
		// 围栏代码块
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
		if (!t) {
			flushAll();
			continue;
		}
		// 标题
		const h = t.match(/^(#{1,6}) (.*)$/);
		if (h) {
			flushAll();
			out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
			continue;
		}
		// 引用
		if (t.startsWith("> ")) {
			flushAll();
			out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`);
			continue;
		}
		// 列表
		const listMatch = t.match(/^(?:[-*] |\d+\. )(.*)$/);
		if (listMatch) {
			flushPara();
			const type = /^\d+\. /.test(t) ? "ol" : "ul";
			if (list && list.type !== type) flushList();
			(list ??= { type, items: [] }).items.push(inline(listMatch[1]));
			continue;
		}
		// 普通段落行
		flushList();
		para.push(inline(t));
	}

	if (inCode) out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
	flushAll();
	return out.join("\n");
}
