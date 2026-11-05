import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import type { GitChange, GitChangeStatus, GitPatch, GitSides, GitWorktree, GitWorktrees } from "../types.ts";

const MAX_BUFFER = 32 * 1024 * 1024;

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

async function canonical(path: string): Promise<string> {
	return realpath(path).catch(() => resolve(path));
}

function contains(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function parseWorktrees(stdout: string): GitWorktree[] {
	const worktrees: GitWorktree[] = [];
	for (const block of stdout.split("\n\n")) {
		let path: string | null = null;
		let branch: string | null = null;
		let head: string | null = null;
		for (const line of block.split("\n")) {
			if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
			else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
			else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		}
		if (path !== null) worktrees.push({ path, branch, head });
	}
	return worktrees;
}

export async function gitWorktrees(workspace: string): Promise<GitWorktrees> {
	const repoRoot = await rootOrThrow(workspace);
	const result = await run(repoRoot, ["worktree", "list", "--porcelain"]);
	if (result.code !== 0) throw new Error(text(result.stderr).trim() || "git worktree list failed");
	const worktrees = parseWorktrees(text(result.stdout));
	const here = await canonical(workspace);
	const containing: GitWorktree[] = [];
	for (const tree of worktrees) {
		const root = await canonical(tree.path);
		if (contains(root, here)) containing.push(tree);
	}
	containing.sort((left, right) => right.path.length - left.path.length);
	return { repoRoot, current: containing[0]?.path ?? null, worktrees };
}

export async function gitWorktreeAdd(workspace: string, path: string, branch: string, base: string): Promise<void> {
	const ref = `refs/heads/${branch}`;
	const checked = await run(workspace, ["show-ref", "--verify", "--quiet", ref]);
	if (checked.code === 0) {
		const added = await run(workspace, ["worktree", "add", path, branch]);
		if (added.code !== 0) throw new Error(text(added.stderr).trim() || "git worktree add failed");
		return;
	}
	if (checked.code !== 1) throw new Error(text(checked.stderr).trim() || "git show-ref failed");
	const added = await run(workspace, ["worktree", "add", "-b", branch, path, base]);
	if (added.code !== 0) throw new Error(text(added.stderr).trim() || "git worktree add failed");
}

export async function gitWorktreeRemove(workspace: string, path: string): Promise<void> {
	const removed = await run(workspace, ["worktree", "remove", path]);
	if (removed.code !== 0) throw new Error(text(removed.stderr).trim() || "git worktree remove failed");
}

export interface WorkspaceFacts {
	readonly kind: "repo" | "worktree" | "dir";
	readonly repo: string | null;
	readonly branch: string | null;
	readonly detached: boolean;
}

export async function gitWorkspaceFacts(workspace: string): Promise<WorkspaceFacts> {
	try {
		const found = await gitWorktrees(workspace);
		const main = found.worktrees[0];
		if (main === undefined) return { kind: "dir", repo: null, branch: null, detached: false };
		const here = await canonical(found.current ?? workspace);
		const mainPath = await canonical(main.path);
		const current = found.worktrees.find((tree) => tree.path === found.current);
		return {
			kind: mainPath === here ? "repo" : "worktree",
			repo: basename(main.path),
			branch: current?.branch ?? null,
			detached: current?.branch === null,
		};
	} catch {
		return { kind: "dir", repo: null, branch: null, detached: false };
	}
}

function ensureWithin(root: string, target: string): void {
	const rel = relative(root, target);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path escapes the repository root");
}

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

function lineCount(text: string): number {
	if (text === "") return 0;
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

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
