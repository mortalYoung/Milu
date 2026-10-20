import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const RENDERER_URL = "http://127.0.0.1:5173/";
const running = new Map<string, ChildProcess>();
let stopping = false;

function pump(tag: string, child: ChildProcess): void {
	for (const stream of [child.stdout, child.stderr]) {
		if (!stream) continue;
		createInterface({ input: stream }).on("line", (line) => console.log(`${tag.padEnd(8)} │ ${line}`));
	}
}

function signal(child: ChildProcess, name: NodeJS.Signals): void {
	if (child.pid === undefined) return;
	try {
		process.kill(-child.pid, name);
	} catch {
		child.kill(name);
	}
}

function stop(): void {
	if (stopping) return;
	stopping = true;
	for (const [tag, child] of running) {
		console.log(`${"dev".padEnd(8)} ┴ stopping ${tag}`);
		signal(child, "SIGTERM");
	}
	setTimeout(() => {
		for (const child of running.values()) signal(child, "SIGKILL");
	}, 2000).unref();
	setTimeout(() => process.exit(process.exitCode ?? 0), 3000);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function start(tag: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
	const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"], env, detached: true });
	running.set(tag, child);
	pump(tag, child);

	child.on("exit", (code) => {
		running.delete(tag);
		if (stopping) {
			if (running.size === 0) process.exit(process.exitCode ?? 0);
			return;
		}
		console.error(`${tag.padEnd(8)} │ exited (${code ?? "signal"}) — stopping the rest`);
		process.exitCode = code ?? 0;
		stop();
	});
}

async function waitFor(url: string): Promise<void> {
	for (let at = 0; at < 150; at += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// vite is still starting
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`renderer did not start at ${url}`);
}

const build = spawnSync("bun", ["run", "--filter", "@milu/desktop", "build:main"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

start("vite", ["run", "--filter", "@milu/desktop", "dev:renderer"]);
await waitFor(RENDERER_URL);
start("electron", ["run", "--filter", "@milu/desktop", "start"], { ...process.env, MILU_DEV_URL: RENDERER_URL });
