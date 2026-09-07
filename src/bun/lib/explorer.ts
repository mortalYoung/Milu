import { lstat, open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExplorerEntry } from "../../shared/rpc";

const HIDDEN = new Set([".git", ".DS_Store"]);
const MAX_PREVIEW_BYTES = 512 * 1024;
const BINARY_EXTENSIONS = new Set([
	".avif",
	".bmp",
	".class",
	".dmg",
	".dylib",
	".exe",
	".gif",
	".gz",
	".icns",
	".ico",
	".jpeg",
	".jpg",
	".m4a",
	".mkv",
	".mov",
	".mp3",
	".mp4",
	".o",
	".ogg",
	".otf",
	".pdf",
	".png",
	".pyc",
	".rar",
	".so",
	".tar",
	".ttf",
	".wav",
	".wasm",
	".webm",
	".webp",
	".woff",
	".woff2",
	".zip",
]);

function isHidden(name: string): boolean {
	return HIDDEN.has(name);
}

interface IgnorePattern {
	negated: boolean;
	dirOnly: boolean;
	regex: RegExp;
}

function escapeRegExpChar(ch: string): string {
	return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function globToSource(glob: string): string {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				i += 1;
				if (glob[i + 1] === "/") {
					i += 1;
					out += "(?:.*/)?";
				} else {
					out += ".*";
				}
			} else {
				out += "[^/]*";
			}
		} else if (ch === "?") {
			out += "[^/]";
		} else {
			out += escapeRegExpChar(ch);
		}
	}
	return out;
}

function parseGitignore(text: string): IgnorePattern[] {
	const patterns: IgnorePattern[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		let negated = false;
		if (line.startsWith("!")) {
			negated = true;
			line = line.slice(1);
		}
		let dirOnly = false;
		if (line.endsWith("/")) {
			dirOnly = true;
			line = line.slice(0, -1);
		}
		let anchored = false;
		if (line.startsWith("/")) {
			anchored = true;
			line = line.slice(1);
		}
		if (!line) continue;
		const hasSlash = anchored || line.includes("/");
		const source = globToSource(line);
		const regex = hasSlash ? new RegExp(`^${source}$`) : new RegExp(`(^|/)${source}$`);
		patterns.push({ negated, dirOnly, regex });
	}
	return patterns;
}

async function readGitignore(rootReal: string): Promise<IgnorePattern[]> {
	try {
		return parseGitignore(await readFile(join(rootReal, ".gitignore"), "utf8"));
	} catch {
		return [];
	}
}

function isIgnoredPath(relativePath: string, kind: ExplorerEntry["kind"], patterns: IgnorePattern[]): boolean {
	if (patterns.length === 0) return false;
	const parts = relativePath.split("/");
	let ignored = false;
	for (let i = 1; i <= parts.length; i++) {
		const candidate = parts.slice(0, i).join("/");
		const isDir = i < parts.length || kind === "dir";
		for (const pattern of patterns) {
			if (pattern.dirOnly && !isDir) continue;
			if (pattern.regex.test(candidate)) ignored = !pattern.negated;
		}
	}
	return ignored;
}

async function containedRealPath(rootPath: string, relativePath: string): Promise<{ rootReal: string; targetReal: string }> {
	if (isAbsolute(relativePath)) throw new Error("absolute path is not allowed");
	const rootReal = await realpath(rootPath);
	const candidate = resolve(rootReal, relativePath);
	const rel = relative(rootReal, candidate);
	if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("path escapes explorer root");
	const targetReal = await realpath(candidate);
	return { rootReal, targetReal };
}

function sortEntries(a: ExplorerEntry, b: ExplorerEntry): number {
	if (a.kind === "dir" && b.kind !== "dir") return -1;
	if (a.kind !== "dir" && b.kind === "dir") return 1;
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export async function listChildren(rootPath: string, relativePath: string): Promise<{ realPath: string; entries: ExplorerEntry[] }> {
	const { rootReal, targetReal } = await containedRealPath(rootPath, relativePath);
	const patterns = await readGitignore(rootReal);
	const dirents = await readdir(targetReal, { withFileTypes: true });
	const out: ExplorerEntry[] = [];
	for (const dirent of dirents) {
		if (isHidden(dirent.name)) continue;
		const abs = join(targetReal, dirent.name);
		const path = relativePath ? `${relativePath}/${dirent.name}` : dirent.name;
		const info = await lstat(abs);
		let kind: ExplorerEntry["kind"];
		let realPath: string | undefined;
		let linkKind: ExplorerEntry["linkKind"] | undefined;
		let linkTarget: string | undefined;
		if (dirent.isSymbolicLink()) {
			kind = "link";
			linkTarget = await readlink(abs);
			try {
				const targetInfo = await stat(abs);
				linkKind = targetInfo.isDirectory() ? "dir" : targetInfo.isFile() ? "file" : "other";
				realPath = await realpath(abs);
			} catch {
				linkKind = "other";
			}
		} else if (dirent.isDirectory()) {
			kind = "dir";
			realPath = await realpath(abs);
		} else if (dirent.isFile()) {
			kind = "file";
			realPath = await realpath(abs);
		} else {
			kind = "other";
		}
		const entry: ExplorerEntry = { name: dirent.name, path, kind };
		if (realPath) entry.realPath = realPath;
		if (linkKind) entry.linkKind = linkKind;
		if (linkTarget) entry.linkTarget = linkTarget;
		if (kind === "file" || kind === "other") entry.size = info.size;
		if (info.mtimeMs) entry.mtime = Math.round(info.mtimeMs);
		if (patterns.length > 0) entry.ignored = isIgnoredPath(path, kind, patterns);
		out.push(entry);
	}
	return { realPath: targetReal, entries: out.sort(sortEntries) };
}

export async function readFilePreview(rootPath: string, relativePath: string): Promise<{ content: string; binary: boolean; truncated: boolean; size: number }> {
	const { targetReal } = await containedRealPath(rootPath, relativePath);
	const info = await stat(targetReal);
	if (!info.isFile()) throw new Error("not a file");
	const ext = extname(relativePath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return { content: "", binary: true, truncated: false, size: info.size };
	const length = Math.min(info.size, MAX_PREVIEW_BYTES);
	const buffer = Buffer.alloc(length);
	if (length > 0) {
		const handle = await open(targetReal, "r");
		try {
			await handle.read(buffer, 0, length, 0);
		} finally {
			await handle.close();
		}
	}
	if (buffer.includes(0)) return { content: "", binary: true, truncated: info.size > MAX_PREVIEW_BYTES, size: info.size };
	let content: string;
	try {
		content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return { content: "", binary: true, truncated: info.size > MAX_PREVIEW_BYTES, size: info.size };
	}
	return { content, binary: false, truncated: info.size > MAX_PREVIEW_BYTES, size: info.size };
}
