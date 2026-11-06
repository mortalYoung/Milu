import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { err, ExecutionError, FileError, ok } from "../tools/result.ts";
import type { ExecutionEnv, FileInfo, FileKind } from "./types.ts";

type FileResult<T> = { ok: true; value: T } | { ok: false; error: FileError };

export interface LocalEnvOptions {
	root: string;
}

function kindOf(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind {
	if (entry.isDirectory()) return "directory";
	if (entry.isSymbolicLink()) return "symlink";
	return "file";
}

function errorCode(error: unknown): FileError["code"] {
	switch ((error as { code?: unknown } | null)?.code) {
		case "ENOENT":
			return "not_found";
		case "EACCES":
		case "EPERM":
			return "permission_denied";
		case "ENOTDIR":
			return "not_directory";
		case "EISDIR":
			return "is_directory";
		case "EINVAL":
		case "ENAMETOOLONG":
			return "invalid";
		case "ENOTSUP":
			return "not_supported";
		case "ABORT_ERR":
			return "aborted";
		default:
			return "unknown";
	}
}

export class LocalExecutionEnv implements ExecutionEnv {
	readonly cwd: string;

	private readonly _root: string;
	private _temp = "";

	constructor(options: LocalEnvOptions) {
		this._root = resolve(options.root);
		this.cwd = this._root;
	}

	async absolutePath(path: string): Promise<FileResult<string>> {
		return this._attempt(path, async () => this._resolve(path));
	}

	async joinPath(parts: string[]): Promise<FileResult<string>> {
		return this._attempt(parts.join("/"), async () => this._resolve(join(...parts)));
	}

	async readTextFile(path: string): Promise<FileResult<string>> {
		return this._attempt(path, () => readFile(this._resolve(path), "utf8"));
	}

	async readTextLines(path: string, options?: { maxLines?: number }): Promise<FileResult<string[]>> {
		return this._attempt(path, async () => {
			const lines = (await readFile(this._resolve(path), "utf8")).split("\n");
			return options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines);
		});
	}

	async readBinaryFile(path: string): Promise<FileResult<Uint8Array>> {
		return this._attempt(path, async () => new Uint8Array(await readFile(this._resolve(path))));
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<FileResult<void>> {
		return this._attempt(path, async () => {
			const target = this._resolve(path);
			await mkdir(join(target, ".."), { recursive: true });
			await writeFile(target, content);
		});
	}

	async appendFile(path: string, content: string | Uint8Array): Promise<FileResult<void>> {
		return this._attempt(path, async () => {
			const target = this._resolve(path);
			await mkdir(join(target, ".."), { recursive: true });
			await appendFile(target, content);
		});
	}

	async renameFile(sourcePath: string, destinationPath: string): Promise<FileResult<void>> {
		return this._attempt(sourcePath, () => rename(this._resolve(sourcePath), this._resolve(destinationPath)));
	}

	async fileInfo(path: string): Promise<FileResult<FileInfo>> {
		return this._attempt(path, async () => {
			const target = this._resolve(path);
			return this._info(target, await lstat(target));
		});
	}

	async listDir(path: string): Promise<FileResult<FileInfo[]>> {
		return this._attempt(path, async () => {
			const target = this._resolve(path);
			const entries = await readdir(target, { withFileTypes: true });
			return Promise.all(entries.map(async (entry) => this._info(join(target, entry.name), await lstat(join(target, entry.name)), entry)));
		});
	}

	async canonicalPath(path: string): Promise<FileResult<string>> {
		return this._attempt(path, async () => this._resolve(await realpath(this._resolve(path))));
	}

	async exists(path: string): Promise<FileResult<boolean>> {
		return this._attempt(path, async () => {
			try {
				await lstat(this._resolve(path));
				return true;
			} catch (error) {
				if (errorCode(error) === "not_found") return false;
				throw error;
			}
		});
	}

	async createDir(path: string, options?: { recursive?: boolean }): Promise<FileResult<void>> {
		return this._attempt(path, async () => {
			await mkdir(this._resolve(path), { recursive: options?.recursive ?? true });
		});
	}

	async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<FileResult<void>> {
		return this._attempt(path, () => rm(this._resolve(path), { recursive: options?.recursive ?? false, force: options?.force ?? false }));
	}

	async createTempDir(prefix?: string): Promise<FileResult<string>> {
		return this._attempt(undefined, () => mkdtemp(join(this._root, `.milu-${prefix ?? "tmp"}-`)));
	}

	async createTempFile(options?: { prefix?: string; suffix?: string }): Promise<FileResult<string>> {
		return this._attempt(undefined, async () => {
			this._temp ||= await mkdtemp(join(this._root, ".milu-tmp-"));
			const path = join(this._temp, `${options?.prefix ?? "file"}-${Date.now().toString(36)}${options?.suffix ?? ""}`);
			await writeFile(path, "");
			return path;
		});
	}

	async cleanup(): Promise<void> {
		for (const path of [this._temp].filter(Boolean)) {
			await rm(path, { recursive: true, force: true }).catch(() => {});
		}
		this._temp = "";
	}

	async exec(): Promise<{ ok: true; value: { stdout: string; stderr: string; exitCode: number } } | { ok: false; error: ExecutionError }> {
		return err(new ExecutionError("shell_unavailable", "no shell until the permission guard exists — an ungated shell cannot be taken back"));
	}

	private _resolve(path: string): string {
		const absolute = isAbsolute(path) ? resolve(path) : resolve(this._root, path);
		if (absolute !== this._root && !absolute.startsWith(this._root + "/")) {
			throw new FileError("permission_denied", `"${path}" is outside the workspace (${this._root})`, absolute);
		}
		return absolute;
	}

	private _info(
		path: string,
		stats: { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean },
		entry?: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean },
	): FileInfo {
		return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: kindOf(entry ?? stats), size: stats.size, mtimeMs: stats.mtimeMs };
	}

	private async _attempt<T>(path: string | undefined, run: () => Promise<T>): Promise<FileResult<T>> {
		try {
			return ok(await run());
		} catch (error) {
			if (error instanceof FileError) return err(error);
			const message = error instanceof Error ? error.message : String(error);
			return err(new FileError(errorCode(error), message, path, error instanceof Error ? error : undefined));
		}
	}
}
