/**
 * Unit tests for the system prompt framework: IDENTIFY / PERSONA / WORKSPACE / STORAGE.
 * Coverage: fixed order, runtime injection, role required, Responsibilities/Tones omitted when empty,
 * no-Partner fallback.
 */
import { describe, expect, test } from "bun:test";
import { buildIdentify, buildPersona, buildSystemPrompt, type PartnerPrompt } from "../core/prompt";

const PARTNER: PartnerPrompt = {
	responsibilities: "Ship features end-to-end.",
	tones: "Short and plain.",
};

describe("buildSystemPrompt framework", () => {
	test("all sections present in fixed order IDENTIFY → PERSONA → WORKSPACE → STORAGE", () => {
		const p = buildSystemPrompt(PARTNER);
		const idx = ["# IDENTIFY", "# PERSONA", "# WORKSPACE", "# STORAGE"].map((h) => p.indexOf(h));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx.every((i) => i >= 0)).toBe(true);
	});

	test("IDENTIFY is a static role sentence (no runtime injection)", () => {
		const p = buildIdentify();
		expect(p).toContain("You are a helpful software engineer assistant");
		expect(p).not.toMatch(/model|framework|LETTERS/i);
	});

	test("PERSONA: Responsibilities generated when present (role sentence lives in IDENTIFY, not duplicated)", () => {
		const p = buildPersona(PARTNER);
		expect(p).not.toContain("You are an agent running in Partner App.");
		expect(p).toContain("## Responsibilities");
		expect(p).toContain("Ship features end-to-end.");
	});

	test("PERSONA: Responsibilities empty → section omitted entirely", () => {
		const p = buildPersona({});
		expect(p).toBe("");
	});

	test("PERSONA section appears only when responsibilities exist", () => {
		expect(buildPersona(null)).toBe("");
		const withPersona = buildSystemPrompt(PARTNER);
		expect(withPersona).toContain("# PERSONA");
		const withoutPersona = buildSystemPrompt(null);
		expect(withoutPersona).not.toContain("# PERSONA");
	});

	test("PERSONA: Tones generated when present (moved under PERSONA), omitted when empty", () => {
		const withTones = buildPersona(PARTNER);
		expect(withTones).toContain("## Tones");
		expect(withTones).toContain("Short and plain.");
		const withoutTones = buildPersona({ responsibilities: "Ship features" });
		expect(withoutTones).not.toContain("## Tones");
	});

	test("RESPONSE-FORMAT section is gone from the system prompt", () => {
		const p = buildSystemPrompt(PARTNER);
		expect(p).not.toContain("# RESPONSE-FORMAT");
		expect(p).not.toContain("mention the primary outputs");
	});

	test("WORKSPACE and STORAGE are always present and static (no embedded paths)", () => {
		const p1 = buildSystemPrompt(PARTNER);
		const p2 = buildSystemPrompt(PARTNER);
		expect(p1).toContain("# WORKSPACE");
		expect(p1).toContain("# STORAGE");
		expect(p1).not.toContain("/tmp/storage");
		expect(p1.indexOf("# WORKSPACE")).toBeLessThan(p1.indexOf("# STORAGE"));
		// Stable prefix: identical across builds → KV cache reuse
		expect(p1).toBe(p2);
	});

	test("WORKSPACE instructs the model to establish the workspace via set_workspace as the first tool call", () => {
		const p = buildSystemPrompt(PARTNER);
		expect(p).toContain("set_workspace");
		expect(p).toContain("first tool call");
	});
});
