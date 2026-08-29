/**
 * renderMarkdown unit tests (markdown-it + shiki): pipe tables (header/body/alignment/escaping),
 * distinguishing tables from ordinary paragraphs containing |, and inline formatting.
 */
import { describe, expect, test } from "bun:test";
import { renderMarkdown, renderMarkdownReady } from "../../mainview/lib/markdown";

describe("renderMarkdown pipe tables", () => {
	test("basic table → thead + tbody", () => {
		const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
		expect(html).toContain("<table>");
		expect(html).toContain("<th>A</th>");
		expect(html).toContain("<th>B</th>");
		expect(html).toContain("<td>1</td>");
		expect(html).toContain("<td>2</td>");
	});

	test("aligned columns (:---: center / ---: right) → style attribute", () => {
		const html = renderMarkdown("| A | B | C |\n| :---: | ---: | --- |\n| 1 | 2 | 3 |");
		expect(html).toContain('<th style="text-align:center">A</th>');
		expect(html).toContain('<th style="text-align:right">B</th>');
		expect(html).toContain("<th>C</th>");
		expect(html).toContain('<td style="text-align:center">1</td>');
		expect(html).toContain('<td style="text-align:right">2</td>');
	});

	test("cell content escaped + inline formatting", () => {
		const html = renderMarkdown("| Name |\n| --- |\n| <script>alert(1)</script> |");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		const bold = renderMarkdown("| Name |\n| --- |\n| **bold** |");
		expect(bold).toContain("<td><strong>bold</strong></td>");
	});

	test("single | line without a separator row is not a table, stays a paragraph", () => {
		const html = renderMarkdown("a | b");
		expect(html).not.toContain("<table>");
		expect(html).toContain("<p>a | b</p>");
	});

	test("paragraph after a table renders normally", () => {
		const html = renderMarkdown("| A |\n| --- |\n| 1 |\n\nhello");
		expect(html).toContain("<table>");
		expect(html).toContain("<p>hello</p>");
	});

	test("body row with missing columns renders with an empty cell", () => {
		const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 |");
		expect(html).toContain("<td>1</td>");
		expect(html).toContain("<td></td>");
	});

	test("single-asterisk italic renders as <em>, bold stays intact", () => {
		const html = renderMarkdown("a *note* for you");
		expect(html).toContain("<em>note</em>");
		const both = renderMarkdown("**bold** and *italic*");
		expect(both).toContain("<strong>bold</strong>");
		expect(both).toContain("<em>italic</em>");
		// double asterisks are not split by the italic rule
		expect(both).not.toContain("<em>*bold");
	});

	test("italic inside table cells and Chinese text", () => {
		const table = renderMarkdown("| K |\n| --- |\n| *小信息* |");
		expect(table).toContain("<td><em>小信息</em></td>");
	});
});

describe("renderMarkdown CJK-friendly emphasis", () => {
	test("bold containing CJK punctuation glued to a Han char renders bold", () => {
		const html = renderMarkdown("1. 在 **`createAgent` 层（turn 边界）**包 `runPrompt`/`continue`，不包装 stream（遵循参考原则）");
		expect(html).toContain("<strong><code>createAgent</code> 层（turn 边界）</strong>");
		expect(html).not.toContain("**<code>createAgent</code>");
	});

	test("bold starting right after a Han char before CJK punctuation opens", () => {
		const html = renderMarkdown("包**（加粗）**后");
		expect(html).toContain("包<strong>（加粗）</strong>后");
	});

	test("strikethrough gets the same CJK-friendly flanking", () => {
		const html = renderMarkdown("~~（删除）~~包");
		expect(html).toContain("<s>（删除）</s>");
	});

	test("underscore emphasis keeps strict CommonMark intraword behavior", () => {
		const html = renderMarkdown("_中文_包");
		expect(html).not.toContain("<em>");
		expect(html).toContain("_中文_包");
	});

	test("non-Han text keeps CommonMark flanking (no change for ASCII)", () => {
		const html = renderMarkdown("**a(x)**b");
		expect(html).not.toContain("<strong>");
		expect(html).toContain("**a(x)**b");
	});
});

describe("renderMarkdown code blocks (shiki highlighting)", () => {
	test("fenced code block with language is highlighted", async () => {
		const html = await renderMarkdownReady("```ts\nconst x: number = 1\n```");
		expect(html).toContain("<pre");
		expect(html).toContain("shiki");
		expect(html).toContain("language-ts");
		// shiki wraps tokens in spans with color styles
		expect(html).toContain("<span");
	});

	test("unknown language falls back to plain text, content still escaped", async () => {
		const html = await renderMarkdownReady("```nosuchlang\n<script>alert(1)</script>\n```");
		expect(html).toContain("<pre");
		expect(html).toContain("language-text");
		// shiki escapes HTML as numeric entities (&#x3C;), never raw tags
		expect(html).not.toContain("<script>alert");
	});
});
