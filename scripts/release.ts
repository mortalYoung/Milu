import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ARTIFACTS = join(ROOT, "artifacts");
const PACKAGES = ["protocol", "extension-types"] as const;

interface Manifest {
	readonly name: string;
	readonly version: string;
	readonly type?: string;
	readonly dependencies?: Record<string, string>;
	readonly publishConfig?: { readonly access?: string; readonly exports?: unknown };
}

async function readManifest(dir: string): Promise<Manifest> {
	return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
}

async function build(dir: string): Promise<void> {
	const tsc = Bun.spawnSync(["bun", join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], { cwd: dir, stderr: "inherit", stdout: "inherit" });
	if (tsc.exitCode !== 0) throw new Error(`${dir}: tsc exited with ${tsc.exitCode}`);
}

async function resolve(dep: string, version: string): Promise<string> {
	if (!version.startsWith("workspace:")) return version;
	const range = version.slice("workspace:".length);
	const target = await readManifest(join(ROOT, "packages", dep.split("/")[1] ?? ""));
	if (range === "*") return target.version;
	if (range === "^" || range === "~") return `${range}${target.version}`;
	return range;
}

async function stage(name: string): Promise<void> {
	const dir = join(ROOT, "packages", name);
	await build(dir);

	const manifest = await readManifest(dir);
	const dependencies: Record<string, string> = {};
	for (const [dep, version] of Object.entries(manifest.dependencies ?? {})) dependencies[dep] = await resolve(dep, version);

	const staged = {
		name: manifest.name,
		version: manifest.version,
		type: manifest.type ?? "module",
		exports: manifest.publishConfig?.exports,
		files: ["dist"],
		dependencies,
		...(manifest.publishConfig?.access === undefined ? {} : { publishConfig: { access: manifest.publishConfig.access } }),
	};

	const out = join(ARTIFACTS, name);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await cp(join(dir, "dist"), join(out, "dist"), { recursive: true });
	await writeFile(join(out, "package.json"), `${JSON.stringify(staged, null, "\t")}\n`);
	console.log(`${staged.name}@${staged.version} → ${out}\n  cd artifacts/${name} && bun publish`);
}

for (const name of PACKAGES) await stage(name);
