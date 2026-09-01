import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm } from "../core/agent-config";
import { hasOrphanCompactionStart } from "../core/compaction";
import { buildSummarizationInput } from "../core/summarizer";
import { deriveMessages } from "../core/surface";
import { applyToolResultPrunes, planToolResultPrunes } from "../core/tool-result-pruner";
import { createSessionStore } from "../persist";

let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "compaction-cache-test-"));
	dirs.push(dir);
	return dir;
}

describe("tool result pruner", () => {
	it("prunes oversized text and replaces the surface node", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q", 1);
		await scope.appendToolResult(
			{ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "x".repeat(10_000) }], isError: false, timestamp: 2 },
			2,
		);
		await scope.appendSendMessage("a", {}, 3);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		const plans = planToolResultPrunes(entries, surface, { thresholdChars: 1000, headChars: 100, tailChars: 20 });
		expect(plans).toHaveLength(1);
		await applyToolResultPrunes(scope, surface, plans);

		const after = await session.surface(dir);
		expect(after.replaceGeneration).toBeGreaterThan(surface.replaceGeneration);
		// The pruned result must replace the old node IN PLACE (same index), not move to the tail.
		expect(after.nodes.map((n) => n.kind)).toEqual(["user", "tool_result", "send_message"]);
		const resultNode = after.nodes[1];
		expect(resultNode).toBeDefined();
		expect(resultNode!.id).not.toBe(plans[0].id); // the new pruned result id
		const derived = await session.deriveMessages(dir);
		expect(derived.map((m) => m.role)).toEqual(["user", "toolResult", "custom"]);
		const toolMsg = derived.find((m) => m.role === "toolResult") as { content: { type: string; text: string }[] } | undefined;
		expect(toolMsg).toBeDefined();
		const text = toolMsg!.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("");
		expect(text.length).toBeLessThan(1000);
		expect(text).toContain("middle pruned");
	});
});

describe("llm summarization input prefix", () => {
	it("replays the shadowed span verbatim then appends the instruction", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("question one", 1);
		await scope.appendSendMessage("answer one", {}, 2);
		await scope.appendUser("question two", 3);
		await scope.appendSendMessage("answer two", {}, 4);
		await scope.appendUser("question three", 5);
		await scope.appendSendMessage("answer three", {}, 6);

		const entries = await session.rawEntries(dir);
		const surface = await session.surface(dir);
		const shadowed = surface.nodes.slice(0, 4);
		const { messages } = buildSummarizationInput(entries, shadowed);
		const llmMessages = convertToLlm(messages);
		const convMessages = convertToLlm(await deriveMessages(entries, surface));

		expect(llmMessages.length).toBe(shadowed.length + 1);
		expect(llmMessages[llmMessages.length - 1]).toMatchObject({ role: "user" });
		for (let i = 0; i < shadowed.length; i++) {
			expect(llmMessages[i]).toEqual(convMessages[i]);
		}
	});
});

describe("orphan compaction lock", () => {
	it("detects a start without an end", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q", 1);
		await scope.appendCompactionRecord("compaction/start", { range: { start: 0, end: 0 }, generation: 1 }, 2);
		const entries = await session.rawEntries(dir);
		expect(hasOrphanCompactionStart(entries)).toBe(true);
	});

	it("clears when an end follows", async () => {
		const dir = await tempDir();
		const session = createSessionStore();
		const scope = session.scope(dir);
		await scope.appendUser("q", 1);
		await scope.appendCompactionRecord("compaction/start", { range: { start: 0, end: 0 }, generation: 1 }, 2);
		await scope.appendCompactionRecord("compaction/end", { ok: true }, 3);
		const entries = await session.rawEntries(dir);
		expect(hasOrphanCompactionStart(entries)).toBe(false);
	});
});
