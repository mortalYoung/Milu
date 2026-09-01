import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchPage } from "../tools/web-fetch";

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/html") {
				return new Response("<html><head><title>Hi</title></head><body><h1>Hello</h1><p>World <b>bold</b></p><script>alert(1)</script></body></html>", {
					headers: { "content-type": "text/html" },
				});
			}
			if (url.pathname === "/text") return new Response("plain text", { headers: { "content-type": "text/plain" } });
			if (url.pathname === "/json") return new Response('{"a":1}', { headers: { "content-type": "application/json" } });
			if (url.pathname === "/missing") return new Response("<h1>Not Found</h1>", { status: 404, headers: { "content-type": "text/html" } });
			if (url.pathname === "/redirect") return Response.redirect(`${base}/html`, 302);
			if (url.pathname === "/big") return new Response("x".repeat(1_000_000), { headers: { "content-type": "text/plain" } });
			if (url.pathname === "/slow") {
				return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("late", { headers: { "content-type": "text/plain" } })), 500));
			}
			if (url.pathname === "/pdf") return new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
			return new Response("not found", { status: 404 });
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

describe("web_fetch fetchPage", () => {
	test("html page returns cleaned text", async () => {
		const r = await fetchPage(`${base}/html`);
		expect(r.kind).toBe("html");
		expect(r.content).toContain("Hello");
		expect(r.content).toContain("World");
		expect(r.content).not.toContain("<");
		expect(r.content).not.toContain("alert");
		expect(r.truncated).toBe(false);
	});

	test("plain text returns as-is", async () => {
		const r = await fetchPage(`${base}/text`);
		expect(r.kind).toBe("text");
		expect(r.content).toBe("plain text");
	});

	test("json returns as text", async () => {
		const r = await fetchPage(`${base}/json`);
		expect(r.kind).toBe("text");
		expect(r.content).toBe('{"a":1}');
	});

	test("404 returns status and body instead of throwing", async () => {
		const r = await fetchPage(`${base}/missing`);
		expect(r.statusCode).toBe(404);
		expect(r.content).toContain("Not Found");
	});

	test("redirect follows to final url", async () => {
		const r = await fetchPage(`${base}/redirect`);
		expect(r.url).toBe(`${base}/html`);
		expect(r.statusCode).toBe(200);
	});

	test("non-http url is rejected", async () => {
		await expect(fetchPage("ftp://example.com")).rejects.toMatchObject({ code: "unsupported-protocol" });
	});

	test("empty url is rejected", async () => {
		await expect(fetchPage("   ")).rejects.toMatchObject({ code: "invalid-url" });
	});

	test("oversized response is rejected without buffering everything", async () => {
		await expect(fetchPage(`${base}/big`, { maxBytes: 1000 })).rejects.toMatchObject({ code: "too-large" });
	});

	test("slow response times out", async () => {
		await expect(fetchPage(`${base}/slow`, { timeoutMs: 50 })).rejects.toMatchObject({ code: "timeout" });
	});

	test("binary content type is rejected", async () => {
		await expect(fetchPage(`${base}/pdf`)).rejects.toMatchObject({ code: "unsupported-content-type" });
	});

	test("external abort propagates as network error", async () => {
		const ac = new AbortController();
		const p = fetchPage(`${base}/slow`, { signal: ac.signal });
		ac.abort();
		await expect(p).rejects.toMatchObject({ code: "network" });
	});

	test("character limit truncates content", async () => {
		const r = await fetchPage(`${base}/text`, { maxChars: 4 });
		expect(r.content).toBe("plai");
		expect(r.truncated).toBe(true);
	});
});
