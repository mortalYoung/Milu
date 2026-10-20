import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

interface Rule {
	readonly pkg: string;
	readonly dir?: string;
	readonly match?: RegExp;
	readonly forbid: readonly (string | RegExp)[];
	readonly why: string;
}

const WINDOW_HALF = [/^node:/, "electron", /^@milu\/(core|desktop|di)$/];
const WINDOW_WHY = "a window module renders in the renderer: host types only, no server or core code";

const RULES: readonly Rule[] = [
	{ pkg: "protocol", forbid: [/^node:/, "electron"], why: "the wire is method maps and events — no runtime" },
	{ pkg: "di", forbid: [/^node:/, "electron"], why: "the lifecycle vocabulary has no runtime" },
	{
		pkg: "core",
		forbid: [/^node:(?!fs|os|path|url|child_process|crypto)/, "electron", /^@milu\/(extensions|desktop|bootstrap)$/],
		why: "the core is reached through events, never through a shell",
	},
	{ pkg: "bootstrap", forbid: ["electron", /^@milu\/desktop$/], why: "the composition root composes libraries; shells import it, not the reverse" },
	{
		pkg: "extensions",
		forbid: ["electron", /^@milu\/(desktop|bootstrap)$/],
		why: "an extension gets core capabilities and host types, nothing about a shell",
	},
	{
		pkg: "extensions",
		dir: "extensions/src/host",
		forbid: [/^node:/, "electron", /^@milu\/(core|desktop|bootstrap)$/],
		why: "the window runtime cannot reach the Node side or the core",
	},
	{
		pkg: "extensions",
		dir: "extensions/src/markdown",
		forbid: [/^node:/, "electron", /^@milu\/(core|desktop|bootstrap)$/],
		why: "a renderer runs in the window: its own libraries, nothing about a shell",
	},
	{ pkg: "extensions", dir: "extensions/src/web", forbid: WINDOW_HALF, why: WINDOW_WHY },
	{ pkg: "extensions", dir: "extensions/src", match: /\.tsx$/, forbid: WINDOW_HALF, why: WINDOW_WHY },
	{
		pkg: "desktop",
		dir: "desktop/src",
		forbid: [/^@milu\/(extensions|desktop)$/, /^@milu\/bootstrap\/frontend$/],
		why: "the main process runs the core and the IPC edge; browser code stays in the renderer",
	},
	{
		pkg: "desktop",
		dir: "desktop/renderer",
		forbid: [/^node:/, "electron", /^@milu\/(core|desktop)$/, /^@milu\/bootstrap$/, /^@milu\/extensions$/],
		why: "the renderer is a browser: host services and contributions, never the core, the shell, or node",
	},
];

const ROOT = join(new URL("..", import.meta.url).pathname, "packages");
const SPECIFIER = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

async function sources(dir: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			found.push(...(await sources(path)));
			continue;
		}
		if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(path);
	}
	return found;
}

const violations: string[] = [];

for (const rule of RULES) {
	const dir = join(ROOT, rule.dir ?? join(rule.pkg, "src"));
	for (const file of await sources(dir)) {
		const rel = relative(ROOT, file);
		if (rule.match && !rule.match.test(rel)) continue;
		const text = await readFile(file, "utf8");
		for (const match of text.matchAll(SPECIFIER)) {
			const specifier = match[1] ?? "";
			if (!rule.forbid.some((pattern) => (typeof pattern === "string" ? pattern === specifier : pattern.test(specifier)))) continue;
			violations.push(`${rel} imports "${specifier}" — ${rule.why}`);
		}
	}
}

if (violations.length === 0) {
	console.log(`boundaries: ${RULES.length} rules, no violations`);
} else {
	for (const violation of violations) console.error(violation);
	console.error(`\nboundaries: ${violations.length} violation(s)`);
	process.exit(1);
}
