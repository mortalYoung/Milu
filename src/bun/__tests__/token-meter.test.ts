import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../core/session";
import { priceSurface } from "../core/token-meter";

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
		const session = createSessionStore(dir);
		await session.appendUser("hello world", 1); // 11 chars → ceil(11/4)=3
		await session.appendAssistant(
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
		await session.appendSendMessage("ok", {}, 3); // 2 chars → 1
		await session.appendSystemPrompt("sys prompt", 0); // log-only, must not count

		const entries = await session.rawEntries();
		const surface = await session.surface();
		const breakdown = priceSurface("abcd", { bash: "run" }, entries, surface);

		// system "abcd" = 1 token; tools "bash: run" = 9 chars → 3 tokens; messages 11+8+4+2 = 25 chars → 7 tokens
		expect(breakdown.systemTokens).toBe(1);
		expect(breakdown.toolsTokens).toBe(3);
		expect(breakdown.messageTokens).toBe(7);
	});

	it("after a replace, only surviving nodes are priced", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("first question", 1);
		await session.appendSendMessage("first reply", {}, 2);
		await session.appendUser("second question", 3);

		const before = await session.surface();
		const shadowed = before.nodes.slice(0, 1); // compact away the first question
		await session.appendSurfaceOp({ op: "replace", start: 0, end: 0, sourceEventSeqs: [shadowed[0].id], replaceGeneration: 1 }, 4);

		const entries = await session.rawEntries();
		const surface = await session.surface();
		const breakdown = priceSurface("sys", { bash: "run" }, entries, surface);
		// "first question" (14 chars) is gone; "first reply" (11) + "second question" (16) = 27 chars → 7 tokens
		expect(breakdown.messageTokens).toBe(7);
	});
});
