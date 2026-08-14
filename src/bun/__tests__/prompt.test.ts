/**
 * 系统提示词四段框架单测:IDENTIFY / PERSONA / TOOL-GUIDANCE / RESPONSE-FORMAT。
 * 覆盖:顺序固定、运行时注入、role 必填、Responsibilities/Tones 空则不生成、
 * guidance 表插入与回落、无 Partner 兜底。
 */
import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildIdentify, buildPersona, buildResponseFormat, buildSystemPrompt, buildToolGuidance, type PartnerPrompt, type RuntimeInfo } from "../core/prompt";
import { TOOL_GUIDANCE } from "../tools";

const RUNTIME: RuntimeInfo = { framework: "CODING DESKTOP", model: "deepseek-v4-flash" };

// custom 不在 guidance 表,用于验证回落行为
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

describe("buildSystemPrompt 四段框架", () => {
	test("四段齐全且顺序固定 IDENTIFY → PERSONA → TOOL-GUIDANCE → RESPONSE-FORMAT", () => {
		const p = buildSystemPrompt(PARTNER, TOOLS, TOOL_GUIDANCE, RUNTIME);
		const idx = ["# IDENTIFY", "# PERSONA", "# TOOL-GUIDANCE", "# RESPONSE-FORMAT"].map((h) => p.indexOf(h));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx.every((i) => i >= 0)).toBe(true);
	});

	test("IDENTIFY 注入框架名与模型名(系统固定,不来自用户)", () => {
		const p = buildIdentify(RUNTIME);
		expect(p).toContain("CODING DESKTOP");
		expect(p).toContain("deepseek-v4-flash");
	});

	test("PERSONA:role 渲染角色句;Responsibilities 有值时生成", () => {
		const p = buildPersona(PARTNER);
		expect(p).toContain("You are a Front-End Programmer.");
		expect(p).toContain("## Responsibilities");
		expect(p).toContain("Ship features end-to-end.");
	});

	test("PERSONA:Responsibilities 为空则不生成该部分", () => {
		const p = buildPersona({ role: "Writer" });
		expect(p).toContain("You are a Writer.");
		expect(p).not.toContain("## Responsibilities");
	});

	test("缺 role(无 Partner)时 PERSONA 整段不生成", () => {
		expect(buildPersona(null)).toBe("");
		const p = buildSystemPrompt(null, TOOLS, TOOL_GUIDANCE, RUNTIME);
		expect(p).not.toContain("# PERSONA");
	});

	test("TOOL-GUIDANCE:guidance 表内工具插入指引,表外回落 name — description", () => {
		const p = buildToolGuidance(TOOLS, TOOL_GUIDANCE);
		expect(p).toContain("- read: Use the read tool");
		expect(p).toContain("- bash: Check the [exit code: N] marker");
		expect(p).toContain("- custom — A custom tool");
	});

	test("RESPONSE-FORMAT:Tones 有值时生成,为空则不生成", () => {
		const withTones = buildResponseFormat(PARTNER);
		expect(withTones).toContain("## Tones");
		expect(withTones).toContain("Short and plain.");
		const withoutTones = buildResponseFormat({ role: "Writer" });
		expect(withoutTones).not.toContain("## Tones");
	});
});
