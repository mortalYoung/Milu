import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const LODY = process.env["ACP_PROBE_LODY"] === "1";
const LODY_CWD = ((): string | undefined => {
	if (!LODY) return undefined;
	const root = process.env["LODY_DATA_DIR"] ?? join(homedir(), ".lody");
	const dir = join(root, "chats", `probe-${Date.now().toString(36)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
})();

const BIN = new URL("../packages/acp/src/bin.ts", import.meta.url).pathname;
const args = process.argv.slice(2);
const imageAt = args.indexOf("--image");
const IMAGE = imageAt >= 0 ? args[imageAt + 1] : undefined;
const PROMPT = args.filter((_, index) => index !== imageAt && index !== imageAt + 1).join(" ") || "用一句话说明你是什么。";
const ANSWER = process.env["ACP_PROBE_PERMISSION"] ?? "allow_once";

const child = spawn(process.execPath, [BIN], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
const started = Date.now();
const mark = (label: string): void => console.error(`[probe] ${label} +${Date.now() - started}ms`);

const pending = new Map<number, (value: unknown) => void>();
let seq = 0;

function call(method: string, params: unknown): Promise<unknown> {
	const id = ++seq;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

function reply(id: unknown, result: unknown): void {
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

createInterface({ input: child.stderr }).on("line", (line) => console.error(`[agent] ${line}`));

createInterface({ input: child.stdout }).on("line", (line) => {
	if (line.trim() === "") return;
	const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
	if (message.method === "session/update") {
		const update = (message.params?.["update"] ?? {}) as Record<string, unknown>;
		const kind = String(update["sessionUpdate"] ?? "?");
		if (kind === "agent_message_chunk") {
			const content = update["content"] as { text?: string } | undefined;
			process.stdout.write(content?.text ?? "");
			return;
		}
		if (kind === "available_commands_update") {
			const commands = update["availableCommands"] as unknown[] | undefined;
			console.error(`[update] commands: ${commands?.length ?? 0} → ${JSON.stringify((commands ?? []).slice(0, 6))}`);
			return;
		}
		console.error(`[update] ${kind} ${JSON.stringify(update).slice(0, 160)}`);
		return;
	}
	if (typeof message.method === "string" && message.method.startsWith("_lody/")) {
		console.error(`[lody] ${message.method} ${JSON.stringify(message.params).slice(0, 320)}`);
		return;
	}
	if (message.method === "session/request_permission") {
		const params = message.params ?? {};
		console.error(
			`[probe] permission: ${JSON.stringify(params["toolCall"]).slice(0, 220)} options=${JSON.stringify((params["options"] as unknown[])?.map((option) => (option as { optionId?: string }).optionId))}`,
		);
		console.error(`[probe] answering ${ANSWER}`);
		reply(message.id, { outcome: { outcome: "selected", optionId: ANSWER } });
		return;
	}
	if (typeof message.id === "number") {
		const resolve = pending.get(message.id);
		pending.delete(message.id);
		if (message.error !== undefined) console.error(`[error] ${JSON.stringify(message.error)}`);
		resolve?.(message.error === undefined ? message.result : { error: message.error });
	}
});

const timer = setTimeout(() => {
	console.error("[probe] timed out");
	child.kill("SIGTERM");
}, 180_000);

try {
	mark("initialize");
	const init = await call("initialize", {
		protocolVersion: 1,
		clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
		clientInfo: { name: LODY ? "lody" : "acp-probe", title: LODY ? "Lody" : "acp-probe", version: "1" },
	});
	console.error(`[probe] initialize → ${JSON.stringify(init).slice(0, 400)}`);

	mark("session/new");
	const cwd = process.env["ACP_PROBE_NO_CWD"] === "1" ? "" : (LODY_CWD ?? process.cwd());
	const wanted = process.env["ACP_PROBE_WANT_MODEL"];
	const mcpServers =
		process.env["ACP_PROBE_MCP"] === "1"
			? [{ name: "probe", command: process.execPath, args: [new URL("../packages/extensions/mcp-echo-probe.ts", import.meta.url).pathname], env: [] }]
			: [];
	const created = (await call("session/new", {
		cwd,
		mcpServers,
		...(LODY && wanted !== undefined ? { _meta: { lody: { sessionConfig: { version: 1, modelId: wanted } } } } : {}),
	})) as { sessionId?: string; modes?: unknown; error?: unknown };
	console.error(`[probe] session/new → ${JSON.stringify(created)}`);
	if (created.sessionId === undefined) throw new Error("no session id");

	const setConfig = process.env["ACP_PROBE_CONFIG"];
	if (setConfig !== undefined) {
		const [configId = "", value = ""] = setConfig.split("=");
		mark(`set_config_option ${configId}=${value}`);
		const applied = await call("session/set_config_option", { sessionId: created.sessionId, configId, value });
		console.error(`[probe] set_config_option → ${JSON.stringify(applied).slice(0, 320)}`);
	}

	mark("session/list");
	const listCwd = process.env["ACP_PROBE_LIST_CWD"] === "scratch" ? LODY_CWD : process.cwd();
	const listed = (await call("session/list", { cwd: listCwd })) as { sessions?: unknown[]; error?: unknown };
	console.error(`[probe] session/list → ${JSON.stringify(listed.sessions?.slice(0, 3))} count=${listed.sessions?.length ?? 0}`);

	mark("session/load");
	const loaded = (await call("session/load", { sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] })) as { modes?: unknown; error?: unknown };
	console.error(`[probe] session/load → ${JSON.stringify(loaded).slice(0, 200)}`);

	mark("session/prompt");
	const attachments: unknown[] = [];
	if (IMAGE !== undefined) {
		const bytes = readFileSync(IMAGE);
		const mimeType = IMAGE.endsWith(".png") ? "image/png" : IMAGE.endsWith(".webp") ? "image/webp" : IMAGE.endsWith(".gif") ? "image/gif" : "image/jpeg";
		console.error(`[probe] image ${IMAGE} ${bytes.length} bytes as ${mimeType}`);
		attachments.push({ type: "image", mimeType, data: bytes.toString("base64"), uri: `file://${IMAGE}` });
	}
	const turns = Number(process.env["ACP_PROBE_TURNS"] ?? "1");
	let result: unknown = null;
	for (let turn = 0; turn < turns; turn += 1) {
		mark(`session/prompt ${turn + 1}/${turns}`);
		const prompt: unknown[] = [{ type: "text", text: turn === 0 ? PROMPT : `${PROMPT}（第 ${turn + 1} 次）` }];
		if (turn === 0) prompt.push(...attachments);
		result = await call("session/prompt", { sessionId: created.sessionId, prompt });
	}
	console.error(`\n[probe] prompt → ${JSON.stringify(result)}`);

	if (process.env["ACP_PROBE_FORK"] === "1") {
		mark("session/fork");
		const forked = (await call("session/fork", { sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] })) as { sessionId?: string; error?: unknown };
		console.error(`[probe] session/fork → ${JSON.stringify(forked).slice(0, 300)}`);
		const forkedId = forked.sessionId;
		if (typeof forkedId === "string") {
			const reopened = await call("session/load", { sessionId: forkedId, cwd: process.cwd(), mcpServers: [] });
			console.error(`[probe] load fork → ${JSON.stringify(reopened).slice(0, 160)}`);
			const removed = await call("session/delete", { sessionId: forkedId });
			console.error(`[probe] delete fork → ${JSON.stringify(removed)}`);
		}
	}

	if (process.env["ACP_PROBE_DELETE"] === "1") {
		mark("session/delete");
		const deleted = await call("session/delete", { sessionId: created.sessionId });
		console.error(`[probe] session/delete → ${JSON.stringify(deleted)}`);
		const after = (await call("session/list", { cwd: process.env["ACP_PROBE_NO_CWD"] === "1" ? undefined : process.cwd() })) as { sessions?: { sessionId?: string }[] };
		const names = (after.sessions ?? []).map((each) => each.sessionId);
		console.error(`[probe] after delete: ${names.length} sessions, contains deleted = ${names.includes(created.sessionId)}`);
		const again = await call("session/load", { sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] });
		console.error(`[probe] load after delete → ${JSON.stringify(again).slice(0, 200)}`);
	}
} finally {
	clearTimeout(timer);
	child.stdin.end();
	await new Promise((resolve) => child.on("exit", resolve));
}
