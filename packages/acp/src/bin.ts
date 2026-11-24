import { homedir } from "node:os";
import { join } from "node:path";

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

const { createBackend } = await import("@milu/bootstrap");
const { RpcServer } = await import("./rpc.ts");
const { AcpAgent } = await import("./agent.ts");

const root = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const rpc = new RpcServer((message: unknown) => {
	process.stdout.write(`${JSON.stringify(message)}\n`);
});
const agent = new AcpAgent({ boot: () => createBackend({ root, workspace: process.cwd() }), rpc });
rpc.handlers(agent.handlers());

let closing = false;
const close = async (code: number): Promise<void> => {
	if (closing) return;
	closing = true;
	setTimeout(() => process.exit(code), 2000).unref();
	await agent.dispose().catch((error: unknown) => console.error("acp: dispose failed:", error));
	process.exit(code);
};

process.on("SIGTERM", () => void close(0));
process.on("SIGINT", () => void close(0));

await rpc.serve(process.stdin);
await close(0);
