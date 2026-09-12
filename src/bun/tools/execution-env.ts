import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type ExecutionEnv, ExecutionError, err, FileError, type FileInfo, ok, type Result, type ShellExecOptions } from "@earendil-works/pi-agent-core";
import type { SandboxMode } from "../permission";
import { Permission, PermissionError, SandboxUnavailableError, sandboxDenialMarker } from "../permission";

export interface SandboxedExecOptions extends ShellExecOptions {
	sandboxMode?: SandboxMode;
}

/** Grace between SIGTERM and SIGKILL when tearing down a command's process group. */
const KILL_ESCALATE_MS = 500;

function mapFileError(path: string, cause: unknown): FileError {
	const error = cause as NodeJS.ErrnoException;
	const code = error?.code;
	if (code === "ENOENT") return new FileError("not_found", error.message, path, error);
	if (code === "EACCES" || code === "EPERM") return new FileError("permission_denied", error.message, path, error);
	if (code === "EISDIR") return new FileError("is_directory", error.message, path, error);
	if (code === "ENOTDIR") return new FileError("not_directory", error.message, path, error);
	return new FileError("unknown", error?.message ?? String(cause), path, error);
}

function toFileInfo(path: string, s: { size: number; mtimeMs: number; isDirectory(): boolean; isSymbolicLink(): boolean }): FileInfo {
	return {
		name: basename(path),
		path,
		kind: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file",
		size: s.size,
		mtimeMs: s.mtimeMs,
	};
}

export function createExecutionEnv(cwd: string, permission?: Permission): ExecutionEnv {
	const checkAbort = (signal?: AbortSignal) => signal?.throwIfAborted();
	const scratchBase = () => {
		if (!permission) return cwd;
		const workspace = permission.workspaceRoot();
		if (workspace) return workspace;
		const storage = permission.storageRoot();
		if (!storage) throw new Error("permission env has no workspace or storage root");
		return storage;
	};
	const workspaceBase = () => (permission ? permission.workspaceRoot() : cwd);
	const resolveTarget = (path: string): Result<string, FileError> => {
		if (isAbsolute(path)) return ok(resolve(path));
		const base = workspaceBase();
		if (!base) return err(new FileError("invalid", "No working directory is set; pass an absolute path.", path));
		return ok(resolve(base, path));
	};

	const denied = (target: string, op: "read" | "write"): Result<never, FileError> | null => {
		if (!permission) return null;
		const decision = permission.checkFile(target, op);
		return decision.allowed ? null : err(new PermissionError(decision.reason, target, decision.code));
	};

	return {
		cwd,

		async absolutePath(path, signal) {
			checkAbort(signal);
			return resolveTarget(path);
		},
		async joinPath(parts, signal) {
			checkAbort(signal);
			return ok(join(...parts));
		},
		async readTextFile(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(await readFile(target.value, "utf8"));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async readTextLines(path, options) {
			const result = await this.readTextFile(path, options?.abortSignal);
			if (result.ok) {
				const lines = result.value.split("\n");
				return ok(options?.maxLines ? lines.slice(0, options.maxLines) : lines);
			}
			return result;
		},
		async readBinaryFile(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(new Uint8Array(await readFile(target.value)));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async writeFile(path, content, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "write");
			if (deniedPath) return deniedPath;
			try {
				await mkdir(dirname(target.value), { recursive: true });
				await writeFile(target.value, content);
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async appendFile(path, content, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "write");
			if (deniedPath) return deniedPath;
			try {
				await mkdir(dirname(target.value), { recursive: true });
				await appendFile(target.value, content);
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async renameFile(sourcePath, destinationPath, signal) {
			checkAbort(signal);
			const source = resolveTarget(sourcePath);
			if (!source.ok) return source;
			const destination = resolveTarget(destinationPath);
			if (!destination.ok) return destination;
			const deniedPath = denied(source.value, "write") ?? denied(destination.value, "write");
			if (deniedPath) return deniedPath;
			try {
				await rename(source.value, destination.value);
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(destinationPath, e));
			}
		},
		async fileInfo(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(toFileInfo(path, await lstat(target.value)));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async listDir(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				const dir = target.value;
				const entries = await readdir(dir, { withFileTypes: true });
				const infos = await Promise.all(
					entries.map(async (entry) => {
						const entryPath = join(dir, entry.name);
						const s = await lstat(entryPath);
						return toFileInfo(entryPath, s);
					}),
				);
				return ok(infos);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async canonicalPath(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(await realpath(target.value));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async exists(path, signal) {
			checkAbort(signal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "read");
			if (deniedPath) return deniedPath;
			try {
				await lstat(target.value);
				return ok(true);
			} catch (e) {
				if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return ok(false);
				return err(mapFileError(path, e));
			}
		},
		async createDir(path, options) {
			checkAbort(options?.abortSignal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "write");
			if (deniedPath) return deniedPath;
			try {
				await mkdir(target.value, { recursive: options?.recursive ?? true });
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async remove(path, options) {
			checkAbort(options?.abortSignal);
			const target = resolveTarget(path);
			if (!target.ok) return target;
			const deniedPath = denied(target.value, "write");
			if (deniedPath) return deniedPath;
			try {
				await rm(target.value, {
					recursive: options?.recursive ?? false,
					force: options?.force ?? false,
				});
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async createTempDir(prefix, signal) {
			checkAbort(signal);
			try {
				return ok(await mkdtemp(join(tmpdir(), prefix ?? "tmp-")));
			} catch (e) {
				return err(mapFileError(join(tmpdir(), prefix ?? "tmp-"), e));
			}
		},
		async createTempFile(options) {
			checkAbort(options?.abortSignal);
			try {
				const dir = await mkdtemp(join(tmpdir(), "letters-"));
				const path = join(dir, `${options?.prefix ?? ""}${Date.now()}${options?.suffix ?? ""}`);
				await writeFile(path, "");
				return ok(path);
			} catch (e) {
				return err(mapFileError(join(tmpdir(), "letters-"), e));
			}
		},
		async exec(command, options) {
			const opts: SandboxedExecOptions = options ?? {};
			if (permission) {
				const scan = permission.checkCommand(command);
				if (!scan.allowed) return err(new ExecutionError("spawn_error", scan.reason));
			}
			let argv = ["/bin/sh", "-c", command];
			let denialSignatures: string[] = [];
			let runnerFailureRules: string[] = [];
			let marker: string | undefined;
			if (permission) {
				const mode = opts.sandboxMode ?? permission.getMode();
				try {
					const confined = await permission.confine(argv, { sandboxMode: mode });
					argv = confined.argv;
					denialSignatures = confined.denialSignatures;
					runnerFailureRules = confined.runnerFailureRules;
					if (confined.enforcement !== "none") marker = sandboxDenialMarker(mode);
				} catch (e) {
					if (e instanceof SandboxUnavailableError) {
						return err(new ExecutionError("spawn_error", "sandbox unavailable — cannot execute confined command"));
					}
					throw e;
				}
			}
			const env = opts.inheritEnv === false ? { ...(opts.env ?? {}) } : { ...process.env, ...(opts.env ?? {}) };
			try {
				// The command leads its own process group (detached), so a timeout or an abort can tear
				// down the whole tree — killing the direct child alone leaves its grandchildren running.
				const proc = Bun.spawn(argv, {
					cwd: opts.cwd ? resolve(scratchBase(), opts.cwd) : scratchBase(),
					env,
					stdout: "pipe",
					stderr: "pipe",
					detached: true,
				});
				const killGroup = (signal: "SIGTERM" | "SIGKILL") => {
					const pgid = proc.pid;
					// Never signal a non-pid: kill(0, …) hits the caller's own process group.
					if (!Number.isInteger(pgid) || pgid <= 0 || pgid === process.pid) return;
					try {
						process.kill(-pgid, signal);
					} catch {
						try {
							proc.kill(signal);
						} catch {
							// the command is already gone
						}
					}
				};
				const teardown = () => {
					killGroup("SIGTERM");
					// A group that ignores SIGTERM must not hold the tool call open — but only escalate
					// while the leader is alive, so a recycled pid can never be signalled.
					setTimeout(() => {
						if (proc.exitCode === null) killGroup("SIGKILL");
					}, KILL_ESCALATE_MS);
				};
				if (opts.abortSignal?.aborted) teardown();
				opts.abortSignal?.addEventListener("abort", teardown, { once: true });
				let timedOut = false;
				const timer = opts.timeout
					? setTimeout(() => {
							timedOut = true;
							teardown();
						}, opts.timeout * 1000)
					: undefined;
				const [stdout, stderr] = await Promise.all([readStream(proc.stdout, opts.onStdout), readStream(proc.stderr, opts.onStderr)]);
				const exitCode = await proc.exited;
				if (timer) clearTimeout(timer);
				opts.abortSignal?.removeEventListener("abort", teardown);
				if (timedOut) {
					return err(new ExecutionError("timeout", `Command timed out after ${opts.timeout}s`));
				}
				if (opts.abortSignal?.aborted) {
					return err(new ExecutionError("aborted", "Command aborted"));
				}
				const lower = stderr.toLowerCase();
				if (runnerFailureRules.some((r) => lower.includes(r.toLowerCase()))) {
					return err(new ExecutionError("spawn_error", "sandbox unavailable — the sandbox runner failed before executing the command"));
				}
				if (marker && denialSignatures.some((r) => lower.includes(r.toLowerCase()))) {
					return ok({ stdout, stderr: stderr ? `${stderr}\n${marker}` : marker, exitCode });
				}
				return ok({ stdout, stderr, exitCode });
			} catch (e) {
				if (opts.abortSignal?.aborted) {
					return err(new ExecutionError("aborted", "Command aborted"));
				}
				return err(new ExecutionError("spawn_error", e instanceof Error ? e.message : String(e)));
			}
		},
		async cleanup() {},
	};
}

async function readStream(stream: ReadableStream<Uint8Array>, onChunk?: (chunk: string) => void): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		const chunk = decoder.decode(value, { stream: true });
		text += chunk;
		onChunk?.(chunk);
	}
	return text;
}
