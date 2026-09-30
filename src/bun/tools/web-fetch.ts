import { DEFAULT_WEB_FETCH_USER_AGENT } from "../../shared/brand";

export interface WebFetchOptions {
	timeoutMs?: number;
	maxBytes?: number;
	maxChars?: number;
	userAgent?: string;
	signal?: AbortSignal;
}

export interface WebFetchResult {
	url: string;
	statusCode: number;
	kind: "html" | "text";
	content: string;
	truncated: boolean;
}

export type WebFetchErrorCode = "invalid-url" | "unsupported-protocol" | "timeout" | "network" | "too-large" | "unsupported-content-type" | "empty";

export class WebFetchError extends Error {
	constructor(
		public code: WebFetchErrorCode,
		message: string,
	) {
		super(message);
		this.name = "WebFetchError";
	}
}

const DEFAULTS = { timeoutMs: 15000, maxBytes: 1_000_000, maxChars: 50_000, userAgent: DEFAULT_WEB_FETCH_USER_AGENT };

export function webFetchOptions(settings?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string }) {
	return {
		timeoutMs: settings?.timeoutMs ?? DEFAULTS.timeoutMs,
		maxBytes: settings?.maxBytes ?? DEFAULTS.maxBytes,
		maxChars: settings?.maxChars ?? DEFAULTS.maxChars,
		userAgent: settings?.userAgent?.trim() || DEFAULTS.userAgent,
	};
}

export async function fetchPage(rawUrl: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
	if (!rawUrl || !rawUrl.trim()) throw new WebFetchError("invalid-url", "URL is empty");
	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new WebFetchError("invalid-url", `Invalid URL: ${rawUrl}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new WebFetchError("unsupported-protocol", `Only http and https are supported, got ${parsed.protocol}`);
	}
	const cfg = webFetchOptions(opts);
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, cfg.timeoutMs);
	const onOuterAbort = () => controller.abort();
	opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
	let response: Response;
	try {
		response = await fetch(parsed, {
			signal: controller.signal,
			redirect: "follow",
			headers: { "user-agent": cfg.userAgent, accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.8" },
		});
	} catch (e) {
		throw new WebFetchError(timedOut ? "timeout" : "network", e instanceof Error ? e.message : String(e));
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener("abort", onOuterAbort);
	}
	let bytes: Uint8Array;
	try {
		bytes = await readBodyLimited(response, cfg.maxBytes);
	} catch (e) {
		if (e instanceof WebFetchError) throw e;
		throw new WebFetchError(timedOut ? "timeout" : "network", e instanceof Error ? e.message : String(e));
	}
	if (bytes.byteLength === 0) throw new WebFetchError("empty", "Response body is empty");
	const contentType = response.headers.get("content-type") ?? "";
	const kind = classifyContentType(contentType);
	if (kind === "unsupported") {
		throw new WebFetchError("unsupported-content-type", `Unsupported content type: ${contentType || "unknown"}`);
	}
	const decoded = new TextDecoder("utf-8").decode(bytes);
	const plain = kind === "html" ? htmlToText(decoded) : decoded;
	const truncated = plain.length > cfg.maxChars;
	return {
		url: response.url || parsed.toString(),
		statusCode: response.status,
		kind,
		content: truncated ? plain.slice(0, cfg.maxChars) : plain,
		truncated,
	};
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.byteLength;
				if (total > maxBytes) throw new WebFetchError("too-large", `Response exceeds ${maxBytes} bytes`);
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function classifyContentType(contentType: string): "html" | "text" | "unsupported" {
	const mime = contentType.split(";")[0].trim().toLowerCase();
	if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
	if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "application/javascript" || mime === "application/x-javascript") {
		return "text";
	}
	return "unsupported";
}

function htmlToText(html: string): string {
	let s = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(head|title|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ");
	s = s.replace(/<li[^>]*>/gi, "\n- ");
	s = s.replace(/<[^>]+>/g, (tag) => {
		const t = tag.toLowerCase();
		if (/^<br\s*\/?>/.test(t) || /^<\/(p|div|li|h[1-6]|tr|table|ul|ol|section|article|blockquote|pre|hr)>/.test(t)) return "\n";
		if (/^<(p|div|h[1-6]|tr|li|section|article|blockquote|pre|hr)[\s>]/.test(t)) return "\n";
		return " ";
	});
	s = s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
	s = s
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();
	return s;
}
