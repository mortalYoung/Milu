import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../core/session";
import { foldSurface, reconstructRequestHeader, SurfaceError } from "../core/surface";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "surface-test-"));
	dirs.push(dir);
	return dir;
}

describe("session surface (log → surface → dialogue)", () => {
	it("folds an append-only log into surface nodes, skipping log-only entries", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendSystemPrompt("sys", 0);
		await session.appendUser("hi", 1);
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

		const { nodes, replaceGeneration } = await session.surface();
		expect(replaceGeneration).toBe(0);
		// system_prompt is log-only; user/assistant/tool_result/send_message join the surface
		expect(nodes.map((n) => n.kind)).toEqual(["user", "assistant", "tool_result", "send_message"]);
		// seq = surface position at append time
		expect(nodes.map((n) => n.seq)).toEqual([0, 1, 2, 3]);
	});

	it("applies a logged replace and validates provenance", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("q1", 1);
		await session.appendAssistant(
			{
				blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await session.appendSendMessage("a1", {}, 3);

		const before = await session.surface();
		const shadowed = before.nodes.slice(0, 2); // user + assistant (the compaction range)
		await session.appendSurfaceOp({ op: "replace", start: 0, end: 1, sourceEventSeqs: shadowed.map((n) => n.id), replaceGeneration: 1 }, 4);

		const after = await session.surface();
		expect(after.replaceGeneration).toBe(1);
		expect(after.nodes.map((n) => n.kind)).toEqual(["tool_result", "send_message"]);
		// surviving nodes keep their append-time seqs (non-monotonic after replace)
		expect(after.nodes.map((n) => n.seq)).toEqual([2, 3]);
		// the replaced (shadowed) entries are still in the log — nothing was deleted
		expect((await session.rawEntries()).length).toBe(5);
	});

	it("rejects a replace whose sourceEventSeqs do not cover the shadowed range", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("q1", 1);
		await session.appendUser("q2", 2);
		const { nodes } = await session.surface();
		await session.appendSurfaceOp({ op: "replace", start: 0, end: 1, sourceEventSeqs: [nodes[0].id], replaceGeneration: 1 }, 3);
		await expect(session.surface()).rejects.toThrow(SurfaceError);
		// foldSurface directly also throws
		const raw = await session.rawEntries();
		expect(() => foldSurface(raw)).toThrow(SurfaceError);
	});

	it("deriveMessages projects the same chain as restoreMessages for an append-only log", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("hello", 1);
		await session.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await session.appendSendMessage("done", {}, 3);

		const restored = await session.restoreMessages();
		const derived = await session.deriveMessages();
		expect(derived.map((m) => m.role)).toEqual(restored.map((m) => m.role));
		expect(derived[0]).toMatchObject({ role: "user", content: "hello" });
		expect(derived[derived.length - 1]).toMatchObject({ role: "custom", customType: "send_message", content: "done" });
	});

	it("surface_op records never leak into the human transcript", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("hi", 1);
		const { nodes } = await session.surface();
		await session.appendSurfaceOp({ op: "replace", start: 0, end: 0, sourceEventSeqs: [nodes[0].id], replaceGeneration: 1 }, 2);
		expect((await session.visibleHistory()).map((v) => v.kind)).toEqual(["user"]);
		// the human transcript stays complete even though the surface shrank
		expect((await session.surface()).nodes.map((n) => n.kind)).toEqual([]);
	});

	it("reads a partner's surface by dir while another root is active (isolation)", async () => {
		const dirA = await tempDir();
		const dirB = await tempDir();
		const session = createSessionStore(dirA);
		await session.appendUser("in A", 1);
		await session.setRoot(dirB);
		await session.appendUser("in B", 2);
		expect((await session.surface(dirA)).nodes.map((n) => n.kind)).toEqual(["user"]);
		expect((await session.surface(dirB)).nodes.map((n) => n.kind)).toEqual(["user"]);
	});

	it("deriveMessages drops a trailing dangling turn (orphan tool call without result)", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("do it", 1);
		// restart-interruption: assistant made a toolCall but no toolResult ever arrived
		await session.appendAssistant({ blocks: [{ type: "toolCall", id: "t9", name: "bash", arguments: {} }] }, 2);

		const derived = await session.deriveMessages();
		expect(derived).toHaveLength(1);
		expect(derived[0]).toMatchObject({ role: "user" });
		// the surface still folds both nodes; only the projection drops the dangling turn
		expect((await session.surface()).nodes.map((n) => n.kind)).toEqual(["user", "assistant"]);
	});

	it("appendRequestHeader + reconstructRequestHeader close the loop (invariant 1)", async () => {
		const dir = await tempDir();
		const session = createSessionStore(dir);
		await session.appendUser("hi", 1);
		await session.appendRequestHeader("# IDENTIFY\nYou are an agent.", ["read", "bash", "send_message"], 2);
		await session.appendRequestHeader("# IDENTIFY\nYou are an agent (v2).", ["read", "bash"], 3);

		const entries = await session.rawEntries();
		const header = reconstructRequestHeader(entries);
		expect(header).not.toBeNull();
		expect(header!.systemPrompt).toBe("# IDENTIFY\nYou are an agent (v2).");
		expect(header!.toolNames).toEqual(["read", "bash"]);
		expect(header!.time).toBe(3);
		// request/header entries are log-only — never on the surface, never in the human transcript
		expect((await session.surface()).nodes.map((n) => n.kind)).toEqual(["user"]);
		expect((await session.visibleHistory()).map((v) => v.kind)).toEqual(["user"]);
	});
});
