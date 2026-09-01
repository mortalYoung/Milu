/**
 * Unit tests for trajectory folding: Entry[] → TrajectoryRecord[].
 * Coverage: the total fold (every pi entry kind becomes a record, nothing dropped),
 * turn counting, toolResult passthrough, and the timelineNodes view model (turn
 * assignment, tool pairing by callId, interrupted detection, turn summaries).
 */
import { describe, expect, test } from "bun:test";
import type { Entry } from "@earendil-works/pi-agent-core";
import { timelineNodes } from "../../shared/trajectory";
import { aggregateUsage, dedupeRequestHeaders, fold, lastUsage } from "../core/trajectory";

let counter = 1;
function entry(partial: Record<string, unknown>): Entry {
	return { type: "message", id: `e${counter++}`, seq: counter, parentId: null, timestamp: 1000, ...partial } as unknown as Entry;
}

function userEntry(text: string): Entry {
	return entry({ message: { role: "user", content: text, timestamp: 1000 } });
}

function assistantEntry(blocks: Record<string, unknown>[], usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }): Entry {
	return entry({ message: { role: "assistant", content: blocks, usage, timestamp: 1000 } });
}

function toolResultEntry(toolCallId: string, text: string, isError = false, extra: Record<string, unknown> = {}): Entry {
	return entry({ message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text }], isError, timestamp: 1000, ...extra } });
}

function sendMessageEntry(text: string): Entry {
	return entry({ type: "custom", customType: "send_message", data: { text, timestamp: 1000 } });
}

describe("aggregateUsage whole-session totals", () => {
	test("null when no assistant message carries usage", () => {
		expect(aggregateUsage([userEntry("q"), assistantEntry([{ type: "text", text: "hi" }])])).toBeNull();
	});

	test("sums every assistant turn's usage", () => {
		const entries = [
			userEntry("q1"),
			assistantEntry([{ type: "text", text: "a" }], { input: 100, output: 10, cacheRead: 200, cacheWrite: 5, totalTokens: 310 }),
			userEntry("q2"),
			assistantEntry([{ type: "text", text: "b" }], { input: 150, output: 20, cacheRead: 300, cacheWrite: 10, totalTokens: 480 }),
		];
		expect(aggregateUsage(entries)).toEqual({ messages: 2, input: 250, output: 30, cacheRead: 500, cacheWrite: 15 });
	});

	test("skips entries without usage and non-assistant messages", () => {
		const entries = [
			userEntry("q"),
			assistantEntry([{ type: "text", text: "a" }]),
			assistantEntry([{ type: "text", text: "b" }], { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, totalTokens: 42 }),
			toolResultEntry("t1", "out"),
			sendMessageEntry("done"),
		];
		expect(aggregateUsage(entries)).toEqual({ messages: 1, input: 10, output: 2, cacheRead: 30, cacheWrite: 0 });
	});
});

describe("lastUsage last-turn usage extraction", () => {
	test("empty entries → null", () => {
		expect(lastUsage([])).toBeNull();
	});

	test("no assistant message with usage → null", () => {
		const entries = [userEntry("hello"), sendMessageEntry("hi"), assistantEntry([{ type: "toolCall", id: "t", name: "bash", arguments: "ls" }])];
		expect(lastUsage(entries)).toBeNull();
	});

	test("single assistant with usage → its usage (cache fields default to 0)", () => {
		const usage = lastUsage([userEntry("q"), assistantEntry([{ type: "text", text: "a" }], { input: 100, output: 20 })]);
		expect(usage).toEqual({ input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
	});

	test("multiple assistants → the last one wins", () => {
		const usage = lastUsage([
			userEntry("q1"),
			assistantEntry([{ type: "text", text: "a" }], { input: 100, output: 20 }),
			userEntry("q2"),
			assistantEntry([{ type: "text", text: "b" }], { input: 5000, output: 300, cacheRead: 2000, cacheWrite: 1000 }),
		]);
		expect(usage).toEqual({ input: 5000, output: 300, cacheRead: 2000, cacheWrite: 1000, totalTokens: 0 });
	});

	test("later assistant without usage does not clear the last usage", () => {
		const usage = lastUsage([userEntry("q"), assistantEntry([{ type: "text", text: "a" }], { input: 10, output: 5 }), assistantEntry([{ type: "text", text: "b" }])]);
		expect(usage).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
	});

	test("usage passes through custom entries untouched", () => {
		const usage = lastUsage([sendMessageEntry("before"), userEntry("q"), assistantEntry([{ type: "text", text: "a" }], { input: 7, output: 3 }), sendMessageEntry("after")]);
		expect(usage).toEqual({ input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
	});
});

describe("fold — total over the entry union", () => {
	test("empty entries → empty list", () => {
		expect(fold([])).toEqual([]);
	});

	test("user + assistant (raw blocks) + send_message → three records, turn count 1", () => {
		const records = fold([
			userEntry("hello"),
			assistantEntry(
				[
					{ type: "thinking", thinking: "let me check" },
					{ type: "text", text: "done" },
				],
				{ input: 10, output: 5, totalTokens: 15 },
			),
			sendMessageEntry("task done"),
		]);
		expect(records.map((r) => r.kind)).toEqual(["user", "assistant", "custom"]);
		const assistant = records[1];
		expect(assistant).toMatchObject({ kind: "assistant", turn: 1, entryId: expect.any(String) });
		if (assistant.kind === "assistant") {
			// blocks travel verbatim (the view interprets thinking/text/toolCall)
			expect(assistant.blocks).toEqual([
				{ type: "thinking", thinking: "let me check" },
				{ type: "text", text: "done" },
			]);
			expect(assistant.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
		}
		const message = records[2];
		expect(message).toMatchObject({ kind: "custom", customType: "send_message" });
		if (message.kind === "custom") expect(message.data).toEqual({ text: "task done", timestamp: 1000 });
	});

	test("toolResult is its own record, inherits the turn, keeps details", () => {
		const records = fold([
			userEntry("list files"),
			assistantEntry([{ type: "toolCall", id: "toolu_1", name: "bash", arguments: { command: "ls" } }]),
			toolResultEntry("toolu_1", "src\npackage.json", false, { details: { exitCode: 0 } }),
		]);
		expect(records.map((r) => r.kind)).toEqual(["user", "assistant", "toolResult"]);
		const result = records[2];
		expect(result).toMatchObject({ kind: "toolResult", turn: 1, toolCallId: "toolu_1", toolName: "bash", content: "src\npackage.json", isError: false });
		if (result.kind === "toolResult") expect(result.details).toEqual({ exitCode: 0 });
		// Tool failure: isError passes through
		const failed = fold([userEntry("x"), assistantEntry([{ type: "toolCall", id: "t2", name: "bash", arguments: "ls" }]), toolResultEntry("t2", "boom", true)]);
		const result2 = failed[2];
		if (result2.kind === "toolResult") expect(result2.isError).toBe(true);
	});

	test("multiple assistants → turn increments; a lost toolResult is visible by absence", () => {
		const records = fold([userEntry("q"), assistantEntry([{ type: "text", text: "a" }]), assistantEntry([{ type: "toolCall", id: "t4", name: "read", arguments: {} }])]);
		expect(records.map((r) => (r.kind === "assistant" || r.kind === "toolResult" ? r.turn : -1))).toEqual([-1, 1, 2]);
	});

	test("structural entries (model_change / thinking_level / active_tools) fold with their fields", () => {
		const records = fold([
			entry({ type: "model_change", provider: "deepseek", modelId: "deepseek-v4-flash" }),
			entry({ type: "thinking_level_change", thinkingLevel: "high" }),
			entry({ type: "active_tools_change", activeToolNames: ["read", "write"] }),
			userEntry("hi"),
			assistantEntry([{ type: "text", text: "a" }]),
		]);
		expect(records.map((r) => r.kind)).toEqual(["modelChange", "thinkingLevel", "activeTools", "user", "assistant"]);
		expect(records[0]).toMatchObject({ kind: "modelChange", provider: "deepseek", modelId: "deepseek-v4-flash" });
		expect(records[1]).toMatchObject({ kind: "thinkingLevel", thinkingLevel: "high" });
		expect(records[2]).toMatchObject({ kind: "activeTools", activeToolNames: ["read", "write"] });
	});

	test("compaction and branch_summary fold with summary/tokens/count", () => {
		const records = fold([
			entry({ type: "compaction", summary: "old work done", retainedTail: [{ role: "user", content: "keep", timestamp: 1 }], tokensBefore: 5000 }),
			entry({ type: "branch_summary", fromId: "e1", summary: "fork point" }),
		]);
		expect(records[0]).toMatchObject({ kind: "compaction", summary: "old work done", retainedTailCount: 1, tokensBefore: 5000 });
		expect(records[1]).toMatchObject({ kind: "branchSummary", fromId: "e1", summary: "fork point" });
	});

	test("every custom entry type passes through as a custom record (data verbatim)", () => {
		const records = fold([
			sendMessageEntry("hi"),
			entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
			entry({ type: "custom", customType: "system_reminder", data: { text: "call send_message", timestamp: 1 } }),
			entry({ type: "custom", customType: "surface_op", data: { op: "replace", start: 0, end: 2 } }),
			entry({ type: "custom", customType: "compaction_summary", data: { text: "[compacted 3 messages]", timestamp: 2 } }),
			entry({ type: "custom", customType: "compaction/start", data: { range: { start: 0, end: 2 } } }),
			entry({ type: "custom", customType: "compaction/end", data: { ok: true } }),
			entry({ type: "custom", customType: "request/header", data: { toolNames: ["read"], systemPrompt: "# IDENTIFY" } }),
			entry({ type: "custom", customType: "something_new", data: { foo: 1 } }),
		]);
		expect(records.map((r) => r.kind)).toEqual(Array(9).fill("custom"));
		expect(records.map((r) => (r.kind === "custom" ? r.customType : ""))).toEqual([
			"send_message",
			"system_prompt",
			"system_reminder",
			"surface_op",
			"compaction_summary",
			"compaction/start",
			"compaction/end",
			"request/header",
			"something_new",
		]);
		const unknown = records[8];
		if (unknown.kind === "custom") expect(unknown.data).toEqual({ foo: 1 });
	});

	test("user content block arrays are joined to text", () => {
		const records = fold([
			entry({
				message: {
					role: "user",
					content: [
						{ type: "text", text: "a" },
						{ type: "text", text: "b" },
					],
					timestamp: 1000,
				},
			}),
		]);
		expect(records[0]).toMatchObject({ kind: "user", content: "a\nb" });
	});
});

describe("timelineNodes whole-log view model", () => {
	test("one node per record; assistant starts a turn, earlier entries carry the turn that follows", () => {
		const { nodes } = timelineNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("q1"),
				assistantEntry([{ type: "text", text: "a" }]),
				toolResultEntry("t1", "out"),
				sendMessageEntry("reply"),
				userEntry("q2"),
				assistantEntry([{ type: "text", text: "b" }]),
			]),
		);
		// Block order within turn 1: system prompt → user → send_message → assistant → toolResult
		expect(nodes.map((n) => n.record.kind)).toEqual(["custom", "user", "custom", "assistant", "toolResult", "user", "assistant"]);
		// system prompt and user before the first assistant belong to turn 1; toolResult inherits its turn
		expect(nodes.map((n) => n.turn)).toEqual([1, 1, 1, 1, 1, 2, 2]);
	});

	test("turn summaries: density, caption fallback, tools with args", () => {
		const { turns } = timelineNodes(
			fold([
				userEntry("analyse the project"),
				assistantEntry([{ type: "toolCall", id: "t1", name: "bash", arguments: "ls" }], { input: 500, output: 200, totalTokens: 700 }),
				assistantEntry(
					[
						{ type: "text", text: "progress" },
						{ type: "toolCall", id: "t2", name: "read", arguments: {} },
					],
					{ input: 3000, output: 100, totalTokens: 3100 },
				),
				toolResultEntry("t2", "out"),
				sendMessageEntry("first reply"),
				assistantEntry([{ type: "toolCall", id: "t3", name: "read", arguments: {} }], { input: 6000, output: 400, totalTokens: 6400 }),
			]),
		);
		expect(turns.map((t) => t.turn)).toEqual([1, 2, 3]);
		expect(turns[0].tools.map((t) => t.name)).toEqual(["bash"]);
		expect(turns[0].tools[0].args).toContain("ls");
		expect(turns[1].tools.map((t) => t.name)).toEqual(["read"]);
		expect(turns[1].text).toBe("progress");
		expect(turns[1].hasMessage).toBe(true);
		expect(turns[2].hasMessage).toBe(false);
		expect(turns[0].density).toBe("l1"); // 700 total
		expect(turns[1].density).toBe("l2"); // 3,100
		expect(turns[2].density).toBe("l3"); // 6,400
		expect(turns[1].caption).toBe("progress");
		expect(turns[0].caption).toBe("bash");
	});

	test("tool results pair to their turn's call by callId; a missing result stays unpaired", () => {
		const { turns } = timelineNodes(
			fold([
				userEntry("q"),
				assistantEntry([{ type: "toolCall", id: "tk1", name: "bash", arguments: "ls" }]),
				toolResultEntry("tk1", "out", true),
				assistantEntry([{ type: "toolCall", id: "tk2", name: "bash", arguments: "rm -rf" }]),
			]),
		);
		expect(turns[0].tools[0].result).toEqual({ text: "out", isError: true });
		// interrupted: tk2 never got a toolResult → no result attached (the view marks it)
		expect(turns[1].tools[0].result).toBeUndefined();
	});

	test("mid-turn records (request/header between assistant and its toolResults) never regress the turn", () => {
		// Realistic inner-loop log: request/header is appended before each LLM call, so it lands
		// between the assistant and its toolResults — turns must stay monotonic (no 1,2,1).
		const { nodes } = timelineNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("q"),
				entry({ type: "custom", customType: "system_reminder", data: { text: "call send_message", timestamp: 1 } }),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["bash"], systemPrompt: "# IDENTIFY" } }),
				sendMessageEntry("thinking…"),
				assistantEntry([{ type: "toolCall", id: "tk1", name: "bash", arguments: "ls" }]),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["bash"], systemPrompt: "# IDENTIFY" } }),
				toolResultEntry("tk1", "out"),
				assistantEntry([{ type: "text", text: "done" }]),
			]),
		);
		expect(nodes.map((n) => n.turn)).toEqual([1, 1, 1, 1, 1, 1, 1, 2]);
		// strictly non-decreasing
		for (let i = 1; i < nodes.length; i++) expect(nodes[i].turn).toBeGreaterThanOrEqual(nodes[i - 1].turn);
	});

	test("turn blocks read system_prompt → request/header → question → reminder → send_message", () => {
		const { nodes } = timelineNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("q1"),
				entry({ type: "custom", customType: "system_reminder", data: { text: "send a note", timestamp: 1 } }),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["read", "write", "bash"], systemPrompt: "# IDENTIFY" } }),
				sendMessageEntry("hi"),
				assistantEntry([{ type: "text", text: "a" }]),
			]),
		);
		expect(nodes.map((n) => n.record.kind)).toEqual(["custom", "custom", "user", "custom", "custom", "assistant"]);
		expect(nodes.map((n) => (n.record.kind === "custom" ? n.record.customType : n.record.kind))).toEqual([
			"system_prompt",
			"request/header",
			"user",
			"system_reminder",
			"send_message",
			"assistant",
		]);
	});

	test("system prompts dedupe to one node (the first, at the front)", () => {
		const { nodes } = timelineNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("hi"),
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 2 } }),
				assistantEntry([{ type: "text", text: "a" }]),
			]),
		);
		const prompts = nodes.filter((n) => n.record.kind === "custom" && n.record.customType === "system_prompt");
		expect(prompts).toHaveLength(1);
		expect(nodes[0]).toBe(prompts[0]);
	});

	test("request/header nodes all stay; the first is placed right after system_prompt", () => {
		const { nodes } = timelineNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("q1"),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["bash"], systemPrompt: "# IDENTIFY" } }),
				assistantEntry([{ type: "text", text: "a" }]),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["read"], systemPrompt: "# IDENTIFY" } }),
				assistantEntry([{ type: "text", text: "b" }]),
			]),
		);
		const headers = nodes.filter((n) => n.record.kind === "custom" && n.record.customType === "request/header");
		expect(headers).toHaveLength(2);
		const sysIdx = nodes.findIndex((n) => n.record.kind === "custom" && n.record.customType === "system_prompt");
		expect(nodes[sysIdx + 1]).toBe(headers[0]);
	});

	test("request segments span one user question to the next; the dot renders on the question row", () => {
		const { nodes } = timelineNodes(
			fold([
				userEntry("q1"),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["read"], systemPrompt: "# IDENTIFY" } }),
				assistantEntry([{ type: "toolCall", id: "tk1", name: "bash", arguments: "ls" }]),
				entry({ type: "custom", customType: "request/header", data: { toolNames: ["read"], systemPrompt: "# IDENTIFY" } }),
				toolResultEntry("tk1", "out"),
				assistantEntry([{ type: "text", text: "done" }]),
				userEntry("q2"),
			]),
		);
		const headers = nodes.filter((n) => n.record.kind === "custom" && n.record.customType === "request/header");
		expect(headers).toHaveLength(2);
		// request headers are list rows now (their expanded body shows the tool definitions)
		for (const h of headers) expect(h.positionOnly).toBeFalsy();
		// one request per question segment — the dot sits on the question row that starts it
		const users = nodes.filter((n) => n.record.kind === "user");
		expect(users).toHaveLength(2);
		for (const u of users) expect(u.requestMarks).toBe(1);
		// mid-segment rows carry no dots
		expect(nodes.find((n) => n.record.kind === "assistant")?.requestMarks).toBeUndefined();
		expect(nodes.find((n) => n.record.kind === "toolResult")?.requestMarks).toBeUndefined();
	});
});

describe("dedupeRequestHeaders server-side header dedup", () => {
	test("keeps the first occurrence of each distinct header content", () => {
		const records = fold([
			userEntry("q1"),
			entry({ type: "custom", customType: "request/header", data: { toolNames: ["bash"], systemPrompt: "# IDENTIFY" } }),
			assistantEntry([{ type: "text", text: "a" }]),
			entry({ type: "custom", customType: "request/header", data: { toolNames: ["bash"], systemPrompt: "# IDENTIFY" } }),
			assistantEntry([{ type: "text", text: "b" }]),
			entry({ type: "custom", customType: "request/header", data: { toolNames: ["read"], systemPrompt: "# IDENTIFY" } }),
			assistantEntry([{ type: "text", text: "c" }]),
		]);
		const deduped = dedupeRequestHeaders(records);
		const headers = deduped.filter((r) => r.kind === "custom" && r.customType === "request/header");
		expect(headers).toHaveLength(2);
		expect(headers.map((h) => h.seq)).toEqual([1, 5]);
	});

	test("non-header records pass through unchanged", () => {
		const records = fold([userEntry("q"), assistantEntry([{ type: "text", text: "a" }])]);
		expect(dedupeRequestHeaders(records)).toEqual(records);
	});
});
