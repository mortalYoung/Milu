import type { MarkdownIt } from "markdown-it";

export interface MarkdownEnv {
	readonly files?: readonly string[];
	readonly session?: string;
	readonly [key: string]: unknown;
}

export interface MarkdownPort {
	render(text: string, env?: MarkdownEnv): string;
	renderFull(text: string, env?: MarkdownEnv): Promise<string>;
	warm(): void;
}

export type MarkdownTier = "both" | "full";

export interface MarkdownPlugin {
	readonly id: string;
	readonly order: number;
	readonly tier?: MarkdownTier;
	readonly source?: (text: string, env: MarkdownEnv) => string;
	readonly setup?: (md: MarkdownIt) => void | Promise<void>;
	readonly html?: (html: string, env: MarkdownEnv) => string;
}
