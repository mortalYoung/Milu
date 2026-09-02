import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldSurface, reconstructRequestHeader, SurfaceError, surfaceNodeIds } from "../core/surface";
import { createSessionStore } from "../persist";

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
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendSystemPrompt("sys", 0);
		await scope.appendUser("hi", 1);
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

		const { nodes, replaceGeneration } = await session.surface(dir);
		expect(replaceGeneration).toBe(0);
		// system_prompt is log-only; user/assistant/tool_result/send_message join the surface
		expect(nodes.map((n) => n.kind)).toEqual(["user", "assistant", "tool_result", "send_message"]);
		// seq = surface position at append time
		expect(nodes.map((n) => n.seq)).toEqual([0, 1, 2, 3]);
	});

	it("applies a logged replace and validates provenance", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q1", 1);
		await scope.appendAssistant(
			{
				blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await scope.appendSendMessage("a1", {}, 3);

		const before = await session.surface(dir);
		const shadowed = before.nodes.slice(0, 2); // user + assistant (the compaction range)
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 1, sourceEventSeqs: shadowed.map((n) => n.id), replaceGeneration: 1 }, 4);

		const after = await session.surface(dir);
		expect(after.replaceGeneration).toBe(1);
		expect(after.nodes.map((n) => n.kind)).toEqual(["tool_result", "send_message"]);
		// surviving nodes keep their append-time seqs (non-monotonic after replace)
		expect(after.nodes.map((n) => n.seq)).toEqual([2, 3]);
		// the replaced (shadowed) entries are still in the log — nothing was deleted
		expect((await session.rawEntries(dir)).length).toBe(5);
	});

	it("rejects a replace whose sourceEventSeqs do not cover the shadowed range", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q1", 1);
		await scope.appendUser("q2", 2);
		const { nodes } = await session.surface(dir);
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 1, sourceEventSeqs: [nodes[0].id], replaceGeneration: 1 }, 3);
		await expect(session.surface(dir)).rejects.toThrow(SurfaceError);
		// foldSurface directly also throws
		const raw = await session.rawEntries(dir);
		expect(() => foldSurface(raw)).toThrow(SurfaceError);
	});

	it("deriveMessages projects the same chain as restoreMessages for an append-only log", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hello", 1);
		await scope.appendAssistant(
			{
				blocks: [
					{ type: "thinking", thinking: "..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
				],
				toolResults: [{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "out" }], isError: false, timestamp: 2 }],
			},
			2,
		);
		await scope.appendSendMessage("done", {}, 3);

		const restored = await session.restoreMessages(dir);
		const derived = await session.deriveMessages(dir);
		expect(derived.map((m) => m.role)).toEqual(restored.map((m) => m.role));
		expect(derived[0]).toMatchObject({ role: "user", content: "hello" });
		expect(derived[derived.length - 1]).toMatchObject({ role: "custom", customType: "send_message", content: "done" });
	});

	it("surfaceNodeIds is window-safe when a replace shadows unloaded nodes", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		for (let i = 0; i < 5; i++) await scope.appendUser(`q${i}`, i + 1);
		const { nodes } = await session.surface(dir);
		const shadowed = nodes.slice(0, 3);
		const summaryId = await scope.appendCompactionSummary("compacted", 10);
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 2, sourceEventSeqs: shadowed.map((n) => n.id), replaceGeneration: 1, checkpointId: summaryId }, 11);
		await scope.appendUser("after", 12);

		const all = await session.rawEntries(dir);
		const fullIds = foldSurface(all).nodes.map((n) => n.id);
		const afterId = all.find((e) => e.type === "message" && (e.message as { content?: unknown }).content === "after")!.id;
		// A newest-page window that holds the op but not the whole shadowed prefix cannot be
		// positionally replayed, but membership can still be derived from sourceEventSeqs.
		const suffix = all.slice(-3); // compaction_summary + surface_op + the user after
		expect(() => foldSurface(suffix)).toThrow(SurfaceError);
		expect(surfaceNodeIds(suffix)).toEqual(new Set([summaryId, afterId]));
		expect(surfaceNodeIds(all)).toEqual(new Set(fullIds));
	});

	it("surface_op records never leak into the human transcript", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hi", 1);
		const { nodes } = await session.surface(dir);
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 0, sourceEventSeqs: [nodes[0].id], replaceGeneration: 1 }, 2);
		expect((await session.visibleHistory(dir)).map((v) => v.kind)).toEqual(["user"]);
		// the human transcript stays complete even though the surface shrank
		expect((await session.surface(dir)).nodes.map((n) => n.kind)).toEqual([]);
	});

	it("two scopes append to their own roots concurrently (per-agent isolation)", async () => {
		const dirA = await tempDir();
		const dirB = await tempDir();
		const session = createSessionStore();
		const scopeA = session.scope(dirA);
		const scopeB = session.scope(dirB);
		await scopeA.appendUser("in A", 1);
		await scopeB.appendUser("in B", 2);
		// interleave: one more append to A after B is open — each scope's appends land in its own root
		await scopeA.appendUser("also A", 3);
		expect((await session.surface(dirA)).nodes.map((n) => n.kind)).toEqual(["user", "user"]);
		expect((await session.surface(dirB)).nodes.map((n) => n.kind)).toEqual(["user"]);
	});

	it("deriveMessages drops a trailing dangling turn (orphan tool call without result)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("do it", 1);
		// restart-interruption: assistant made a toolCall but no toolResult ever arrived
		await scope.appendAssistant({ blocks: [{ type: "toolCall", id: "t9", name: "bash", arguments: {} }] }, 2);

		const derived = await session.deriveMessages(dir);
		expect(derived).toHaveLength(1);
		expect(derived[0]).toMatchObject({ role: "user" });
		// the surface still folds both nodes; only the projection drops the dangling turn
		expect((await session.surface(dir)).nodes.map((n) => n.kind)).toEqual(["user", "assistant"]);
	});

	it("appendRequestHeader + reconstructRequestHeader close the loop (invariant 1)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("hi", 1);
		await scope.appendRequestHeader("# IDENTIFY\nYou are an agent.", [{ name: "read" }, { name: "bash" }, { name: "send_message" }], 2);
		await scope.appendRequestHeader("# IDENTIFY\nYou are an agent (v2).", [{ name: "read", description: "read a file", parameters: { type: "object" } }, { name: "bash" }], 3);

		const entries = await session.rawEntries(dir);
		const header = reconstructRequestHeader(entries);
		expect(header).not.toBeNull();
		expect(header!.systemPrompt).toBe("# IDENTIFY\nYou are an agent (v2).");
		expect(header!.toolNames).toEqual(["read", "bash"]);
		expect(header!.tools.map((t) => t.name)).toEqual(["read", "bash"]);
		expect(header!.tools[0].description).toBe("read a file");
		expect(header!.time).toBe(3);
		// request/header entries are log-only — never on the surface, never in the human transcript
		expect((await session.surface(dir)).nodes.map((n) => n.kind)).toEqual(["user"]);
		expect((await session.visibleHistory(dir)).map((v) => v.kind)).toEqual(["user"]);
	});

	it("appendRequestHeader strips undefined fields (pi rejects undefined payloads)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendRequestHeader("sys", [{ name: "read", parameters: { type: "object", properties: { path: undefined } } }], 1);

		const entries = await session.rawEntries(dir);
		const header = reconstructRequestHeader(entries);
		expect(header).not.toBeNull();
		expect(header!.tools).toEqual([{ name: "read", parameters: { type: "object", properties: {} } }]);
	});
});
