import { spawn } from "node:child_process";
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { err, ExecutionError, type ExecutionEnv, FileError, type FileInfo, ok, type Result } from "@milu/core";

import { deleteDeniedText, findDeleteVerbs } from "./delete-verbs.ts";
import { checkPath, commandMentionsSensitive, sandboxDenialMarker } from "./guard.ts";
import type { ConfinedArgv, PermissionPolicy } from "./types.ts";

const KILL_ESCALATE_MS = 500;

class PermissionError extends FileError {
	constructor(message: string, path: string) {
		super("permission_denied", message, path);
	}
}

function mapFileError(path: string, cause: unknown): FileError {
	const code = (cause as NodeJS.ErrnoException)?.code;
	const message = cause instanceof Error ? cause.message : String(cause);
	if (code === "ENOENT") return new FileError("not_found", message, path);
	if (code === "EACCES" || code === "EPERM") return new FileError("permission_denied", message, path);
	if (code === "EISDIR") return new FileError("is_directory", message, path);
	if (code === "ENOTDIR") return new FileError("not_directory", message, path);
	return new FileError("unknown", message, path);
}

function toFileInfo(path: string, stats: { size: number; mtimeMs: number; isDirectory(): boolean; isSymbolicLink(): boolean }): FileInfo {
	return { name: basename(path), path, kind: stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : "file", size: stats.size, mtimeMs: stats.mtimeMs };
}

export interface EnvOptions {
	readonly sandboxed: boolean;
	readonly strictDelete: boolean;
	confine(policy: PermissionPolicy, argv: string[]): Promise<ConfinedArgv | null>;
	onExit?(command: string, exitCode: number): void;
}

export function createEnv(policy: PermissionPolicy, options: EnvOptions): ExecutionEnv {
	const resolveTarget = (path: string): Result<string, FileError> => {
		if (path.startsWith("/")) return ok(resolve(path));
		if (!policy.workspace) return err(new FileError("invalid", "No working directory is set; pass an absolute path.", path));
		return ok(resolve(policy.workspace, path));
	};

	const denied = (target: string, op: "read" | "write"): Result<never, FileError> | null => {
		const decision = checkPath(target, op, policy, options.sandboxed);
		return decision.allowed ? null : err(new PermissionError(decision.reason, target));
	};

	const attempt = async <T>(path: string, op: "read" | "write", run: (target: string) => Promise<T>): Promise<Result<T, FileError>> => {
		const target = resolveTarget(path);
		if (!target.ok) return target;
		const blocked = denied(target.value, op);
		if (blocked) return blocked;
		try {
			return ok(await run(target.value));
		} catch (error) {
			return err(mapFileError(path, error));
		}
	};

	const exec = async (
		command: string,
		opts?: { cwd?: string; timeout?: number; abortSignal?: AbortSignal; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void },
	): ReturnType<ExecutionEnv["exec"]> => {
		if (commandMentionsSensitive(command)) {
			return err(new ExecutionError("spawn_error", "Sensitive file access is not allowed (except inside the storage path)"));
		}
		if (options.strictDelete) {
			const hits = findDeleteVerbs(command);
			if (hits.length > 0) return err(new ExecutionError("spawn_error", deleteDeniedText(hits, policy.trash)));
		}

		const confined = await options.confine(policy, ["/bin/sh", "-c", command]);
		if (!confined) return err(new ExecutionError("shell_unavailable", `no usable sandbox on ${process.platform} — refusing to run an unconfined command`));
		const result = await runCommand(policy, confined, opts ?? {});
		if (result.ok && result.value.exitCode !== 0) options.onExit?.(command, result.value.exitCode);
		return result;
	};

	return {
		cwd: policy.workspace ?? "",

		absolutePath: (path) => Promise.resolve(resolveTarget(path)),
		joinPath: (parts) => Promise.resolve(ok(join(...parts))),

		readTextFile: (path) => attempt(path, "read", (target) => readFile(target, "utf8")),
		async readTextLines(path, lineOptions) {
			const result = await this.readTextFile(path, lineOptions?.abortSignal);
			if (!result.ok) return result;
			const lines = result.value.split("\n");
			return ok(lineOptions?.maxLines ? lines.slice(0, lineOptions.maxLines) : lines);
		},
		readBinaryFile: (path) => attempt(path, "read", async (target) => new Uint8Array(await readFile(target))),

		writeFile: (path, content) =>
			attempt(path, "write", async (target) => {
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content);
			}),
		appendFile: (path, content) =>
			attempt(path, "write", async (target) => {
				await mkdir(dirname(target), { recursive: true });
				await appendFile(target, content);
			}),
		async renameFile(source, destination) {
			const from = resolveTarget(source);
			if (!from.ok) return from;
			const to = resolveTarget(destination);
			if (!to.ok) return to;
			const blocked = denied(from.value, "write") ?? denied(to.value, "write");
			if (blocked) return blocked;
			try {
				await rename(from.value, to.value);
				return ok(undefined);
			} catch (error) {
				return err(mapFileError(destination, error));
			}
		},

		fileInfo: (path) => attempt(path, "read", async (target) => toFileInfo(path, await lstat(target))),
		listDir: (path) =>
			attempt(path, "read", async (target) => {
				const entries = await readdir(target, { withFileTypes: true });
				return Promise.all(entries.map(async (entry) => toFileInfo(join(target, entry.name), await lstat(join(target, entry.name)))));
			}),
		canonicalPath: (path) => attempt(path, "read", (target) => realpath(target)),
		async exists(path) {
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const blocked = denied(target.value, "read");
			if (blocked) return blocked;
			try {
				await lstat(target.value);
				return ok(true);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return ok(false);
				return err(mapFileError(path, error));
			}
		},

		createDir: (path, dirOptions) => attempt(path, "write", (target) => mkdir(target, { recursive: dirOptions?.recursive ?? true }).then(() => undefined)),
		remove: (path, removeOptions) => attempt(path, "write", (target) => rm(target, { recursive: removeOptions?.recursive ?? false, force: removeOptions?.force ?? false })),

		async createTempDir(prefix) {
			try {
				return ok(await mkdtemp(join(tmpdir(), prefix ?? "tmp-")));
			} catch (error) {
				return err(mapFileError(tmpdir(), error));
			}
		},
		async createTempFile(fileOptions) {
			try {
				const dir = await mkdtemp(join(tmpdir(), "milu-"));
				const path = join(dir, `${fileOptions?.prefix ?? ""}${Date.now()}${fileOptions?.suffix ?? ""}`);
				await writeFile(path, "");
				return ok(path);
			} catch (error) {
				return err(mapFileError(tmpdir(), error));
			}
		},

		exec,
		cleanup: () => Promise.resolve(),
	};
}

async function runCommand(
	policy: PermissionPolicy,
	confined: ConfinedArgv,
	options: { cwd?: string; timeout?: number; abortSignal?: AbortSignal; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void },
): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
	const base = policy.workspace ?? policy.storage;
	const cwd = options.cwd ? resolve(base, options.cwd) : base;
	await mkdir(cwd, { recursive: true });

	return await new Promise((resolve_) => {
		const child = spawn(confined.argv[0] ?? "", confined.argv.slice(1), { cwd, env: process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
			options.onStdout?.(chunk);
		});
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
			options.onStderr?.(chunk);
		});

		const signalGroup = (signal: NodeJS.Signals) => {
			const pid = child.pid;
			if (!pid) return;
			try {
				process.kill(-pid, signal);
			} catch {
				child.kill(signal);
			}
		};
		const teardown = () => {
			signalGroup("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null) signalGroup("SIGKILL");
			}, KILL_ESCALATE_MS);
		};

		const timer = options.timeout
			? setTimeout(() => {
					timedOut = true;
					teardown();
				}, options.timeout * 1000)
			: undefined;
		const onAbort = () => teardown();
		options.abortSignal?.addEventListener("abort", onAbort, { once: true });

		const cleanup = () => {
			if (timer) clearTimeout(timer);
			options.abortSignal?.removeEventListener("abort", onAbort);
		};

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve_(err(new ExecutionError("spawn_error", error.message)));
		});

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (timedOut) {
				resolve_(err(new ExecutionError("timeout", `Command timed out after ${options.timeout} seconds`)));
				return;
			}
			if (options.abortSignal?.aborted) {
				resolve_(err(new ExecutionError("aborted", "Command aborted")));
				return;
			}
			const lower = stderr.toLowerCase();
			if (confined.runnerFailureRules.some((rule) => lower.includes(rule.toLowerCase()))) {
				resolve_(err(new ExecutionError("spawn_error", "the sandbox runner failed before executing the command")));
				return;
			}
			const marker = confined.enforcement === "none" ? null : sandboxDenialMarker(policy.mode);
			if (marker && confined.denialSignatures.some((signature) => lower.includes(signature))) stderr = stderr ? `${stderr}\n${marker}` : marker;
			resolve_(ok({ stdout, stderr, exitCode: code ?? 0 }));
		});
	});
}
