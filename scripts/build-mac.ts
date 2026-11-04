import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "artifacts");
const DESKTOP = join(ROOT, "packages", "desktop");
const STAGE = join(OUT, "dmg-stage");
const APP = join(OUT, "electron-builder", "mac-arm64", "Milu.app");
const ENV = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env["PATH"] ?? ""}` };

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = ENV): void {
	const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "signal"}`);
}

async function version(): Promise<string> {
	const manifest = JSON.parse(await readFile(join(DESKTOP, "package.json"), "utf8")) as { version: string };
	return manifest.version;
}

const semver = await version();
const dmg = join(OUT, `Milu-${semver}-arm64.dmg`);

try {
	console.log(`[build] compiling desktop ${semver}`);
	await rm(join(DESKTOP, "dist-electron"), { recursive: true, force: true });
	run(process.execPath, ["run", "build"], DESKTOP);

	console.log("[build] packaging the app with electron-builder");
	run(join(ROOT, "node_modules", ".bin", "electron-builder"), ["--mac", "dir", "--config", "electron-builder.yml"], DESKTOP, {
		...ENV,
		ELECTRON_BUILDER_CACHE: join(OUT, ".cache", "electron-builder"),
	});

	console.log(`[build] creating ${dmg}`);
	await rm(STAGE, { recursive: true, force: true });
	await mkdir(STAGE, { recursive: true });
	run("ditto", [APP, join(STAGE, "Milu.app")]);
	await symlink("/Applications", join(STAGE, "Applications"));
	run("hdiutil", ["create", "-volname", `Milu ${semver}`, "-srcfolder", STAGE, "-ov", "-format", "UDZO", dmg]);
	run("hdiutil", ["verify", dmg]);
	await rm(STAGE, { recursive: true, force: true });
	console.log(`[build] ${dmg}`);
} catch (error) {
	console.error(`[build] failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
