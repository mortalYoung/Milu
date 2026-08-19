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

// Avoid a missing import at the top of the test file
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

		expect((await session.visibleHistory()).map((m) => m.kind)).toEqual(["user", "send_message"]);
		expect((await session.visibleHistory())[1].text).toBe("done");

		// Reopen: a new instance on the same root restores
		const reopened = createSessionStore(dir);
		await reopened.ready();
		expect((await reopened.visibleHistory()).map((m) => m.kind)).toEqual(["user", "send_message"]);
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
				// Messages built by the pi loop carry explicit undefined fields; they must still be storable
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

	it("setRoot switches conversation root per partner", async () => {
		const dirA = await tempDir();
		const dirB = await tempDir();
		const session = createSessionStore(dirA);
		await session.appendUser("in A", 1);
		await session.appendSendMessage("reply A", {}, 2);

		await session.setRoot(dirB);
		expect(await session.visibleHistory()).toEqual([]);
		await session.appendUser("in B", 3);
		expect((await session.visibleHistory()).map((m) => m.text)).toEqual(["in B"]);

		await session.setRoot(dirA);
		expect((await session.visibleHistory()).map((m) => m.text)).toEqual(["in A", "reply A"]);
	});

	it("reads a partner's history by dir while another root is active (isolation)", async () => {
		const dirA = await tempDir();
		const dirB = await tempDir();
		const session = createSessionStore(dirA);
		await session.appendUser("in A", 1);
		await session.appendSendMessage("reply A", {}, 2);
		await session.setRoot(dirB);
		await session.appendUser("in B", 3);

		// The active root is B, but A's history is still readable by dir — the view of a partner
		// whose run is not active never sees the running partner's messages (or vice versa).
		expect((await session.visibleHistory(dirA)).map((m) => m.text)).toEqual(["in A", "reply A"]);
		expect((await session.visibleHistory(dirB)).map((m) => m.text)).toEqual(["in B"]);

		// Appends still go to the active root only
		await session.appendSendMessage("reply B", {}, 4);
		expect((await session.rawEntries(dirA)).length).toBe(2);
		expect((await session.rawEntries(dirB)).length).toBe(2);
	});

	it("lastMessage returns the last visible message (user or send_message), null when empty", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		expect(await session.lastMessage()).toBeNull();

		await session.appendUser("hi", 1);
		expect(await session.lastMessage()).toMatchObject({ kind: "user", text: "hi", time: 1 });

		// Thinking/tool entries in between never become the preview; the reply does
		await session.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await session.appendSendMessage("done", {}, 3);
		expect(await session.lastMessage()).toMatchObject({ kind: "send_message", text: "done", time: 3 });

		// Per-dir isolation: a different root's last message is independent
		const dirB = await tempDir();
		expect(await session.lastMessage(dirB)).toBeNull();
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
		expect((await third.visibleHistory()).map((m) => m.text)).toEqual(["one", "reply one", "two"]);
	});

	it("forkTo copies the log into a new root and the surface re-folds there", async () => {
		const source = await tempDir();
		const fork = await tempDir();
		const session = createSessionStore(source);
		await session.appendUser("q1", 1);
		await session.appendSendMessage("a1", {}, 2);
		await session.appendUser("q2", 3);
		await session.appendSendMessage("a2", {}, 4);

		await session.forkTo(source, fork);

		// the fork re-folds the same surface (deterministic replay) and the same human transcript
		expect((await session.surface(fork)).nodes).toEqual((await session.surface(source)).nodes);
		expect((await session.visibleHistory(fork)).map((m) => m.text)).toEqual(["q1", "a1", "q2", "a2"]);
		expect((await session.deriveMessages(fork)).map((m) => m.role)).toEqual((await session.deriveMessages(source)).map((m) => m.role));
	});
});
