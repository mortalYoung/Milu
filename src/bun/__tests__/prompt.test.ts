import { describe, expect, test } from "bun:test";
import { buildIdentify, buildPersona, buildSystemPrompt, type PartnerPrompt } from "../core/prompt";

const PARTNER: PartnerPrompt = {
	persona: "Ship features end-to-end.\nSpeak short and plain.",
};

describe("buildSystemPrompt framework", () => {
	test("all sections present in fixed order IDENTIFY → PERSONA → WORKING DIRECTORY → STORAGE", () => {
		const p = buildSystemPrompt(PARTNER);
		const idx = ["# IDENTIFY", "# PERSONA", "# WORKING DIRECTORY", "# STORAGE"].map((h) => p.indexOf(h));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx.every((i) => i >= 0)).toBe(true);
	});

	test("IDENTIFY is a static role sentence (no runtime injection)", () => {
		const p = buildIdentify();
		expect(p).toContain("You are a helpful software engineer assistant");
		expect(p).not.toMatch(/model|framework|LETTERS/i);
	});

	test("PERSONA: persona generated when present (role sentence lives in IDENTIFY, not duplicated)", () => {
		const p = buildPersona(PARTNER);
		expect(p).not.toContain("You are an agent running in Partner App.");
		expect(p).toContain("Ship features end-to-end.");
		expect(p).toContain("Speak short and plain.");
	});

	test("PERSONA: persona empty → section omitted entirely", () => {
		const p = buildPersona({});
		expect(p).toBe("");
	});

	test("PERSONA section appears only when persona exists", () => {
		expect(buildPersona(null)).toBe("");
		const withPersona = buildSystemPrompt(PARTNER);
		expect(withPersona).toContain("# PERSONA");
		const withoutPersona = buildSystemPrompt(null);
		expect(withoutPersona).not.toContain("# PERSONA");
	});

	test("PERSONA no longer splits into Responsibilities / Tones subheadings", () => {
		const p = buildPersona(PARTNER);
		expect(p).not.toContain("## Responsibilities");
		expect(p).not.toContain("## Tones");
	});

	test("RESPONSE-FORMAT section is gone from the system prompt", () => {
		const p = buildSystemPrompt(PARTNER);
		expect(p).not.toContain("# RESPONSE-FORMAT");
		expect(p).not.toContain("mention the primary outputs");
	});

	test("WORKING DIRECTORY and STORAGE are always present and static (no embedded paths)", () => {
		const p1 = buildSystemPrompt(PARTNER);
		const p2 = buildSystemPrompt(PARTNER);
		expect(p1).toContain("# WORKING DIRECTORY");
		expect(p1).toContain("# STORAGE");
		expect(p1).not.toContain("/tmp/storage");
		expect(p1.indexOf("# WORKING DIRECTORY")).toBeLessThan(p1.indexOf("# STORAGE"));
		expect(p1).toBe(p2);
	});

	test("WORKING DIRECTORY section explains relative-path resolution and the absolute-path fallback", () => {
		const p = buildSystemPrompt(PARTNER);
		expect(p).toContain("# WORKING DIRECTORY");
		expect(p).toContain("file tools require absolute paths");
		expect(p).not.toContain("set_workspace");
	});
});
