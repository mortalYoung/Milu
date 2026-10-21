import { homedir } from "node:os";
import { join } from "node:path";

const DELETE_VERBS = new Set(["rm", "rmdir"]);

const WRAPPERS = new Set(["sudo", "doas", "command", "env", "nice", "nohup", "exec", "builtin", "xcrun", "xargs", "time"]);

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);

const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "{", "(", "}", "!", "time"]);

const MAX_DEPTH = 3;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const QUOTES = /^["']|["']$/g;

const PREFIX = /^[({!\\]+/;

const TRASH_TAILS = new Set(["trash", ".Trash", ".trash"]);

export interface DeleteVerbHit {
	readonly verb: string;
	readonly word: string;
}

interface Head {
	readonly verb: string;
	readonly word: string;
	readonly args: string[];
}

function unquote(text: string): string {
	return text.replace(QUOTES, "");
}

function verbOf(text: string): string {
	const bare = unquote(text).replace(PREFIX, "");
	return bare.slice(bare.lastIndexOf("/") + 1);
}

function headsOf(command: string): Head[] {
	const heads: Head[] = [];
	for (const segment of command.split(/[;&|\n]/)) {
		const words = segment
			.trim()
			.split(/\s+/)
			.filter((word) => word !== "" && !ASSIGNMENT.test(word));
		let at = 0;
		while (at < words.length && (KEYWORDS.has(unquote(words[at] ?? "")) || WRAPPERS.has(verbOf(words[at] ?? "")))) at += 1;
		const word = words[at];
		if (!word) continue;
		const verb = verbOf(word);
		if (verb === "") continue;
		heads.push({ verb, word, args: words.slice(at + 1).map(unquote) });
	}
	return heads;
}

function substitutionsOf(command: string): string[] {
	const found: string[] = [];
	for (let at = 0; at < command.length; at += 1) {
		if (command[at] === "$" && command[at + 1] === "(") {
			let depth = 1;
			let end = at + 2;
			for (; end < command.length && depth > 0; end += 1) {
				if (command[end] === "(") depth += 1;
				else if (command[end] === ")") depth -= 1;
			}
			if (depth !== 0) break;
			found.push(command.slice(at + 2, end - 1));
			at = end - 1;
			continue;
		}
		if (command[at] !== "`") continue;
		const close = command.indexOf("`", at + 1);
		if (close < 0) break;
		found.push(command.slice(at + 1, close));
		at = close;
	}
	return found;
}

function payloadOf(verb: string, args: string[]): string | null {
	if (verb === "eval") {
		for (const argument of args) if (!argument.startsWith("-")) return argument;
		return null;
	}
	const at = args.indexOf("-c");
	return at < 0 ? null : (args[at + 1] ?? null);
}

export function findDeleteVerbs(command: string, depth = 0): DeleteVerbHit[] {
	const hits: DeleteVerbHit[] = [];
	for (const head of headsOf(command)) {
		if (DELETE_VERBS.has(head.verb)) hits.push({ verb: head.verb, word: unquote(head.word).replace(PREFIX, "") });
		if (depth >= MAX_DEPTH || !(SHELLS.has(head.verb) || head.verb === "eval")) continue;
		const payload = payloadOf(head.verb, head.args);
		if (payload) hits.push(...findDeleteVerbs(payload, depth + 1));
	}
	if (depth < MAX_DEPTH) {
		for (const inner of substitutionsOf(command)) hits.push(...findDeleteVerbs(inner, depth + 1));
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

function expandHome(text: string): string {
	if (text === "~") return homedir();
	return text.startsWith("~/") ? join(homedir(), text.slice(2)) : text;
}

function isTrashPath(text: string, trashDir: string): boolean {
	const path = expandHome(text).replace(/\/+$/, "");
	if (path === trashDir || path.startsWith(`${trashDir}/`)) return true;
	const tail = path.split("/").pop() ?? "";
	return TRASH_TAILS.has(tail);
}

export function movesToTrash(command: string, trashDir: string, depth = 0): boolean {
	for (const head of headsOf(command)) {
		if (head.verb !== "mv") continue;
		const flagIndex = head.args.findIndex((arg) => arg === "-t" || arg === "--target-directory");
		const destination = flagIndex >= 0 ? (head.args[flagIndex + 1] ?? "") : (head.args.filter((arg) => !arg.startsWith("-")).at(-1) ?? "");
		if (destination !== "" && isTrashPath(destination.replace(/[;,|&)]+$/, ""), trashDir)) return true;
	}
	if (depth >= MAX_DEPTH) return false;
	for (const inner of substitutionsOf(command)) {
		if (movesToTrash(inner, trashDir, depth + 1)) return true;
	}
	return false;
}
