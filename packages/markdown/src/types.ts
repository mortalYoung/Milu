import type { MarkdownEnv } from "@milu/client";
import type { MarkdownIt } from "markdown-it";

export type { MarkdownEnv, MarkdownPort } from "@milu/client";

export type MarkdownTier = "both" | "full";

export interface MarkdownPlugin {
	readonly id: string;
	readonly order: number;
	readonly tier?: MarkdownTier;
	readonly source?: (text: string, env: MarkdownEnv) => string;
	readonly setup?: (md: MarkdownIt) => void | Promise<void>;
	readonly html?: (html: string, env: MarkdownEnv) => string;
}
