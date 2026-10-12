import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPath, isInside } from "../permission/roots";

export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChange {
	path: string;
	status: GitChangeStatus;
	staged: boolean;
	untracked?: boolean;
	/** For a rename or copy: the name the file had before. */
	from?: string;
}

export interface GitChangesResult {
	repoRoot: string;
	changes: GitChange[];
}

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const code = await proc.exited;
	return { code, stdout, stderr };
}

export async function gitRepoRoot(workspace: string): Promise<string> {
	const res = await runGit(workspace, ["rev-parse", "--show-toplevel"]);
	if (res.code !== 0) throw new Error(res.stderr.trim() || "not a git repository");
	return res.stdout.trim();
}

function statusCode(code: string): GitChangeStatus {
	if (code === "?") return "U";
	if (code === "C") return "A";
	return (["M", "A", "D", "R"].includes(code) ? code : "M") as GitChangeStatus;
}

function parseStatus(stdout: string): GitChange[] {
	const changes: GitChange[] = [];
	const parts = stdout.split("\0");
	for (let i = 0; i < parts.length; i++) {
		const raw = parts[i];
		if (!raw) continue;
		const x = raw[0] ?? " ";
		const y = raw[1] ?? " ";
		const path = raw.slice(3);
		let from: string | undefined;
		if ((x === "R" || x === "C" || y === "R" || y === "C") && i + 1 < parts.length && parts[i + 1] !== "") {
			from = parts[i + 1];
			i += 1;
		}
		if (!path) continue;
		if (x === "?" && y === "?") {
			changes.push({ path, status: "U", staged: false, untracked: true });
		} else if (x !== " ") {
			changes.push({ path, status: statusCode(x), staged: true, ...(from ? { from } : {}) });
		} else if (y !== " ") {
			changes.push({ path, status: statusCode(y), staged: false, ...(from ? { from } : {}) });
		}
	}
	return changes;
}

export async function gitChanges(workspace: string): Promise<GitChangesResult> {
	const repoRoot = await gitRepoRoot(workspace);
	const res = await runGit(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	if (res.code !== 0) throw new Error(res.stderr.trim() || "git status failed");
	return { repoRoot, changes: parseStatus(res.stdout) };
}

export interface GitOverview {
	changeCount: number;
	worktreeCount: number;
}

export async function gitOverview(workspace: string): Promise<GitOverview> {
	const [status, worktrees] = await Promise.all([
		runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		runGit(workspace, ["worktree", "list", "--porcelain"]),
	]);
	if (status.code !== 0) throw new Error(status.stderr.trim() || "not a git repository");
	if (worktrees.code !== 0) throw new Error(worktrees.stderr.trim() || "git worktree list failed");
	return { changeCount: parseStatus(status.stdout).length, worktreeCount: parseWorktrees(worktrees.stdout).length };
}

export interface GitWorktree {
	path: string;
	/** Short branch name, or null when the worktree has a detached HEAD. */
	branch: string | null;
	head: string | null;
}

export interface GitWorktreesResult {
	worktrees: GitWorktree[];
	/** The worktree the workspace lives in — the row to mark as current. */
	current: string | null;
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

/** Every working tree of the repo `workspace` belongs to, main checkout first, plus the one it sits in. */
export async function gitWorktrees(workspace: string): Promise<GitWorktreesResult> {
	const repoRoot = await gitRepoRoot(workspace);
	const res = await runGit(repoRoot, ["worktree", "list", "--porcelain"]);
	if (res.code !== 0) throw new Error(res.stderr.trim() || "git worktree list failed");
	const worktrees = parseWorktrees(res.stdout);
	const here = canonicalPath(workspace);
	const containing = worktrees.filter((worktree) => isInside(here, canonicalPath(worktree.path)));
	containing.sort((a, b) => b.path.length - a.path.length);
	return { worktrees, current: containing[0]?.path ?? null };
}

function ensureWithin(root: string, target: string): void {
	const rel = relative(root, target);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path escapes repository root");
}

export async function gitDiff(workspace: string, path: string, opts: { staged?: boolean } = {}): Promise<{ kind: "diff"; diff: string } | { kind: "new"; content: string }> {
	const repoRoot = await gitRepoRoot(workspace);
	const target = resolve(repoRoot, path);
	ensureWithin(repoRoot, target);
	const tracked = await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", path]);
	if (tracked.code !== 0) {
		const content = await readFile(target, "utf8").catch(() => "");
		return { kind: "new", content };
	}
	const args = ["diff", "--no-ext-diff", "--no-color", "--unified=3"];
	if (opts.staged) args.push("--cached");
	args.push("--", path);
	const res = await runGit(repoRoot, args);
	if (res.code !== 0) throw new Error(res.stderr.trim() || "git diff failed");
	return { kind: "diff", diff: res.stdout };
}

/** The same ceiling the file preview reads by; a diff is not the place to read a bigger file. */
const MAX_SIDE_BYTES = 512 * 1024;

export interface GitFileSides {
	original: string;
	modified: string;
	/** Added and removed lines, straight from git rather than counted out of a patch. */
	add: number;
	del: number;
	/** A side is not text: there is no line-by-line reading to show. */
	binary: boolean;
	/** A side is larger than the preview ceiling. */
	tooLarge: boolean;
}

async function runGitBytes(cwd: string, args: string[]): Promise<{ code: number; bytes: Uint8Array }> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
	const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
	return { code: await proc.exited, bytes };
}

/** Text, or a note that the bytes are not text (or are too big to read as one). */
function sideOf(bytes: Uint8Array | null): { text: string; binary: boolean; tooLarge: boolean } {
	if (!bytes) return { text: "", binary: false, tooLarge: false };
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
 * Both ends of a change, for a two-sided diff: a staged change runs HEAD against the index, an unstaged
 * one runs the index against the working file. A rename reads its old name from the other end, so it does
 * not arrive as "everything added".
 */
export async function gitFileSides(workspace: string, path: string, opts: { staged?: boolean; from?: string | null } = {}): Promise<GitFileSides> {
	const repoRoot = await gitRepoRoot(workspace);
	const target = resolve(repoRoot, path);
	ensureWithin(repoRoot, target);
	const from = opts.from ?? path;
	ensureWithin(repoRoot, resolve(repoRoot, from));

	// The spec is the whole `rev:path`; the index is an empty rev, so its spec is `:path`.
	const blob = async (spec: string) => {
		const res = await runGitBytes(repoRoot, ["show", spec]);
		return res.code === 0 ? res.bytes : null;
	};

	const original = sideOf(await blob(opts.staged ? `HEAD:${from}` : `:${from}`));
	const modified = opts.staged ? sideOf(await blob(`:${path}`)) : sideOf(await readFile(target).catch(() => null));

	const numstatArgs = ["diff", "--no-ext-diff", "--numstat"];
	if (opts.staged) numstatArgs.push("--cached");
	numstatArgs.push("--", path);
	const numstat = await runGit(repoRoot, numstatArgs);
	const [add, del] = (numstat.stdout.split("\n")[0] ?? "").split("\t");
	const counted = { add: Number(add) || 0, del: Number(del) || 0 };
	// An untracked file is in no diff at all, so `--numstat` has nothing to say: the whole file is the
	// addition, and the whole old file is the removal.
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
