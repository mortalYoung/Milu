import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const electron = createRequire(import.meta.url)("electron") as string;
const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const debugPort = process.env["MILU_DEBUG_PORT"];
const argv = [...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []), ...process.argv.slice(2)];
const child = spawn(electron, [app, ...argv], { stdio: "inherit" });

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
