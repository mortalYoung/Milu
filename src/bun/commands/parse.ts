const COMMAND_RE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u;

export function parseCommand(line: string): { name: string; rawInput: string } | null {
	const match = COMMAND_RE.exec(line);
	if (!match) return null;
	return { name: match[1], rawInput: line.slice(match[0].length) };
}
