import { lstat, open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExplorerEntry } from "../../shared/rpc";
import { type Frontmatter, parseFrontmatter } from "./frontmatter";

const HIDDEN = new Set([".git", ".DS_Store"]);
const MAX_PREVIEW_BYTES = 512 * 1024;
/** Documents whose preview shows a YAML head as a header instead of raw text. */
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

/** What the reader needs to draw a file: the text, and — for markdown — its parsed head. */
export interface FilePreview {
	content: string;
	binary: boolean;
	truncated: boolean;
	size: number;
	frontmatter?: Frontmatter;
}
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

export async function fileWatchTarget(rootPath: string, relativePath: string): Promise<string> {
	const { targetReal } = await containedRealPath(rootPath, relativePath);
	return targetReal;
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

/** Images the preview may inline. SVG is safe here only because it is drawn inside an <img>, which does not run script. */
const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
};
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** A refusal that says why, so a preview can explain itself instead of showing a bare chip. */
export interface InlineImage {
	ok: boolean;
	dataUrl?: string;
	error?: string;
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Read an image beside a previewed document and hand it back as a data URL.
 *
 * The view cannot read the filesystem, and a relative `src` in a document resolves against a
 * directory the view knows nothing about — so the main process resolves `src` against the
 * document's own folder, keeps it inside the root, and returns bytes only for known image types.
 *
 * The size ceiling exists to stop a mislabelled giant file from being slurped into a data URL
 * (base64 costs a third more again), not to budget transfer — a desktop app can inline a whole
 * documentation set's worth of screenshots, and this README's animated GIF is 9 MB on its own.
 */
export async function readImageDataUrl(rootPath: string, documentPath: string, src: string): Promise<InlineImage> {
	let decoded = src;
	try {
		decoded = decodeURIComponent(src);
	} catch {}
	if (decoded === "" || isAbsolute(decoded) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return { ok: false, error: "not a path inside this root" };
	const relativeTarget = join(dirname(documentPath), decoded);
	const { targetReal } = await containedRealPath(rootPath, relativeTarget);
	const mime = IMAGE_TYPES[extname(targetReal).toLowerCase()];
	if (!mime) return { ok: false, error: `not an image the preview inlines (${extname(targetReal) || "no extension"})` };
	const info = await stat(targetReal);
	if (!info.isFile()) return { ok: false, error: "not a file" };
	if (info.size > MAX_IMAGE_BYTES) return { ok: false, error: `${megabytes(info.size)} — too large to inline (limit ${megabytes(MAX_IMAGE_BYTES)})` };
	return { ok: true, dataUrl: `data:${mime};base64,${(await readFile(targetReal)).toString("base64")}` };
}

export async function readFilePreview(rootPath: string, relativePath: string): Promise<FilePreview> {
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
	const frontmatter = MARKDOWN_EXTENSIONS.has(ext) ? parseFrontmatter(content) : null;
	return { content, binary: false, truncated: info.size > MAX_PREVIEW_BYTES, size: info.size, ...(frontmatter ? { frontmatter } : {}) };
}
