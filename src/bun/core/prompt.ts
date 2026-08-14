/**
 * 系统提示词构建 — 四段固定框架:IDENTIFY / PERSONA / TOOL-GUIDANCE / RESPONSE-FORMAT。
 * 约定:
 * - IDENTIFY:一句话确立"你是谁、你运行在什么框架上"(框架 + 模型,系统注入,不可编辑)。
 * - PERSONA:任务角色。role 必填(角色短语,如 "Front-End Programmer");缺 role(未选
 *   Partner)时整段不生成。Responsibilities 由用户填写、无默认值,为空则不生成该部分。
 * - TOOL-GUIDANCE:每个工具"应该怎么用才正确"的指引,由工具 guidance 表动态插入;
 *   未提供 guidance 的工具回落为 name — description 清单。
 * - RESPONSE-FORMAT:最终回复格式约束(固定规则)+ Tones(用户填写、无默认值,为空则不生成)。
 * 系统提示词 = IDENTIFY + PERSONA + TOOL-GUIDANCE + RESPONSE-FORMAT。
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";

/** 提示词构建所需的字段(role 必填;name/avatar 等展示字段不进提示词)。 */
export interface PartnerPrompt {
	/** 角色短语(如 "Front-End Programmer"),必填。 */
	role?: string;
	/** 职责,用户填写;空则不生成。 */
	responsibilities?: string;
	/** 语气,用户填写;空则不生成。 */
	tones?: string;
}

/** identify 段的运行时信息(框架 / 模型),系统注入,不来自用户。 */
export interface RuntimeInfo {
	framework: string;
	model: string;
}

/** 工具 usage guidance 表:每个工具一条"这个工具应该怎么用才正确"的指引。 */
export type ToolGuidance = Record<string, string>;

/** IDENTIFY:一句话确立"你是谁、你运行在什么框架上"。 */
export function buildIdentify(runtime: RuntimeInfo): string {
	return ["# IDENTIFY", `You are an AI agent powered by the ${runtime.framework} harness, running on the ${runtime.model} model.`].join("\n");
}

/** PERSONA:角色句 + Responsibilities(用户填写,空则不生成)。role 必填,缺 role 时整段不生成。 */
export function buildPersona(partner?: PartnerPrompt | null): string {
	const role = partner?.role?.trim();
	if (!role) return "";
	const lines = ["# PERSONA", `You are a ${role}.`];
	const responsibilities = partner?.responsibilities?.trim();
	if (responsibilities) {
		lines.push("", "## Responsibilities", responsibilities);
	}
	return lines.join("\n");
}

/** TOOL-GUIDANCE:每工具"怎么用才正确";未提供 guidance 的工具回落 name — description 清单。 */
export function buildToolGuidance(tools: AgentTool[] = [], guidance: ToolGuidance = {}): string {
	const entries = tools.map((t) => (guidance[t.name] ? `- ${t.name}: ${guidance[t.name]}` : `- ${t.name} — ${t.description}`));
	return ["# TOOL-GUIDANCE", ...entries].join("\n");
}

/** RESPONSE-FORMAT:固定格式规则 + Tones(用户填写,空则不生成)。 */
export function buildResponseFormat(partner?: PartnerPrompt | null): string {
	const lines = [
		"# RESPONSE-FORMAT",
		"When you successfully create or modify files, mention the primary outputs in your final response.",
		"To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path.",
	];
	const tones = partner?.tones?.trim();
	if (tones) {
		lines.push("", "## Tones", tones);
	}
	return lines.join("\n");
}

/** 系统提示词 = IDENTIFY + PERSONA + TOOL-GUIDANCE + RESPONSE-FORMAT。 */
export function buildSystemPrompt(
	partner: PartnerPrompt | null,
	tools: AgentTool[] = [],
	guidance: ToolGuidance = {},
	runtime: RuntimeInfo = { framework: "CODING DESKTOP", model: "deepseek-v4-flash" },
): string {
	return [buildIdentify(runtime), buildPersona(partner), buildToolGuidance(tools, guidance), buildResponseFormat(partner)].filter(Boolean).join("\n\n");
}
