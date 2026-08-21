/**
 * Tool execution environment: Bun filesystem + shell, implementing pi's ExecutionEnv.
 * Session persistence (pi JSONL backend) also reuses its pure fs part.
 */
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type ExecutionEnv, ExecutionError, err, FileError, type FileInfo, ok, type Result, type ShellExecOptions } from "@earendil-works/pi-agent-core";
import { type SandboxManager, SandboxUnavailableError } from "../sandbox";
import type { SandboxMode, SandboxPolicy } from "../sandbox/types";

/** Path guard for the tool environment: which roots the agent may touch, and which files are sensitive. */
export interface EnvGuard {
	/** The current workspace root (null = unset; relative paths resolve against the default cwd). */
	workspaceRoot(): string | null;
	/** The agent storage root: full access, sensitive files allowed. */
	storageRoot(): string | null;
}

/** Sandbox runtime bound to the environment: the manager + the session's effective mode. */
export interface SandboxRuntime {
	manager: SandboxManager;
	/** Session effective mode (per partner; may be overridden per call for escalation). */
	getMode: () => SandboxMode;
}

/** exec options extended with a per-call sandbox mode (escalation path). */
export interface SandboxedExecOptions extends ShellExecOptions {
	sandboxMode?: SandboxMode;
}

/** Sensitive filenames: never readable/writable outside the storage path. */
const SENSITIVE_PATTERNS: RegExp[] = [/^\.env(?:\.\w+)?$/, /\.pem$/, /\.key$/, /^id_rsa$/, /^id_ed25519$/, /^\.git-credentials$/, /^\.npmrc$/];

function isSensitiveName(name: string): boolean {
	return SENSITIVE_PATTERNS.some((p) => p.test(name));
}

function isInside(target: string, root: string): boolean {
	return target === root || target.startsWith(root + sep);
}

/** Best-effort scan for sensitive files in a shell command (strict sandboxing is a follow-up). */
function commandMentionsSensitive(command: string): boolean {
	return /(?:^|[^A-Za-z0-9_./-])(?:\.env(?:\.\w+)?|[\w./-]*\.(?:pem|key)|id_rsa|id_ed25519|\.git-credentials|\.npmrc)(?:$|[^A-Za-z0-9_./-])/.test(command);
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

/** Filesystem + shell against the current working directory, optionally path-guarded and sandboxed. */
export function createExecutionEnv(cwd: string, guard?: EnvGuard, sandbox?: SandboxRuntime): ExecutionEnv {
	const checkAbort = (signal?: AbortSignal) => signal?.throwIfAborted();
	// Relative paths resolve against the workspace when set; without a workspace the default
	// working directory is the storage path (the agent's own directory), else the static cwd
	const base = () => guard?.workspaceRoot() ?? guard?.storageRoot() ?? cwd;
	const absolute = (path: string) => resolve(base(), path);

	// Returns an error message when the path is off-limits, null when allowed
	const check = (path: string, op: "read" | "write"): string | null => {
		if (!guard) return null;
		const target = resolve(base(), path);
		const storage = guard.storageRoot();
		if (storage && isInside(target, storage)) return null; // storage: full access, sensitive files allowed
		const workspace = guard.workspaceRoot() ?? guard.storageRoot() ?? cwd;
		if (!isInside(target, workspace)) return "Path is outside the workspace and the storage path";
		if (op === "write" && sandbox && sandbox.getMode() === "read-only") {
			return "[sandbox: write denied under read-only mode]";
		}
		if (isSensitiveName(basename(target))) return "Sensitive file access is not allowed (except inside the storage path)";
		return null;
	};
	// Result<never, …> so returning it from any method narrows cleanly (never is assignable to every value type)
	const denied = (path: string, op: "read" | "write"): Result<never, FileError> | null => {
		const message = check(path, op);
		return message ? err(new FileError("permission_denied", message, path)) : null;
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
			const deniedPath = denied(sourcePath, "read") ?? denied(destinationPath, "write");
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
			if (guard && commandMentionsSensitive(command)) {
				return err(new ExecutionError("spawn_error", "Sensitive file access is not allowed (except inside the storage path)"));
			}
			// sandbox wrap: confine argv under the session mode (or the per-call escalation mode)
			let argv = ["/bin/sh", "-c", command];
			let denialSignatures: string[] = [];
			let runnerFailureRules: string[] = [];
			let marker: string | undefined;
			if (sandbox) {
				const mode = opts.sandboxMode ?? sandbox.getMode();
				const policy: SandboxPolicy = {
					mode,
					workspaceRoot: guard?.workspaceRoot() ?? null,
					storageRoot: guard?.storageRoot() ?? null,
				};
				try {
					const confined = await sandbox.manager.confine(argv, policy);
					argv = confined.argv;
					denialSignatures = confined.denialSignatures;
					runnerFailureRules = confined.runnerFailureRules;
					if (confined.enforcement !== "none") marker = `[sandbox: file access denied under ${mode} mode]`;
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
