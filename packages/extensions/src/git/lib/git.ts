import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { GitChange, GitChangeStatus, GitPatch, GitSides } from "../types.ts";

const MAX_BUFFER = 32 * 1024 * 1024;

/** The same ceiling the explorer previews by; a diff is not the place to read a bigger file. */
const MAX_SIDE_BYTES = 512 * 1024;

interface RunResult {
	readonly code: number;
	readonly stdout: Buffer;
	readonly stderr: Buffer;
}

const NOT_A_REPO = "not a git repository";

function run(cwd: string, args: readonly string[]): Promise<RunResult> {
	return new Promise((resolve) => {
		execFile("git", [...args], { cwd, encoding: "buffer", maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
			if (error === null) {
				resolve({ code: 0, stdout, stderr });
				return;
			}
			const code = (error as { code?: unknown }).code;
			if (typeof code === "number") {
				resolve({ code, stdout, stderr });
				return;
			}
			resolve({ code: 1, stdout, stderr: Buffer.from("git is not installed") });
		});
	});
}

const text = (bytes: Buffer): string => bytes.toString("utf8");

/** The repository the workspace sits in, or null when git does not know the path as one. */
async function repoRootOf(workspace: string): Promise<string | null> {
	const result = await run(workspace, ["rev-parse", "--show-toplevel"]);
	if (result.code === 0) {
		const root = text(result.stdout).trim();
		return root === "" ? null : root;
	}
	const message = text(result.stderr).trim();
	if (message.toLowerCase().includes(NOT_A_REPO)) return null;
	throw new Error(message || "git is not available");
}

async function rootOrThrow(workspace: string): Promise<string> {
	const root = await repoRootOf(workspace);
	if (root === null) throw new Error(NOT_A_REPO);
	return root;
}

const statusCode = (code: string): GitChangeStatus => (code === "C" ? "A" : code === "M" || code === "A" || code === "D" || code === "R" ? code : "M");

function parseStatus(stdout: string): GitChange[] {
	const changes: GitChange[] = [];
	const parts = stdout.split("\0");
	for (let index = 0; index < parts.length; index += 1) {
		const raw = parts[index];
		if (!raw) continue;
		const x = raw[0] ?? " ";
		const y = raw[1] ?? " ";
		const path = raw.slice(3);
		let from: string | undefined;
		if ((x === "R" || x === "C" || y === "R" || y === "C") && index + 1 < parts.length && parts[index + 1] !== "") {
			from = parts[index + 1];
			index += 1;
		}
		if (!path) continue;
		if (x === "?" && y === "?") changes.push({ path, status: "U", staged: false, untracked: true });
		else if (x !== " ") changes.push({ path, status: statusCode(x), staged: true, ...(from === undefined ? {} : { from }) });
		else if (y !== " ") changes.push({ path, status: statusCode(y), staged: false, ...(from === undefined ? {} : { from }) });
	}
	return changes;
}

export async function gitChanges(workspace: string): Promise<{ repoRoot: string | null; changes: GitChange[] }> {
	const repoRoot = await repoRootOf(workspace);
	if (repoRoot === null) return { repoRoot: null, changes: [] };
	const result = await run(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	if (result.code !== 0) throw new Error(text(result.stderr).trim() || "git status failed");
	return { repoRoot, changes: parseStatus(text(result.stdout)) };
}

function ensureWithin(root: string, target: string): void {
	const rel = relative(root, target);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path escapes the repository root");
}

/** Text, or a note that the bytes are not text (or are too big to read as one). */
function sideOf(bytes: Buffer | null): { text: string; binary: boolean; tooLarge: boolean } {
	if (bytes === null) return { text: "", binary: false, tooLarge: false };
	if (bytes.byteLength > MAX_SIDE_BYTES) return { text: "", binary: false, tooLarge: true };
	if (bytes.includes(0)) return { text: "", binary: true, tooLarge: false };
	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), binary: false, tooLarge: false };
	} catch {
		return { text: "", binary: true, tooLarge: false };
	}
}

/** A trailing newline is not a line, matching how the reader counts them. */
function lineCount(text: string): number {
	if (text === "") return 0;
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

/**
 * Both ends of a change: a staged change runs HEAD against the index, an unstaged one runs the index
 * against the working file. A rename reads its old name from the other end, so it does not arrive as
 * "everything added".
 */
export async function gitFileSides(workspace: string, path: string, options: { staged?: boolean; from?: string } = {}): Promise<GitSides> {
	const repoRoot = await rootOrThrow(workspace);
	const target = resolve(repoRoot, path);
	ensureWithin(repoRoot, target);
	const from = options.from ?? path;
	ensureWithin(repoRoot, resolve(repoRoot, from));
	const staged = options.staged === true;

	const blob = async (spec: string): Promise<Buffer | null> => {
		const result = await run(repoRoot, ["show", spec]);
		return result.code === 0 ? result.stdout : null;
	};

	const original = sideOf(await blob(staged ? `HEAD:${from}` : `:${from}`));
	const modified = staged ? sideOf(await blob(`:${path}`)) : sideOf(await readFile(target).catch(() => null));

	const args = ["diff", "--no-ext-diff", "--numstat"];
	if (staged) args.push("--cached");
	args.push("--", path);
	const numstat = await run(repoRoot, args);
	const [add, del] = (text(numstat.stdout).split("\n")[0] ?? "").split("\t");
	const counted = { add: Number(add) || 0, del: Number(del) || 0 };
	/* An untracked file is in no diff at all, so `--numstat` has nothing to say: the whole file is the
	   addition, and the whole old file is the removal. */
	if (counted.add === 0 && counted.del === 0 && !original.binary && !modified.binary) {
		if (original.text === "" && modified.text !== "") counted.add = lineCount(modified.text);
		else if (modified.text === "" && original.text !== "") counted.del = lineCount(original.text);
	}

	return {
		original: original.text,
		modified: modified.text,
		add: counted.add,
		del: counted.del,
		binary: original.binary || modified.binary,
		tooLarge: original.tooLarge || modified.tooLarge,
	};
}

/** The unified patch, for the one-column view and for a file a two-sided read cannot hold. */
export async function gitPatch(workspace: string, path: string, options: { staged?: boolean } = {}): Promise<GitPatch> {
	const repoRoot = await rootOrThrow(workspace);
	const target = resolve(repoRoot, path);
	ensureWithin(repoRoot, target);
	const tracked = await run(repoRoot, ["ls-files", "--error-unmatch", "--", path]);
	if (tracked.code !== 0) {
		const content = await readFile(target, "utf8").catch(() => "");
		return { kind: "new", diff: "", content };
	}
	const args = ["diff", "--no-ext-diff", "--no-color", "--unified=3"];
	if (options.staged === true) args.push("--cached");
	args.push("--", path);
	const result = await run(repoRoot, args);
	if (result.code !== 0) throw new Error(text(result.stderr).trim() || "git diff failed");
	return { kind: "diff", diff: text(result.stdout), content: "" };
}
