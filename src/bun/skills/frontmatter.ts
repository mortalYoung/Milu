import { parse } from "yaml";
import type { SkillInvocationPolicy } from "./types";

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedSkill {
	name: string;
	description: string;
	whenToUse?: string;
	metadata?: Record<string, unknown>;
	invocation: SkillInvocationPolicy;
	content: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function boolValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (["true", "yes", "on", "1"].includes(v)) return true;
		if (["false", "no", "off", "0"].includes(v)) return false;
	}
	if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
	return undefined;
}

export function parseSkillFile(text: string): ParsedSkill | null {
	const match = FRONTMATTER_RE.exec(text);
	if (!match) return null;
	let front: Record<string, unknown>;
	try {
		const parsed = parse(match[1]);
		front = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return null;
	}
	const name = typeof front["name"] === "string" ? front["name"].trim() : "";
	if (!SKILL_NAME_RE.test(name)) return null;
	const description = typeof front["description"] === "string" ? front["description"].trim() : "";
	if (!description) return null;

	const disableModel = boolValue(front["disable-model-invocation"]);
	const userInvocable = boolValue(front["user-invocable"]);
	if (disableModel === undefined && front["disable-model-invocation"] !== undefined) return null;
	if (userInvocable === undefined && front["user-invocable"] !== undefined) return null;

	const whenToUse = typeof front["whenToUse"] === "string" && front["whenToUse"].trim() ? front["whenToUse"].trim() : undefined;
	const metadata = front["metadata"] && typeof front["metadata"] === "object" && !Array.isArray(front["metadata"]) ? (front["metadata"] as Record<string, unknown>) : undefined;

	return {
		name,
		description,
		...(whenToUse ? { whenToUse } : {}),
		...(metadata ? { metadata } : {}),
		invocation: {
			modelInvocable: disableModel === undefined ? true : !disableModel,
			userInvocable: userInvocable === undefined ? true : userInvocable,
		},
		content: text.slice(match[0].length).trimStart(),
	};
}
