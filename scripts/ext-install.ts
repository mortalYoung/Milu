import { lstat, mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = join(ROOT, "extensions");

interface Linked {
	readonly name: string;
	readonly source: string;
	readonly built: readonly string[];
}

function missing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function linked(): Promise<Linked[]> {
	const out: Linked[] = [];
	for (const entry of await readdir(EXTENSIONS, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const source = join(EXTENSIONS, entry.name);
		const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8").catch(() => "{}")) as {
			name?: string;
			main?: string;
			milu?: { widgets?: { entry?: string }[] };
		};
		if (manifest.name === undefined) continue;
		const entries = [manifest.main, ...(manifest.milu?.widgets ?? []).map((widget) => widget.entry)].filter((each): each is string => typeof each === "string");
		out.push({ name: manifest.name, source, built: entries });
	}
	return out;
}

async function main(): Promise<void> {
	const config = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
	const extensions = join(config, "extensions");
	const manifestPath = join(extensions, "package.json");

	const packages = await linked();
	for (const pkg of packages) {
		for (const file of pkg.built)
			await readFile(join(pkg.source, file), "utf8").catch((error: unknown) => {
				if (missing(error)) throw new Error(`${pkg.name} is not built (${file} missing) — run "bun run ext:build" first`);
				throw error;
			});
	}

	let manifest: Record<string, unknown> = {};
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
	} catch (error) {
		if (!missing(error)) throw new Error(`cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	const dependencies = typeof manifest["dependencies"] === "object" && manifest["dependencies"] !== null ? (manifest["dependencies"] as Record<string, unknown>) : {};
	const next = { ...dependencies };
	for (const pkg of packages) next[pkg.name] = "0.0.0";
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify({ ...manifest, private: true, dependencies: next }, null, "\t")}\n`, "utf8");

	for (const pkg of packages) {
		const target = join(extensions, "node_modules", pkg.name);
		await mkdir(dirname(target), { recursive: true });
		try {
			const existing = await lstat(target);
			if (!existing.isSymbolicLink()) throw new Error(`${target} exists and is not a symlink — remove it and run this again`);
			await unlink(target);
		} catch (error) {
			if (!missing(error)) throw error;
		}
		await symlink(pkg.source, target, "dir");
		console.log(`[ext] ${pkg.name} → ${target}`);
	}

	console.log(`[ext] restart Milu to load ${packages.length} extension(s)`);
}

await main();
