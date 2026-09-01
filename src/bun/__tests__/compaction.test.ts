import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { SurfaceNode } from "../../shared/surface";
import { applyCompaction, planCompaction, selectCompactableRange } from "../core/compaction";
import { foldSurface } from "../core/surface";
import { createSessionStore } from "../persist";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "compaction-test-"));
	dirs.push(dir);
	return dir;
}

const node = (kind: SurfaceNode["kind"], i: number): SurfaceNode => ({ kind, seq: i, id: `id-${kind}-${i}`, time: i });

const contentOf = (m: AgentMessage) => String((m as { content?: unknown }).content ?? "");

/** Long enough that the Q/A transcript with per-line truncation is genuinely smaller. */
const LONG_Q = "Can you please explain in detail how the session surface refactor works, step by step, so I can understand the three-layer model?";
const LONG_A = "Yes — the log is the single source of truth, the surface is a derived projection, and the dialogue is derived from the surface. Here are the details.";

const toolEntry = (n: SurfaceNode, callId: string): Entry =>
	({
		type: "message",
		id: n.id,
		seq: n.seq,
		parentId: null,
		timestamp: 0,
		message: { role: "assistant", content: [{ type: "toolCall", id: callId, name: "bash" }] },
	}) as unknown as Entry;

const resultEntry = (n: SurfaceNode, callId: string): Entry =>
	({ type: "custom", id: n.id, seq: n.seq, parentId: null, timestamp: 0, customType: "tool/result", data: { toolCallId: callId } }) as unknown as Entry;

describe("selectCompactableRange", () => {
	it("compacts the head, keeping the tail budget", () => {
		const nodes: SurfaceNode[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => node("user", i));
		expect(selectCompactableRange([], nodes, 3)).toEqual({ start: 0, end: 6 });
	});

	it("returns null when there is nothing to compact", () => {
		const nodes: SurfaceNode[] = [0, 1, 2, 3].map((i) => node("user", i));
		expect(selectCompactableRange([], nodes, 4)).toBeNull();
		expect(selectCompactableRange([], nodes, 8)).toBeNull();
		expect(selectCompactableRange([], [], 3)).toBeNull();
	});

	it("extends the range to keep a tool_result with its assistant (tool-pairing balance)", () => {
		// tail budget 2 → base end = 4, which already includes the adjacent tool_result
		const nodes: SurfaceNode[] = [node("user", 0), node("user", 1), node("assistant", 2), node("assistant", 3), node("tool_result", 4), node("user", 5), node("user", 6)];
		const entries = [toolEntry(nodes[3], "call-1"), resultEntry(nodes[4], "call-1")];
		const range = selectCompactableRange(entries, nodes, 2);
		expect(range).toEqual({ start: 0, end: 4 });
	});

	it("extends the range across a send_message so a non-adjacent tool_result stays with its shadowed assistant", () => {
		// A user follow-up (send_message) lands between the assistant's toolCall and its result in
		// arrival order; the base boundary at 3 would leave the result orphaned in the tail → 400.
		const nodes: SurfaceNode[] = [
			node("user", 0),
			node("user", 1),
			node("assistant", 2),
			node("send_message", 3),
			node("tool_result", 4),
			node("user", 5),
			node("user", 6),
			node("user", 7),
		];
		const entries = [toolEntry(nodes[2], "call-1"), resultEntry(nodes[4], "call-1")];
		const range = selectCompactableRange(entries, nodes, 4);
		expect(range).toEqual({ start: 0, end: 4 });
	});

	it("chains extensions: shadowing an intervening assistant pulls in its own result", () => {
		// Extending over the send_message shadows the assistant at 4, whose result at 6 must
		// follow — the fixpoint stops only when no surviving result references a shadowed call.
		const nodes: SurfaceNode[] = [
			node("user", 0),
			node("user", 1),
			node("assistant", 2),
			node("send_message", 3),
			node("assistant", 4),
			node("tool_result", 5),
			node("tool_result", 6),
			node("user", 7),
		];
		const entries = [toolEntry(nodes[2], "call-1"), resultEntry(nodes[5], "call-1"), toolEntry(nodes[4], "call-2"), resultEntry(nodes[6], "call-2")];
		const range = selectCompactableRange(entries, nodes, 2);
		expect(range).toEqual({ start: 0, end: 6 });
	});

	it("leaves a tail result alone when its assistant also survives", () => {
		const nodes: SurfaceNode[] = [
			node("user", 0),
			node("user", 1),
			node("assistant", 2),
			node("tool_result", 3),
			node("user", 4),
			node("user", 5),
			node("user", 6),
			node("user", 7),
		];
		const entries = [toolEntry(nodes[2], "call-1"), resultEntry(nodes[3], "call-1")];
		const range = selectCompactableRange(entries, nodes, 4);
		expect(range).toEqual({ start: 0, end: 3 });
	});
});

describe("compaction transaction (surface-only rewrite, log stays append-only)", () => {
	it("compacts a head range into a checkpoint summary node; shadowed content stays in the log", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser(LONG_Q, 1);
		await scope.appendSendMessage(LONG_A, {}, 2);
		await scope.appendUser(LONG_Q + " (second)", 3);
		await scope.appendSendMessage(LONG_A + " (second)", {}, 4);
		await scope.appendUser(LONG_Q + " (third)", 5);
		await scope.appendSendMessage(LONG_A + " (third)", {}, 6);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		expect(surface.nodes).toHaveLength(6);

		const plan = await planCompaction(entries, surface, { tailBudget: 2 });
		expect(plan).not.toBeNull();
		expect(plan!.range).toEqual({ start: 0, end: 3 });

		await applyCompaction(session, dir, plan!);

		const after = await session.surface(dir);
		expect(after.replaceGeneration).toBe(1);
		expect(after.nodes.map((n) => n.kind)).toEqual(["user", "user", "send_message"]); // checkpoint + tail user + tail reply
		// the checkpoint text is a user message the model sees
		const derived = await session.deriveMessages(dir);
		expect(derived[0]).toMatchObject({ role: "user" });
		expect(contentOf(derived[0])).toContain("<compacted-summary>");
		expect(contentOf(derived[0])).toContain("Can you please explain");
		// the tail survived intact
		expect(contentOf(derived[1])).toContain("(third)");
		expect(derived[derived.length - 1]).toMatchObject({ role: "custom", customType: "send_message" });
		// nothing was deleted from the log — SSOT preserved
		const raw = await session.rawEntries(dir);
		expect(raw.filter((e) => e.type === "custom" && e.customType === "compaction_summary")).toHaveLength(1);
		expect(raw.filter((e) => e.type === "custom" && e.customType === "surface_op")).toHaveLength(1);
		expect(raw.filter((e) => e.type === "message" && e.message.role === "user")).toHaveLength(3);
		// the human transcript (append-origin) is unaffected
		expect((await session.visibleHistory(dir)).map((v) => v.kind)).toEqual(["user", "send_message", "user", "send_message", "user", "send_message"]);
	});

	it("aborts when the summary is not smaller than the shadowed content", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		// two short messages: the Q/A transcript is not smaller than the content itself
		await scope.appendUser("hi", 1);
		await scope.appendSendMessage("yo", {}, 2);
		await scope.appendUser("bye", 3);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		expect(await planCompaction(entries, surface, { tailBudget: 1 })).toBeNull();
	});

	it("supports repeated compactions as the session grows (generation increments)", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		for (let i = 0; i < 6; i++) {
			await scope.appendUser(`${LONG_Q} #${i}`, i * 2 + 1);
			await scope.appendSendMessage(`${LONG_A} #${i}`, {}, i * 2 + 2);
		}
		let entries = await session.rawEntries(dir);
		let surface = await session.surface(dir);
		const plan1 = await planCompaction(entries, surface, { tailBudget: 4 });
		expect(plan1).not.toBeNull();
		await applyCompaction(session, dir, plan1!);
		expect((await session.surface(dir)).replaceGeneration).toBe(1);

		// the conversation keeps growing; a later compaction rewrites the new head
		for (let i = 6; i < 10; i++) {
			await scope.appendUser(`${LONG_Q} #${i}`, i * 2 + 1);
			await scope.appendSendMessage(`${LONG_A} #${i}`, {}, i * 2 + 2);
		}
		entries = await session.rawEntries(dir);
		surface = await session.surface(dir);
		expect(surface.nodes).toHaveLength(13); // checkpoint + 12 grown nodes
		const plan2 = await planCompaction(entries, surface, { tailBudget: 4 });
		expect(plan2).not.toBeNull();
		await applyCompaction(session, dir, plan2!);
		const after = await session.surface(dir);
		expect(after.replaceGeneration).toBe(2);
		expect(after.nodes).toHaveLength(5); // checkpoint + tail 4
		// foldSurface on raw entries deterministically rebuilds the same surface
		expect(foldSurface(await session.rawEntries(dir)).nodes).toEqual(after.nodes);
	});

	it("rejects an invalid transaction (bad checkpoint) at fold time", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q", 1);
		await scope.appendSendMessage("a", {}, 2);
		const { nodes } = await session.surface(dir);
		// checkpoint id references a summary that does not exist
		await scope.appendCompactionSummary("[compacted]", 3);
		await scope.appendSurfaceOp({ op: "replace", start: 0, end: 0, sourceEventSeqs: [nodes[0].id], replaceGeneration: 1, checkpointId: "missing-id" }, 4);
		await expect(session.surface(dir)).rejects.toThrow();
	});

	it("defaults the tail budget to 16 surface nodes", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		for (let i = 0; i < 20; i++) {
			await scope.appendUser(`${LONG_Q} #${i}`, i);
		}
		const plan = await planCompaction(await session.rawEntries(dir), await session.surface(dir));
		expect(plan).not.toBeNull();
		expect(plan!.range).toEqual({ start: 0, end: 3 }); // 20 − 16 − 1
	});

	it("reframes a repeated compaction with the previous checkpoint as a byte prefix", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser(LONG_Q, 1);
		await scope.appendSendMessage(LONG_A, {}, 2);
		await scope.appendUser(LONG_Q + " (second)", 3);
		await scope.appendSendMessage(LONG_A + " (second)", {}, 4);

		let plan = await planCompaction(await session.rawEntries(dir), await session.surface(dir), { tailBudget: 1 });
		expect(plan).not.toBeNull();
		await applyCompaction(session, dir, plan!);
		const firstCheckpoint = plan!.checkpointText;

		await scope.appendUser("third question", 5);
		await scope.appendSendMessage("third answer", {}, 6);
		plan = await planCompaction(await session.rawEntries(dir), await session.surface(dir), { tailBudget: 1 });
		expect(plan).not.toBeNull();
		expect(plan!.checkpointText.startsWith(firstCheckpoint)).toBe(true);
		expect(plan!.checkpointText).toContain("third question");
	});
});
