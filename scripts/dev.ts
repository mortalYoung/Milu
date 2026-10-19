import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const CHILDREN = [
	{ tag: "server", script: "server" },
	{ tag: "web", script: "dev:web" },
] as const;

const running = new Map<string, ChildProcess>();
let stopping = false;

function pump(tag: string, child: ChildProcess): void {
	for (const stream of [child.stdout, child.stderr]) {
		if (!stream) continue;
		createInterface({ input: stream }).on("line", (line) => console.log(`${tag.padEnd(6)} │ ${line}`));
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
		console.log(`${"dev".padEnd(6)} ┴ stopping ${tag}`);
		signal(child, "SIGTERM");
	}
	setTimeout(() => {
		for (const child of running.values()) signal(child, "SIGKILL");
	}, 2000).unref();
	setTimeout(() => process.exit(process.exitCode ?? 0), 3000);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

for (const { tag, script } of CHILDREN) {
	const child = spawn("bun", ["run", script], { stdio: ["ignore", "pipe", "pipe"], detached: true });
	running.set(tag, child);
	pump(tag, child);

	child.on("exit", (code, error) => {
		running.delete(tag);
		if (!stopping) {
			console.error(`${"dev".padEnd(6)} │ ${tag} exited (${error ?? code}) — stopping the rest`);
			process.exitCode = code && code !== 0 ? code : 1;
			stop();
			return;
		}
		if (running.size === 0) process.exit(process.exitCode ?? 0);
	});
}
