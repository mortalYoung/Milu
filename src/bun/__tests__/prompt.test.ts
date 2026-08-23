/**
 * Unit tests for the system prompt framework: IDENTIFY / PERSONA / WORKSPACE / STORAGE / RESPONSE-FORMAT.
 * Coverage: fixed order, runtime injection, role required, Responsibilities/Tones omitted when empty,
 * no-Partner fallback.
 */
import { describe, expect, test } from "bun:test";
import { buildIdentify, buildPersona, buildResponseFormat, buildSystemPrompt, type PartnerPrompt, type RuntimeInfo } from "../core/prompt";

const RUNTIME: RuntimeInfo = { framework: "LETTERS", model: "deepseek-v4-flash" };

const PARTNER: PartnerPrompt = {
	responsibilities: "Ship features end-to-end.",
	tones: "Short and plain.",
};

describe("buildSystemPrompt framework", () => {
	test("all sections present in fixed order IDENTIFY → PERSONA → WORKSPACE → STORAGE → RESPONSE-FORMAT", () => {
		const p = buildSystemPrompt(PARTNER, RUNTIME);
		const idx = ["# IDENTIFY", "# PERSONA", "# WORKSPACE", "# STORAGE", "# RESPONSE-FORMAT"].map((h) => p.indexOf(h));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx.every((i) => i >= 0)).toBe(true);
	});

	test("IDENTIFY injects the framework and model names (system-fixed, not from the user)", () => {
		const p = buildIdentify(RUNTIME);
		expect(p).toContain("LETTERS");
		expect(p).toContain("deepseek-v4-flash");
	});

	test("PERSONA: fixed role sentence + Responsibilities generated when present", () => {
		const p = buildPersona(PARTNER);
		expect(p).toContain("You are an agent running in Partner App.");
		expect(p).toContain("## Responsibilities");
		expect(p).toContain("Ship features end-to-end.");
	});

	test("PERSONA: Responsibilities empty → that part is not generated", () => {
		const p = buildPersona({});
		expect(p).toContain("You are an agent running in Partner App.");
		expect(p).not.toContain("## Responsibilities");
	});

	test("PERSONA section is always present (the role sentence is fixed)", () => {
		expect(buildPersona(null)).toContain("You are an agent running in Partner App.");
		const p = buildSystemPrompt(null, RUNTIME);
		expect(p).toContain("# PERSONA");
	});

	test("RESPONSE-FORMAT: Tones generated when present, omitted when empty", () => {
		const withTones = buildResponseFormat(PARTNER);
		expect(withTones).toContain("## Tones");
		expect(withTones).toContain("Short and plain.");
		const withoutTones = buildResponseFormat({});
		expect(withoutTones).not.toContain("## Tones");
	});

	test("WORKSPACE and STORAGE are always present and static (no embedded paths)", () => {
		const p1 = buildSystemPrompt(PARTNER, RUNTIME);
		const p2 = buildSystemPrompt(PARTNER, RUNTIME);
		expect(p1).toContain("# WORKSPACE");
		expect(p1).toContain("# STORAGE");
		expect(p1).not.toContain("/tmp/storage");
		expect(p1.indexOf("# WORKSPACE")).toBeLessThan(p1.indexOf("# STORAGE"));
		// Stable prefix: identical across builds → KV cache reuse
		expect(p1).toBe(p2);
	});

	test("WORKSPACE instructs the model to establish the workspace via set_workspace as the first tool call", () => {
		const p = buildSystemPrompt(PARTNER, RUNTIME);
		expect(p).toContain("set_workspace");
		expect(p).toContain("first tool call");
	});
});
