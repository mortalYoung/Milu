export interface MentionTarget {
	readonly path: string;
	readonly line?: number;
}

const WITH_RANGE = /^(.+?)[:#](\d+)(?:-(\d+))?$/;

export function resolveMentionToken(token: string, files: readonly string[]): MentionTarget | undefined {
	const value = token.trim();
	const match = WITH_RANGE.exec(value);
	const target = match?.[1] ?? value;
	if (target === "") return undefined;
	const line = match?.[2] === undefined ? undefined : Number(match[2]);
	const range = line === undefined || line < 1 ? {} : { line };
	if (files.includes(target)) return { path: target, ...range };
	const matches = files.filter((path) => path.endsWith(`/${target}`) || path.endsWith(`\\${target}`));
	return matches.length === 1 ? { path: matches[0]!, ...range } : undefined;
}
