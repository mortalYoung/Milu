import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChange {
	path: string;
	status: GitChangeStatus;
	staged: boolean;
	untracked?: boolean;
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

export async function isGitRepo(workspace: string): Promise<boolean> {
	return gitRepoRoot(workspace).then(
		() => true,
		() => false,
	);
}

function statusLetter(code: string): GitChangeStatus {
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
		let path = raw.slice(3);
		if ((x === "R" || x === "C" || y === "R" || y === "C") && i + 1 < parts.length && parts[i + 1] !== "") {
			i += 1;
		}
		if (!path) continue;
		if (x === "?" && y === "?") {
			changes.push({ path, status: "U", staged: false, untracked: true });
		} else if (x !== " ") {
			changes.push({ path, status: statusLetter(x), staged: true });
		} else if (y !== " ") {
			changes.push({ path, status: statusLetter(y), staged: false });
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
