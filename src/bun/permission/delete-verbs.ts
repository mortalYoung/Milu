import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DELETE_VERBS = new Set(["rm", "rmdir"]);

const WRAPPERS = new Set(["sudo", "doas", "command", "env", "nice", "nohup", "exec", "builtin", "xcrun", "xargs", "time"]);

const OPTIONS_WITH_VALUE: Record<string, Set<string>> = {
	sudo: new Set(["-u", "--user", "-g", "--group", "-C", "--chdir", "-p", "--prompt", "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user"]),
	doas: new Set(["-u", "-C"]),
	env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string", "-s"]),
	nice: new Set(["-n", "--adjustment"]),
	time: new Set(["-f", "--format", "-o", "--output"]),
	xargs: new Set(["-I", "-i", "-n", "-E", "-e", "-s", "-a", "-d", "-P", "--replace", "--max-args", "--max-chars", "--eof", "--delimiter", "--arg-file", "--max-procs"]),
};

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);

const MAX_DEPTH = 3;

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const QUOTES_RE = /^["']|["']$/g;

export interface DeleteVerbHit {
	verb: string;
	word: string;
	line: number;
	column: number;
}

interface TsNode {
	type: string;
	text: string;
	startPosition: { row: number; column: number };
	children: (TsNode | null)[];
}

interface TsParser {
	setLanguage(language: unknown): void;
	parse(code: string): { rootNode: TsNode } | null;
}

const RUNTIME_WASM = "tree-sitter.wasm";
const GRAMMAR_WASM = "tree-sitter-bash.wasm";

function moduleDir(): string {
	return dirname(fileURLToPath(import.meta.url));
}

function locateWasm(file: string): string | null {
	const candidates = [
		join(moduleDir(), "wasm", file),
		join(process.cwd(), "node_modules", "web-tree-sitter", file),
		join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", file),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

let parserPromise: Promise<TsParser | null> | null = null;
let degraded = false;

function warnDegraded(reason: string): void {
	if (degraded) return;
	degraded = true;
	console.error("delete gate degraded to the word scan:", reason);
}

function getParser(): Promise<TsParser | null> {
	parserPromise ??= (async () => {
		const runtime = locateWasm(RUNTIME_WASM);
		const grammar = locateWasm(GRAMMAR_WASM);
		if (!runtime || !grammar) {
			warnDegraded(`${runtime ? GRAMMAR_WASM : RUNTIME_WASM} not found near ${moduleDir()}`);
			return null;
		}
		try {
			const { Language, Parser } = await import("web-tree-sitter");
			await Parser.init({ locateFile: () => runtime });
			const parser = new Parser();
			parser.setLanguage(await Language.load(grammar));
			return parser as unknown as TsParser;
		} catch (error) {
			warnDegraded(error instanceof Error ? error.message : String(error));
			return null;
		}
	})();
	return parserPromise;
}

function children(node: TsNode): TsNode[] {
	return node.children.filter((child): child is TsNode => child !== null);
}

function commandNodes(node: TsNode, out: TsNode[] = []): TsNode[] {
	if (node.type === "command") out.push(node);
	for (const child of children(node)) commandNodes(child, out);
	return out;
}

function unquote(text: string): string {
	return text.replace(QUOTES_RE, "");
}

function verbOf(text: string): string {
	const bare = unquote(text).replace(/^\\/, "");
	return bare.slice(bare.lastIndexOf("/") + 1);
}

function commandName(node: TsNode): TsNode | undefined {
	return children(node).find((child) => child.type === "command_name");
}

function argumentNodes(node: TsNode): TsNode[] {
	const name = commandName(node);
	const out: TsNode[] = [];
	let seenName = false;
	for (const child of children(node)) {
		if (child === name) {
			seenName = true;
			continue;
		}
		if (!seenName) continue;
		if (child.type === "file_redirect" || child.type === "heredoc_redirect") continue;
		out.push(child);
	}
	return out;
}

function unwrap(wrapper: string, args: string[]): { name: string; rest: string[] } | null {
	const withValue = OPTIONS_WITH_VALUE[verbOf(wrapper)] ?? new Set<string>();
	for (let i = 0; i < args.length; i++) {
		const text = args[i];
		if (ASSIGNMENT_RE.test(text)) continue;
		if (text.startsWith("-")) {
			if (withValue.has(text)) i += 1;
			continue;
		}
		return { name: text, rest: args.slice(i + 1) };
	}
	return null;
}

function payloadOf(shell: string, args: string[]): string | null {
	const verb = verbOf(shell);
	if (verb === "eval") {
		for (const arg of args) if (!arg.startsWith("-")) return arg;
		return null;
	}
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== "-c") continue;
		return args[i + 1] ?? null;
	}
	return null;
}

export interface CommandPosition {
	line: number;
	column: number;
}

export type CommandVisitor = (name: string, args: string[], position: CommandPosition | null) => void;

async function walkCommands(command: string, depth: number, visit: CommandVisitor): Promise<boolean> {
	if (depth > MAX_DEPTH || command.trim() === "") return true;
	const parser = await getParser();
	if (!parser) return false;
	let tree: { rootNode: TsNode } | null;
	try {
		tree = parser.parse(command);
	} catch (error) {
		parserPromise = null;
		warnDegraded(error instanceof Error ? error.message : String(error));
		return false;
	}
	degraded = false;
	if (!tree) return true;
	const root = tree.rootNode;
	const nested = depth > 0;
	for (const node of commandNodes(root)) {
		const name = commandName(node);
		if (!name) continue;
		const verb = verbOf(name.text);
		const args = argumentNodes(node).map((arg) => unquote(arg.text));
		const position = nested ? null : { line: name.startPosition.row, column: name.startPosition.column };
		visit(unquote(name.text), args, position);
		if (WRAPPERS.has(verb)) {
			const wrapped = unwrap(verb, args);
			if (!wrapped) continue;
			const inner = verbOf(wrapped.name);
			visit(wrapped.name, wrapped.rest, position);
			if (SHELLS.has(inner) || inner === "eval") {
				const payload = payloadOf(wrapped.name, wrapped.rest);
				if (payload) await walkCommands(payload, depth + 1, visit);
			}
			continue;
		}
		if (SHELLS.has(verb) || verb === "eval") {
			const payload = payloadOf(name.text, args);
			if (payload) await walkCommands(payload, depth + 1, visit);
		}
	}
	return true;
}

function scanDeleteVerbs(command: string, depth = 0): DeleteVerbHit[] {
	const hits: DeleteVerbHit[] = [];
	for (const segment of command.split(/[;&|\n]/)) {
		const words = segment
			.trim()
			.split(/\s+/)
			.filter((word) => word !== "" && !ASSIGNMENT_RE.test(word));
		let head = 0;
		while (head < words.length && WRAPPERS.has(verbOf(words[head]!))) head += 1;
		const word = words[head];
		if (!word) continue;
		const verb = verbOf(word);
		if (DELETE_VERBS.has(verb)) hits.push({ verb, word, line: -1, column: -1 });
		if (depth >= MAX_DEPTH || !(SHELLS.has(verb) || verb === "eval")) continue;
		const payload = payloadOf(word, words.slice(head + 1).map(unquote));
		if (payload) hits.push(...scanDeleteVerbs(payload, depth + 1));
	}
	return hits;
}

export async function findDeleteVerbs(command: string): Promise<DeleteVerbHit[]> {
	const hits: DeleteVerbHit[] = [];
	const walked = await walkCommands(command, 0, (name, _args, position) => {
		const verb = verbOf(name);
		if (DELETE_VERBS.has(verb)) hits.push({ verb, word: name, line: position?.line ?? -1, column: position?.column ?? -1 });
	});
	return walked ? hits : scanDeleteVerbs(command);
}

const TRASH_TAILS = new Set(["trash", ".Trash", ".trash"]);

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

export async function movesToTrash(command: string, trashDir: string): Promise<boolean> {
	let moved = false;
	const walked = await walkCommands(command, 0, (name, args) => {
		if (moved || verbOf(name) !== "mv") return;
		const operands = args.filter((arg) => !arg.startsWith("-"));
		const flagIndex = args.findIndex((arg) => ["-t", "--target-directory"].includes(arg));
		const dest = flagIndex >= 0 ? (args[flagIndex + 1] ?? "") : (operands.at(-1) ?? "");
		if (dest !== "" && isTrashPath(dest, trashDir)) moved = true;
	});
	if (walked) return moved;
	return command.split(/\s+/).some((word) => isTrashPath(unquote(word).replace(/[;,|&)]+$/, ""), trashDir));
}
