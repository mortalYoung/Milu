import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../core/session";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "session-test-"));
	dirs.push(dir);
	return dir;
}

// 避免测试文件顶部 import 缺失
describe("session store (pi JSONL backend)", () => {
	it("appends all kinds; visible history filters; reopen restores", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.ready();
		await session.appendUser("hi", 1);
		await session.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			},
			2,
		);
		await session.appendSendMessage("done", { toolCallId: "tc1" }, 3);

		expect(session.visibleHistory().map((m) => m.kind)).toEqual(["user", "send_message"]);
		expect(session.visibleHistory()[1].text).toBe("done");

		// 重开:同一根目录新实例恢复
		const reopened = createSessionStore(dir);
		await reopened.ready();
		expect(reopened.visibleHistory().map((m) => m.kind)).toEqual(["user", "send_message"]);
	});

	it("restoreMessages rebuilds the full chain in order", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("hello", 1);
		await session.appendAssistant(
			{
				blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await session.appendSendMessage("done", {}, 3);

		const restored = await session.restoreMessages();
		expect(restored).toHaveLength(4);
		expect(restored[0]).toMatchObject({ role: "user", content: "hello" });
		expect(restored[1]).toMatchObject({ role: "assistant" });
		expect(restored[2]).toMatchObject({ role: "toolResult", toolCallId: "t1" });
		expect(restored[3]).toMatchObject({ role: "custom", customType: "send_message", content: "done", display: true });
	});

	it("drops a trailing incomplete turn (tool_use without tool_result)", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("hi", 1);
		await session.appendAssistant({ blocks: [{ type: "toolCall", id: "t9", name: "bash", arguments: {} }] }, 2);

		const restored = await session.restoreMessages();
		expect(restored).toHaveLength(1);
		expect(restored[0]).toMatchObject({ role: "user" });
	});

	it("strips undefined fields from pi messages (toolResult details/usage)", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendAssistant(
			{
				blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
				// pi 循环构造的消息带显式 undefined 字段,必须能入库
				toolResults: [
					{
						role: "toolResult",
						toolCallId: "t1",
						toolName: "bash",
						content: [{ type: "text", text: "out" }],
						isError: false,
						timestamp: 2,
						details: undefined,
						usage: undefined,
					} as never,
				],
			},
			2,
		);
		const restored = await session.restoreMessages();
		expect(restored).toHaveLength(2);
		expect(restored[1]).toMatchObject({ role: "toolResult", toolCallId: "t1" });
	});

	it("single session semantics: second store continues the same conversation", async () => {
		const dir = await tempDir();
		const first = createSessionStore(dir);
		await first.appendUser("one", 1);
		await first.appendSendMessage("reply one", {}, 2);

		const second = createSessionStore(dir);
		await second.ready();
		await second.appendUser("two", 3);

		const third = createSessionStore(dir);
		await third.ready();
		expect(third.visibleHistory().map((m) => m.text)).toEqual(["one", "reply one", "two"]);
	});
});
