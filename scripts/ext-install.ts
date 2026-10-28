import { lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "extensions", "telemetry");
const PACKAGE = "milu-telemetry";

function missing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function main(): Promise<void> {
	const config = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
	const extensions = join(config, "extensions");
	const manifestPath = join(extensions, "package.json");
	const target = join(extensions, "node_modules", PACKAGE);

	try {
		await readFile(join(SOURCE, "dist", "widget.js"), "utf8");
	} catch (error) {
		if (missing(error)) throw new Error(`${PACKAGE} is not built — run "bun run ext:build" first`);
		throw error;
	}

	let manifest: Record<string, unknown> = {};
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
	} catch (error) {
		if (!missing(error)) throw new Error(`cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
	}

	const dependencies = typeof manifest["dependencies"] === "object" && manifest["dependencies"] !== null ? (manifest["dependencies"] as Record<string, unknown>) : {};
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify({ ...manifest, private: true, dependencies: { ...dependencies, [PACKAGE]: "0.0.0" } }, null, "\t")}\n`, "utf8");

	await mkdir(dirname(target), { recursive: true });
	try {
		const existing = await lstat(target);
		if (!existing.isSymbolicLink()) throw new Error(`${target} exists and is not a symlink — remove it and run this again`);
		await unlink(target);
	} catch (error) {
		if (!missing(error)) throw error;
	}
	await symlink(SOURCE, target, "dir");

	console.log(`[ext] ${PACKAGE} → ${target}`);
	console.log(`[ext] restart Milu to load the extension`);
}

await main();
