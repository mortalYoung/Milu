import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectView } from "../../shared/entry-meta";
import type { ViewItem } from "../../shared/rpc";
import { createSessionStore, type SessionStore } from "../persist";

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

/** What the transcript would draw: the view projection over the log. */
async function visible(session: SessionStore, dir: string): Promise<ViewItem[]> {
	return projectView(await session.rawEntries(dir));
}

describe("session store (pi JSONL backend)", () => {
	it("appends all kinds; visible history filters; reopen restores", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hi", 1);
		await scope.appendAssistant(
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
		await scope.appendSendMessage("done", { toolCallId: "tc1" }, 3);

		// The assistant's own blocks are what shows: the thought, the call, then the posted line.
		const view = await visible(session, dir);
		expect(view.map((m) => m.kind)).toEqual(["user", "assistant", "assistant", "assistant"]);
		expect(view[1].thinking?.text).toBe("...");
		expect(view[2].tool).toMatchObject({ name: "bash", status: "success", result: "out" });
		expect(view[3].text).toBe("done");

		// Reopen: a new instance on the same root restores
		const reopened = createSessionStore();
		expect((await visible(reopened, dir)).map((m) => m.kind)).toEqual(["user", "assistant", "assistant", "assistant"]);
	});

	it("scopes append to their own roots; per-dir reads stay isolated", async () => {
		const dirA = await tempDir();
		const dirB = await tempDir();
		const session = createSessionStore();
		const scopeA = session.scope(dirA);
		const scopeB = session.scope(dirB);
		await scopeA.appendUser("in A", 1);
		await scopeA.appendSendMessage("reply A", {}, 2);
		await scopeB.appendUser("in B", 3);

		// Each scope's appends land in its own root — the view of a partner whose run is not
		// active never sees the running partner's messages (or vice versa).
		expect((await visible(session, dirA)).map((m) => m.text)).toEqual(["in A", "reply A"]);
		expect((await visible(session, dirB)).map((m) => m.text)).toEqual(["in B"]);

		// Appends to one root never touch the other
		await scopeB.appendSendMessage("reply B", {}, 4);
		expect((await session.rawEntries(dirA)).length).toBe(2);
		expect((await session.rawEntries(dirB)).length).toBe(2);
	});

	it("lastMessage returns the last visible message (user or send_message), null when empty", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		expect(await session.lastMessage(dir)).toBeNull();

		const scope = session.scope(dir);
		await scope.appendUser("hi", 1);
		expect(await session.lastMessage(dir)).toMatchObject({ kind: "user", text: "hi", time: 1 });

		// Thinking/tool entries in between never become the preview; the reply does
		await scope.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await scope.appendSendMessage("done", {}, 3);
		expect(await session.lastMessage(dir)).toMatchObject({ kind: "send_message", text: "done", time: 3 });

		// A message with words of its own is a preview too; tool-only turns are not.
		await scope.appendAssistant({ blocks: [{ type: "text", text: "an answer" }] }, 4);
		expect(await session.lastMessage(dir)).toMatchObject({ kind: "assistant", text: "an answer", time: 4 });

		// Per-dir isolation: a different root's last message is independent
		const dirB = await tempDir();
		expect(await session.lastMessage(dirB)).toBeNull();
	});

	it("single session semantics: second store continues the same conversation", async () => {
		const dir = await tempDir();
		const first = createSessionStore();
		await first.scope(dir).appendUser("one", 1);
		await first.scope(dir).appendSendMessage("reply one", {}, 2);

		const second = createSessionStore();
		await second.scope(dir).appendUser("two", 3);

		const third = createSessionStore();
		expect((await visible(third, dir)).map((m) => m.text)).toEqual(["one", "reply one", "two"]);
	});

	it("rotateSession archives the current log and starts a fresh one", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		await session.scope(dir).appendUser("old", 1);
		await session.scope(dir).appendSendMessage("old reply", {}, 2);
		expect((await visible(session, dir)).map((m) => m.text)).toEqual(["old", "old reply"]);

		const before = await session.sessionStartedAt(dir);
		const newId = await session.rotateSession(dir);
		expect(newId).toBeTruthy();
		expect(await visible(session, dir)).toEqual([]);
		expect(await session.rawEntries(dir)).toEqual([]);
		// A cleared chat has no message left, but the fresh session dates the row: the start time moves forward.
		expect(await session.lastMessage(dir)).toBeNull();
		expect(await session.sessionStartedAt(dir)).toBeGreaterThanOrEqual(before);

		// new writes land in the fresh file
		await session.scope(dir).appendUser("new", 3);
		expect((await visible(session, dir)).map((m) => m.text)).toEqual(["new"]);

		// reopening on the same root resumes the fresh (newest) session, old log stays archived
		const reopened = createSessionStore();
		expect((await visible(reopened, dir)).map((m) => m.text)).toEqual(["new"]);
	});

	it("forkTo re-creates the current session and keeps the cleared logs archived", async () => {
		const source = await tempDir();
		const target = join(await tempDir(), "milu-fork");
		const session = createSessionStore();
		await session.scope(source).appendUser("before the clear", 1);
		await session.rotateSession(source);
		await session.scope(source).appendUser("after the clear", 2);

		await session.forkTo(source, target);

		const forked = createSessionStore();
		expect((await visible(forked, target)).map((m) => m.text)).toEqual(["after the clear"]);
		expect(await forked.allRawEntries(target)).toHaveLength(2);
	});
});
