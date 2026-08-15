/**
 * Unit tests for the four-section system prompt framework: IDENTIFY / PERSONA / TOOL-GUIDANCE / RESPONSE-FORMAT.
 * Coverage: fixed order, runtime injection, role required, Responsibilities/Tones omitted when empty,
 * guidance table insertion and fallback, no-Partner fallback.
 */
import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildIdentify, buildPersona, buildResponseFormat, buildSystemPrompt, buildToolGuidance, type PartnerPrompt, type RuntimeInfo } from "../core/prompt";
import { TOOL_GUIDANCE } from "../tools";

const RUNTIME: RuntimeInfo = { framework: "CODING DESKTOP", model: "deepseek-v4-flash" };

// custom is not in the guidance table; used to verify the fallback behavior
const TOOLS = [
	{ name: "read", description: "Read a file" },
	{ name: "bash", description: "Run a shell command" },
	{ name: "custom", description: "A custom tool" },
] as unknown as AgentTool[];

const PARTNER: PartnerPrompt = {
	role: "Front-End Programmer",
	responsibilities: "Ship features end-to-end.",
	tones: "Short and plain.",
};

describe("buildSystemPrompt four-section framework", () => {
	test("all four sections present in fixed order IDENTIFY → PERSONA → TOOL-GUIDANCE → RESPONSE-FORMAT", () => {
		const p = buildSystemPrompt(PARTNER, TOOLS, TOOL_GUIDANCE, RUNTIME);
		const idx = ["# IDENTIFY", "# PERSONA", "# TOOL-GUIDANCE", "# RESPONSE-FORMAT"].map((h) => p.indexOf(h));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx.every((i) => i >= 0)).toBe(true);
	});

	test("IDENTIFY injects the framework and model names (system-fixed, not from the user)", () => {
		const p = buildIdentify(RUNTIME);
		expect(p).toContain("CODING DESKTOP");
		expect(p).toContain("deepseek-v4-flash");
	});

	test("PERSONA: role renders the role sentence; Responsibilities generated when present", () => {
		const p = buildPersona(PARTNER);
		expect(p).toContain("You are a Front-End Programmer.");
		expect(p).toContain("## Responsibilities");
		expect(p).toContain("Ship features end-to-end.");
	});

	test("PERSONA: Responsibilities empty → that part is not generated", () => {
		const p = buildPersona({ role: "Writer" });
		expect(p).toContain("You are a Writer.");
		expect(p).not.toContain("## Responsibilities");
	});

	test("missing role (no Partner) → PERSONA section entirely omitted", () => {
		expect(buildPersona(null)).toBe("");
		const p = buildSystemPrompt(null, TOOLS, TOOL_GUIDANCE, RUNTIME);
		expect(p).not.toContain("# PERSONA");
	});

	test("TOOL-GUIDANCE: tools in the guidance table get guidance, others fall back to name — description", () => {
		const p = buildToolGuidance(TOOLS, TOOL_GUIDANCE);
		expect(p).toContain("- read: Use the read tool");
		expect(p).toContain("- bash: Check the [exit code: N] marker");
		expect(p).toContain("- custom — A custom tool");
	});

	test("RESPONSE-FORMAT: Tones generated when present, omitted when empty", () => {
		const withTones = buildResponseFormat(PARTNER);
		expect(withTones).toContain("## Tones");
		expect(withTones).toContain("Short and plain.");
		const withoutTones = buildResponseFormat({ role: "Writer" });
		expect(withoutTones).not.toContain("## Tones");
	});

	test("STORAGE: section generated when a storage path is given, omitted otherwise", () => {
		const withStorage = buildSystemPrompt(PARTNER, TOOLS, TOOL_GUIDANCE, RUNTIME, "/tmp/storage");
		expect(withStorage).toContain("# STORAGE");
		expect(withStorage).toContain("Your storage path is /tmp/storage.");
		expect(withStorage.indexOf("# STORAGE")).toBeGreaterThan(withStorage.indexOf("# RESPONSE-FORMAT"));
		const withoutStorage = buildSystemPrompt(PARTNER, TOOLS, TOOL_GUIDANCE, RUNTIME);
		expect(withoutStorage).not.toContain("# STORAGE");
	});
});
