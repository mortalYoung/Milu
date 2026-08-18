/**
 * Unit tests for trajectory folding: Entry[] → TrajectoryRecord[].
 * Coverage: record kinds, turn counting, tool matching by callId, interrupted marking, args serialization,
 * toolResult content block concatenation, segment extraction (segmentForMessage).
 */
import { describe, expect, test } from "bun:test";
import type { Entry } from "@earendil-works/pi-agent-core";
import { segmentForMessage, trajectoryNodes } from "../../shared/trajectory";
import { fold, lastUsage } from "../core/trajectory";

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

function toolResultEntry(toolCallId: string, text: string, isError = false): Entry {
	return entry({ message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text }], isError, timestamp: 1000 } });
}

function sendMessageEntry(text: string): Entry {
	return entry({ type: "custom", customType: "send_message", data: { text, timestamp: 1000 } });
}

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

describe("fold trajectory folding", () => {
	test("empty entries → empty list", () => {
		expect(fold([])).toEqual([]);
	});

	test("user + assistant (text/thinking/usage) + send_message → three record kinds, turn count 1", () => {
		const records = fold([
			userEntry("hello"),
			assistantEntry(
				[
					{ type: "thinking", thinking: "let me check" },
					{ type: "text", text: "done" },
				],
				{ input: 10, output: 5 },
			),
			sendMessageEntry("task done"),
		]);
		expect(records.map((r) => r.kind)).toEqual(["user", "assistant", "message"]);
		const assistant = records[1];
		expect(assistant).toMatchObject({ kind: "assistant", turn: 1, text: "done", thinking: "let me check" });
		if (assistant.kind === "assistant") {
			expect(assistant.usage).toMatchObject({ input: 10, output: 5 });
		}
		const message = records[2];
		expect(message).toMatchObject({ kind: "message", text: "task done" });
	});

	test("tool calls matched by callId, result and error flags correct", () => {
		const records = fold([
			userEntry("list files"),
			assistantEntry([
				{ type: "thinking", thinking: "use bash" },
				{ type: "toolCall", id: "toolu_1", name: "bash", arguments: { command: "ls" } },
			]),
			toolResultEntry("toolu_1", "src\npackage.json"),
		]);
		expect(records.map((r) => r.kind)).toEqual(["user", "assistant", "tool"]);
		const tool = records[2];
		expect(tool).toMatchObject({ kind: "tool", turn: 1, callId: "toolu_1", name: "bash" });
		if (tool.kind === "tool") {
			expect(tool.result).toEqual({ text: "src\npackage.json", isError: false });
		}
		// Tool failure: isError passes through
		const failed = fold([userEntry("x"), assistantEntry([{ type: "toolCall", id: "t2", name: "bash", arguments: "ls" }]), toolResultEntry("t2", "boom", true)]);
		const tool2 = failed[2];
		if (tool2.kind === "tool") expect(tool2.result).toEqual({ text: "boom", isError: true });
	});

	test("tool call without a result (interrupted/restart) → marked interrupted", () => {
		const records = fold([userEntry("x"), assistantEntry([{ type: "toolCall", id: "t3", name: "bash", arguments: "ls" }])]);
		const tool = records[2];
		expect(tool.kind).toBe("tool");
		if (tool.kind === "tool") expect(tool.result).toEqual({ text: "(interrupted)", isError: true });
	});

	test("multiple assistants → turn increments", () => {
		const records = fold([userEntry("q"), assistantEntry([{ type: "text", text: "a" }]), assistantEntry([{ type: "toolCall", id: "t4", name: "read", arguments: {} }])]);
		// Second assistant has a tool call → one more tool record in the same turn
		const turns = records.map((r) => (r.kind === "assistant" || r.kind === "tool" ? r.turn : -1));
		expect(turns).toEqual([-1, 1, 2, 2]);
	});

	test("args objects JSON-stringified (indented), strings pass through", () => {
		const obj = fold([userEntry("x"), assistantEntry([{ type: "toolCall", id: "t5", name: "edit", arguments: { file: "a.ts", old: "1", new: "2" } }])]);
		const tool = obj[1];
		if (tool.kind === "tool") {
			expect(tool.args).toContain('"file": "a.ts"');
			expect(tool.args).toContain('"old": "1"');
		}
		const str = fold([userEntry("x"), assistantEntry([{ type: "toolCall", id: "t6", name: "bash", arguments: "ls -la" }])]);
		const tool2 = str[1];
		if (tool2.kind === "tool") expect(tool2.args).toBe("ls -la");
	});

	test("toolResult content block array → text concatenation", () => {
		const records = fold([
			userEntry("x"),
			assistantEntry([{ type: "toolCall", id: "t7", name: "bash", arguments: "echo hi" }]),
			entry({
				message: {
					role: "toolResult",
					toolCallId: "t7",
					toolName: "bash",
					content: [
						{ type: "text", text: "line1" },
						{ type: "text", text: "line2" },
					],
					isError: false,
					timestamp: 1000,
				},
			}),
		]);
		const tool = records[2];
		if (tool.kind === "tool") expect(tool.result?.text).toBe("line1\nline2");
	});
});

describe("segmentForMessage segment extraction", () => {
	const records = fold([
		userEntry("you: format this for me"),
		assistantEntry([{ type: "toolCall", id: "t8", name: "bash", arguments: "bun format" }]),
		toolResultEntry("t8", "done"),
		sendMessageEntry("first reply"),
		assistantEntry([{ type: "text", text: "check once more" }]),
		sendMessageEntry("second reply"),
	]);

	test("first message's trajectory = user up to and including that message", () => {
		const message = records.find((r) => r.kind === "message" && r.text === "first reply");
		if (!message || message.kind !== "message") throw new Error("missing message");
		const seg = segmentForMessage(records, message.id);
		expect(seg.map((r) => r.kind)).toEqual(["user", "assistant", "tool", "message"]);
	});

	test("second message's trajectory includes the earlier work (continuous process under one instruction)", () => {
		const message = records.find((r) => r.kind === "message" && r.text === "second reply");
		if (!message || message.kind !== "message") throw new Error("missing message");
		const seg = segmentForMessage(records, message.id);
		expect(seg.map((r) => r.kind)).toEqual(["user", "assistant", "tool", "message", "assistant", "message"]);
	});

	test("message not found → empty segment", () => {
		expect(segmentForMessage(records, "nope")).toEqual([]);
	});
});

describe("trajectoryNodes whole-conversation model", () => {
	const { turns, nodes } = trajectoryNodes(
		fold([
			userEntry("analyse the project"),
			assistantEntry([{ type: "toolCall", id: "t1", name: "bash", arguments: "ls" }], { input: 500, output: 200, totalTokens: 700 }),
			toolResultEntry("t1", "out"),
			assistantEntry(
				[
					{ type: "text", text: "progress" },
					{ type: "toolCall", id: "t2", name: "read", arguments: {} },
				],
				{ input: 3000, output: 100, totalTokens: 3100 },
			),
			toolResultEntry("t2", "out"),
			sendMessageEntry("first reply"),
			userEntry("and the tests?"),
			assistantEntry([{ type: "toolCall", id: "t3", name: "read", arguments: {} }], { input: 6000, output: 400, totalTokens: 6400 }),
			toolResultEntry("t3", "out"),
		]),
	);

	test("one summary per turn, tools with args collected, message linked", () => {
		expect(turns.map((t) => t.turn)).toEqual([1, 2, 3]);
		expect(turns[0].tools.map((t) => t.name)).toEqual(["bash"]);
		expect(turns[0].tools[0].args).toContain("ls");
		expect(turns[1].tools.map((t) => t.name)).toEqual(["read"]);
		expect(turns[1].hasMessage).toBe(true);
		expect(turns[1].messageId).toBeTruthy();
		expect(turns[2].hasMessage).toBe(false);
	});

	test("assistant full text kept for markdown rendering", () => {
		expect(turns[1].text).toBe("progress");
	});

	test("density buckets by token workload", () => {
		expect(turns[0].density).toBe("l1"); // 700 total
		expect(turns[1].density).toBe("l2"); // 3,100
		expect(turns[2].density).toBe("l3"); // 6,400
	});

	test("caption falls back from text to first tool name", () => {
		expect(turns[1].caption).toBe("progress");
		expect(turns[0].caption).toBe("bash");
	});

	test("every record is a node with a turn; user nodes carry linkage ids", () => {
		expect(nodes.map((n) => n.kind)).toEqual(["user", "assistant", "tool", "assistant", "tool", "message", "user", "assistant", "tool"]);
		expect(nodes.map((n) => n.turn)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
		const firstUser = nodes[0];
		expect(firstUser.kind).toBe("user");
		if (firstUser.kind === "user") expect(firstUser.messageId).toBeTruthy();
	});

	test("assistant nodes carry thinking for the detail view", () => {
		const { nodes } = trajectoryNodes(
			fold([
				userEntry("q"),
				assistantEntry([
					{ type: "thinking", thinking: "let me check" },
					{ type: "toolCall", id: "tk", name: "bash", arguments: "ls" },
				]),
				toolResultEntry("tk", "out"),
			]),
		);
		const assistant = nodes.find((n) => n.kind === "assistant");
		if (assistant && assistant.kind === "assistant") expect(assistant.thinking).toBe("let me check");
	});

	test("tool nodes carry their result for the detail view", () => {
		const toolNode = nodes.find((n) => n.kind === "tool");
		expect(toolNode).toBeTruthy();
		if (toolNode && toolNode.kind === "tool") expect(toolNode.result).toEqual({ text: "out", isError: false });
	});
});

describe("fold system_prompt and system_reminder custom entries", () => {
	test("custom system_prompt entry → system record with text", () => {
		const records = fold([entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY\n...", timestamp: 1000 } }), userEntry("hi")]);
		expect(records[0]).toMatchObject({ kind: "system", text: "# IDENTIFY\n..." });
	});

	test("custom system_reminder entry → reminder record with text", () => {
		const records = fold([entry({ type: "custom", customType: "system_reminder", data: { text: "Call send_message now.", timestamp: 1000 } })]);
		expect(records[0]).toMatchObject({ kind: "reminder", text: "Call send_message now." });
	});

	test("identical system prompts collapse to one node at the timeline start", () => {
		const { nodes } = trajectoryNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("hi"),
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 2 } }),
				assistantEntry([{ type: "text", text: "a" }]),
			]),
		);
		expect(nodes.filter((n) => n.kind === "system")).toHaveLength(1);
		expect(nodes[0].kind).toBe("system");
	});

	test("nodes include system, user, reminder, assistant and tool in order", () => {
		const { nodes } = trajectoryNodes(
			fold([
				entry({ type: "custom", customType: "system_prompt", data: { text: "# IDENTIFY", timestamp: 0 } }),
				userEntry("q1"),
				entry({ type: "custom", customType: "system_reminder", data: { text: "send a progress note", timestamp: 1001 } }),
				assistantEntry([{ type: "toolCall", id: "r1", name: "bash", arguments: "ls" }], { input: 400, output: 300, totalTokens: 700 }),
				toolResultEntry("r1", "out"),
				assistantEntry([{ type: "text", text: "reply" }], { input: 100, output: 200, totalTokens: 300 }),
			]),
		);
		expect(nodes.map((n) => n.kind)).toEqual(["system", "user", "reminder", "assistant", "tool", "assistant"]);
		// system/user/reminder carry the turn that follows them
		expect(nodes.map((n) => n.turn)).toEqual([1, 1, 1, 1, 1, 2]);
		const reminder = nodes[2];
		if (reminder.kind === "reminder") expect(reminder.text).toContain("progress");
	});
});
