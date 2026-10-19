export interface MarkdownEnv {
	readonly files?: readonly string[];
	readonly session?: string;
	readonly [key: string]: unknown;
}

export interface MarkdownPort {
	render(text: string, env?: MarkdownEnv): string;
	renderFull(text: string, env?: MarkdownEnv): Promise<string>;
}
