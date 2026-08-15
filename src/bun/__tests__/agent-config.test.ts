/**
 * Unit tests for convertToLlm projection and appendSystemReminder:
 * system reminders ride as plain user messages (wrapped in <system_reminder>);
 * send_message visible messages project unchanged; other custom messages are dropped.
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm } from "../core/agent-config";
import { appendSystemReminder } from "../core/context";

const USER: AgentMessage = { role: "user", content: "hello", timestamp: 2 };

describe("appendSystemReminder", () => {
	test("appends a user-role message wrapped in <system_reminder>", () => {
		const messages: AgentMessage[] = [];
		appendSystemReminder(messages, "check time");
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ role: "user", content: "<system_reminder>check time</system_reminder>" });
	});
});

describe("convertToLlm projection", () => {
	test("user messages (including reminders) pass through verbatim", () => {
		const reminder = { role: "user", content: "<system_reminder>check time</system_reminder>", timestamp: 1 } as AgentMessage;
		const out = convertToLlm([reminder, USER]);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject(reminder);
		expect(out[1]).toMatchObject(USER);
	});

	test("send_message (display) still projects as a [to user] user message", () => {
		const out = convertToLlm([{ role: "custom", customType: "send_message", content: "done", display: true, timestamp: 1 }]);
		expect(out).toMatchObject([{ role: "user", content: "[to user]: done" }]);
	});

	test("other custom messages without display are dropped", () => {
		const out = convertToLlm([{ role: "custom", customType: "something_else", content: "x", display: false, timestamp: 1 }]);
		expect(out).toEqual([]);
	});

	test("custom projection does not insert between tool_calls and their tool result (stays adjacent)", () => {
		const assistantTc = { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "send_message", arguments: {} }], timestamp: 3 } as unknown as AgentMessage;
		const toolResult = {
			role: "toolResult",
			toolCallId: "t1",
			toolName: "send_message",
			content: [{ type: "text", text: "sent" }],
			isError: false,
			timestamp: 4,
		} as unknown as AgentMessage;
		const out = convertToLlm([
			assistantTc,
			{ role: "custom", customType: "send_message", content: "done", display: true, timestamp: 4 },
			toolResult,
			{ role: "user", content: "next", timestamp: 5 },
		]);
		// assistant(tc) → toolResult stay adjacent; the visible message projection moves before the next user
		expect(out.map((m) => m.role)).toEqual(["assistant", "toolResult", "user", "user"]);
		expect(out[1]).toMatchObject({ role: "toolResult", toolCallId: "t1" });
		expect(out[2]).toMatchObject({ role: "user", content: "[to user]: done" });
		expect(out[3]).toMatchObject({ role: "user", content: "next" });
	});

	test("user/assistant/toolResult pass through unchanged", () => {
		const assistant = { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 3 } as unknown as AgentMessage;
		const toolResult = {
			role: "toolResult",
			toolCallId: "t1",
			toolName: "bash",
			content: [{ type: "text", text: "out" }],
			isError: false,
			timestamp: 4,
		} as unknown as AgentMessage;
		const out = convertToLlm([USER, assistant, toolResult]);
		expect(out.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
		expect(out[0]).toMatchObject({ role: "user", content: "hello" });
		expect(out[1]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "ok" }] });
		expect(out[2]).toMatchObject({ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "out" }], isError: false });
	});
});
