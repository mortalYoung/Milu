import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceSurface } from "../core/token-meter";
import { createSessionStore } from "../persist";

let dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "token-meter-test-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

describe("surface-priced token meter", () => {
	it("prices exactly the surface projection (user/assistant/send_message/tool_result)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hello world", 1); // 11 chars → ceil(11/4)=3
		await scope.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "abcdefgh" }, // 8 chars → 2
					{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "wxyz" }], isError: false, timestamp: 2 }], // 4 chars → 1
			},
			2,
		);
		await scope.appendSendMessage("ok", {}, 3); // 2 chars → 1
		await scope.appendSystemPrompt("sys prompt", 0); // log-only, must not count

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		const breakdown = priceSurface("abcd", [], entries, surface);

		expect(breakdown.systemTokens).toBe(5);
		expect(breakdown.toolsTokens).toBe(0);
		expect(breakdown.messageTokens).toBe(51);
	});

	it("prices tools by their serialized schema (JSON.stringify → 4 chars ≈ 1 token)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hi", 1);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		const tools = [
			{ name: "bash", description: "run a command", parameters: { type: "object", properties: { command: { type: "string" } } } },
			{ name: "read", parameters: { type: "object" } },
		];
		const breakdown = priceSurface("sys", tools, entries, surface);

		expect(breakdown.toolsTokens).toBe(Math.ceil(JSON.stringify(tools).length / 4) + 4);
	});

	it("after a replace, only surviving nodes are priced", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("first question", 1);
		await scope.appendSendMessage("first reply", {}, 2);
		await scope.appendUser("second question", 3);

		const before = await session.surface(dir);
		const shadowed = before.nodes.slice(0, 1); // compact away the first question
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 0, sourceEventSeqs: [shadowed[0].id], replaceGeneration: 1 }, 4);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		const breakdown = priceSurface("sys", [], entries, surface);
		expect(breakdown.messageTokens).toBe(23);
	});
});
