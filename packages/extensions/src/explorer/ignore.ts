import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExplorerEntry } from "./types.ts";

interface IgnorePattern {
	readonly negated: boolean;
	readonly dirOnly: boolean;
	readonly regex: RegExp;
}

function escapeRegExpChar(ch: string): string {
	return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function globToSource(glob: string): string {
	let out = "";
	for (let index = 0; index < glob.length; index += 1) {
		const ch = glob[index];
		if (ch === "*") {
			if (glob[index + 1] === "*") {
				index += 1;
				if (glob[index + 1] === "/") {
					index += 1;
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
			out += escapeRegExpChar(ch ?? "");
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

export async function gitignoreOf(root: string): Promise<IgnorePattern[]> {
	try {
		return parseGitignore(await readFile(join(root, ".gitignore"), "utf8"));
	} catch {
		return [];
	}
}

export function isIgnoredPath(relativePath: string, kind: ExplorerEntry["kind"], patterns: readonly IgnorePattern[]): boolean {
	if (patterns.length === 0) return false;
	const parts = relativePath.split("/");
	let ignored = false;
	for (let index = 1; index <= parts.length; index += 1) {
		const candidate = parts.slice(0, index).join("/");
		const isDir = index < parts.length || kind === "directory";
		for (const pattern of patterns) {
			if (pattern.dirOnly && !isDir) continue;
			if (!pattern.regex.test(candidate)) continue;
			ignored = !pattern.negated;
		}
	}
	return ignored;
}
