/**
 * renderMarkdown unit tests: pipe table parsing (header/body/alignment/escaping), and distinguishing
 * tables from ordinary paragraphs containing |.
 */
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../mainview/lib/markdown";

describe("renderMarkdown pipe tables", () => {
	test("basic table → thead + tbody", () => {
		const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
		expect(html).toContain("<table>");
		expect(html).toContain("<thead><tr><th>A</th><th>B</th></tr></thead>");
		expect(html).toContain("<tbody><tr><td>1</td><td>2</td></tr></tbody>");
	});

	test("aligned columns (:---: center / ---: right) → style attribute", () => {
		const html = renderMarkdown("| A | B | C |\n| :---: | ---: | --- |\n| 1 | 2 | 3 |");
		expect(html).toContain('<th style="text-align:center">A</th>');
		expect(html).toContain('<th style="text-align:right">B</th>');
		expect(html).toContain("<th>C</th>");
		expect(html).toContain('<td style="text-align:center">1</td>');
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

	test("body row with missing columns renders with the columns present", () => {
		const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 |");
		expect(html).toContain("<tr><td>1</td></tr>");
	});
});
