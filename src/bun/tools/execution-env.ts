/**
 * Tool execution environment: Bun filesystem + shell, implementing pi's ExecutionEnv.
 * Session persistence (pi JSONL backend) also reuses its pure fs part.
 * All permission decisions (fs fence, sensitive scan, sandbox wrap) go through the
 * injected Permission facade — this file is pure fs/shell plumbing.
 */
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { type ExecutionEnv, ExecutionError, err, FileError, type FileInfo, ok, type Result, type ShellExecOptions } from "@earendil-works/pi-agent-core";
import type { SandboxMode } from "../permission";
import { Permission, PermissionError, SandboxUnavailableError, sandboxDenialMarker } from "../permission";

/** exec options extended with a per-call sandbox mode (escalation path). */
export interface SandboxedExecOptions extends ShellExecOptions {
	sandboxMode?: SandboxMode;
}

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

/** Filesystem + shell against the current working directory, optionally permission-gated. */
export function createExecutionEnv(cwd: string, permission?: Permission): ExecutionEnv {
	const checkAbort = (signal?: AbortSignal) => signal?.throwIfAborted();
	// Relative paths resolve against the workspace when set; without a workspace the default
	// working directory is the storage path (the agent's own directory), else the static cwd
	const base = () => permission?.workspaceRoot() ?? permission?.storageRoot() ?? cwd;
	const absolute = (path: string) => resolve(base(), path);

	// Result<never, …> so returning it from any method narrows cleanly (never is assignable to every value type)
	const denied = (path: string, op: "read" | "write"): Result<never, FileError> | null => {
		if (!permission) return null;
		const target = absolute(path);
		const decision = permission.checkFile(target, op);
		return decision.allowed ? null : err(new PermissionError(decision.reason, target, decision.code));
	};

	return {
		cwd,

		async absolutePath(path, signal) {
			checkAbort(signal);
			return ok(absolute(path));
		},
		async joinPath(parts, signal) {
			checkAbort(signal);
			// Contract: join the parts verbatim (absolute segments stay absolute); must not re-prefix cwd,
			// or the path recursively doubles when pi's JSONL session layer passes absolute paths
			return ok(join(...parts));
		},
		async readTextFile(path, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(await readFile(absolute(path), "utf8"));
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
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(new Uint8Array(await readFile(absolute(path))));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async writeFile(path, content, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "write");
			if (deniedPath) return deniedPath;
			try {
				const target = absolute(path);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content);
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async appendFile(path, content, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "write");
			if (deniedPath) return deniedPath;
			try {
				const target = absolute(path);
				await mkdir(dirname(target), { recursive: true });
				await appendFile(target, content);
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async renameFile(sourcePath, destinationPath, signal) {
			checkAbort(signal);
			// rename moves the source — a write effect — so both sides are checked as writes
			// (read is unrestricted, but moving an outside file into the workspace would mutate it)
			const deniedPath = denied(sourcePath, "write") ?? denied(destinationPath, "write");
			if (deniedPath) return deniedPath;
			try {
				await rename(absolute(sourcePath), absolute(destinationPath));
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(destinationPath, e));
			}
		},
		async fileInfo(path, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(toFileInfo(path, await lstat(absolute(path))));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async listDir(path, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				const dir = absolute(path);
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
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				return ok(await realpath(absolute(path)));
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async exists(path, signal) {
			checkAbort(signal);
			const deniedPath = denied(path, "read");
			if (deniedPath) return deniedPath;
			try {
				await lstat(absolute(path));
				return ok(true);
			} catch (e) {
				if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return ok(false);
				return err(mapFileError(path, e));
			}
		},
		async createDir(path, options) {
			checkAbort(options?.abortSignal);
			const deniedPath = denied(path, "write");
			if (deniedPath) return deniedPath;
			try {
				await mkdir(absolute(path), { recursive: options?.recursive ?? true });
				return ok(undefined);
			} catch (e) {
				return err(mapFileError(path, e));
			}
		},
		async remove(path, options) {
			checkAbort(options?.abortSignal);
			const deniedPath = denied(path, "write");
			if (deniedPath) return deniedPath;
			try {
				await rm(absolute(path), {
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
			// sensitive scan (defense-in-depth; the kernel profile is the boundary for writes)
			if (permission) {
				const scan = permission.checkCommand(command);
				if (!scan.allowed) return err(new ExecutionError("spawn_error", scan.reason));
			}
			// sandbox wrap: confine argv under the session mode (or the per-call escalation mode)
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
				const proc = Bun.spawn(argv, {
					cwd: opts.cwd ? resolve(base(), opts.cwd) : base(),
					env,
					stdout: "pipe",
					stderr: "pipe",
					signal: opts.abortSignal,
				});
				let timedOut = false;
				const timer = opts.timeout
					? setTimeout(() => {
							timedOut = true;
							proc.kill();
						}, opts.timeout * 1000)
					: undefined;
				const [stdout, stderr] = await Promise.all([readStream(proc.stdout, opts.onStdout), readStream(proc.stderr, opts.onStderr)]);
				const exitCode = await proc.exited;
				if (timer) clearTimeout(timer);
				if (timedOut) {
					return err(new ExecutionError("timeout", `Command timed out after ${opts.timeout}s`));
				}
				if (opts.abortSignal?.aborted) {
					return err(new ExecutionError("aborted", "Command aborted"));
				}
				// classify runner failure first (the command never ran), then denial
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
		async cleanup() {
			/* nothing to release */
		},
	};
}

/** Collect a spawned stream, forwarding chunks to an optional callback. */
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
