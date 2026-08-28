/** Exact slash-command parse: lowercase-letter start, then a-z/0-9/_/-, followed by whitespace or EOL. */
const COMMAND_RE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u;

export function parseCommand(line: string): { name: string; rawInput: string } | null {
	const match = COMMAND_RE.exec(line);
	if (!match) return null;
	return { name: match[1], rawInput: line.slice(match[0].length) };
}
