import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = join(ROOT, "extensions");

interface Manifest {
	readonly name?: string;
	readonly main?: string;
	readonly milu?: { readonly widgets?: readonly { readonly entry?: string }[] };
}

interface Target {
	readonly entry: string;
	readonly outfile: string;
	readonly target: "browser" | "node";
}

/** What the manifest points at, and nothing else: a `.tsx` next to a widget is a module it imports, not a build. */
async function targets(root: string, manifest: Manifest): Promise<Target[]> {
	const out: Target[] = [];
	for (const widget of manifest.milu?.widgets ?? []) {
		if (typeof widget.entry !== "string") continue;
		const stem = basename(widget.entry).replace(/\.js$/, "");
		out.push({ entry: join(root, "src", `${stem}.tsx`), outfile: join(root, widget.entry), target: "browser" });
	}
	if (typeof manifest.main === "string") {
		const stem = basename(manifest.main).replace(/\.js$/, "");
		out.push({ entry: join(root, "src", `${stem}.ts`), outfile: join(root, manifest.main), target: "node" });
	}
	return out;
}

async function main(): Promise<void> {
	let built = 0;
	for (const dir of await readdir(EXTENSIONS, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const root = join(EXTENSIONS, dir.name);
		const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Manifest;
		if (manifest.name === undefined) continue;
		const names: string[] = [];
		for (const target of await targets(root, manifest)) {
			const result = await Bun.build({ entrypoints: [target.entry], outdir: dirname(target.outfile), naming: basename(target.outfile), format: "esm", target: target.target });
			if (!result.success) {
				for (const log of result.logs) console.error(log);
				throw new Error(`${dir.name}: ${target.entry} failed to build`);
			}
			names.push(target.outfile.slice(root.length + 1));
			built += 1;
		}
		console.log(`[ext] ${dir.name} → ${names.join(", ") || "nothing to build"}`);
	}
	console.log(`[ext] ${built} module(s) built`);
}

await main();
