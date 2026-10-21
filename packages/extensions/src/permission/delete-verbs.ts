const DELETE_VERBS = new Set(["rm", "rmdir"]);

const WRAPPERS = new Set(["sudo", "doas", "command", "env", "nice", "nohup", "exec", "builtin", "xcrun", "xargs", "time"]);

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);

const MAX_DEPTH = 3;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const QUOTES = /^["']|["']$/g;

export interface DeleteVerbHit {
	readonly verb: string;
	readonly word: string;
}

function unquote(text: string): string {
	return text.replace(QUOTES, "");
}

function verbOf(text: string): string {
	const bare = unquote(text).replace(/^\\/, "");
	return bare.slice(bare.lastIndexOf("/") + 1);
}

function payloadOf(shell: string, args: string[]): string | null {
	const verb = verbOf(shell);
	if (verb === "eval") {
		for (const argument of args) if (!argument.startsWith("-")) return argument;
		return null;
	}
	const at = args.indexOf("-c");
	return at < 0 ? null : (args[at + 1] ?? null);
}

export function findDeleteVerbs(command: string, depth = 0): DeleteVerbHit[] {
	const hits: DeleteVerbHit[] = [];
	for (const segment of command.split(/[;&|\n]/)) {
		const words = segment
			.trim()
			.split(/\s+/)
			.filter((word) => word !== "" && !ASSIGNMENT.test(word));
		let head = 0;
		while (head < words.length && WRAPPERS.has(verbOf(words[head] ?? ""))) head += 1;
		const word = words[head];
		if (!word) continue;
		const verb = verbOf(word);
		if (DELETE_VERBS.has(verb)) hits.push({ verb, word });
		if (depth >= MAX_DEPTH || !(SHELLS.has(verb) || verb === "eval")) continue;
		const payload = payloadOf(word, words.slice(head + 1).map(unquote));
		if (payload) hits.push(...findDeleteVerbs(payload, depth + 1));
	}
	return hits;
}

export function deleteDeniedText(hits: readonly DeleteVerbHit[], trash: string): string {
	const first = hits[0];
	if (!first) return "";
	const verbs = [...new Set(hits.map((hit) => hit.verb))].map((verb) => `\`${verb}\``).join(" / ");
	return [
		`Strict delete mode refuses ${verbs} here — matched \`${first.word}\`.`,
		"Move the paths to the trash instead:",
		`\n\tmv <path> ${trash}/\n`,
		"The files stay on disk and can be brought back.",
	].join(" ");
}
