/**
 * Unit tests for the heuristic context breakdown (4 chars ≈ 1 token).
 * Coverage: empty chain, pure CJK (systematically underestimated — accepted), pure ASCII,
 * send_message / user / assistant-text contributions, tools guidance serialization.
 */
import { describe, expect, test } from "bun:test";
import type { Entry } from "@earendil-works/pi-agent-core";
import { estimateBreakdown } from "../core/context-estimate";

let counter = 1;
function entry(partial: Record<string, unknown>): Entry {
	return { type: "message", id: `e${counter++}`, seq: counter, parentId: null, timestamp: 1000, ...partial } as unknown as Entry;
}

function userEntry(text: string): Entry {
	return entry({ message: { role: "user", content: text, timestamp: 1000 } });
}

function assistantTextEntry(text: string): Entry {
	return entry({ message: { role: "assistant", content: [{ type: "text", text }], timestamp: 1000 } });
}

function sendMessageEntry(text: string): Entry {
	return entry({ type: "custom", customType: "send_message", data: { text, timestamp: 1000 } });
}

const SYSTEM = "IDENTIFY: you are an agent. PERSONA: helpful. WORKSPACE/STORAGE as documented. RESPONSE-FORMAT: markdown.";

describe("estimateBreakdown heuristic composition", () => {
	test("empty conversation → system + tools only, messages 0", () => {
		const b = estimateBreakdown(SYSTEM, []);
		expect(b.messageTokens).toBe(0);
		expect(b.systemTokens).toBeGreaterThan(0);
		expect(b.toolsTokens).toBe(0);
	});

	test("4 ASCII chars ≈ 1 token (ceil)", () => {
		const b = estimateBreakdown("", [userEntry("abcd")]); // 4 chars → 1 token
		expect(b.messageTokens).toBe(1);
		const b2 = estimateBreakdown("", [userEntry("abcdef")]); // 6 chars → 2 tokens
		expect(b2.messageTokens).toBe(2);
	});

	test("user + assistant text + send_message all counted", () => {
		const b = estimateBreakdown("", [userEntry("hello"), assistantTextEntry("world"), sendMessageEntry("done")]);
		// hello(5) + world(5) + done(4) = 14 chars → 4 tokens
		expect(b.messageTokens).toBe(4);
	});

	test("CJK counted by the same 4-char heuristic (systematically underestimated — accepted)", () => {
		const b = estimateBreakdown("", [userEntry("你好世界")]); // 4 CJK chars → 1 token by heuristic
		expect(b.messageTokens).toBe(1);
	});

	test("tool calls / thinking / tool results do not contribute message tokens", () => {
		const entries: Entry[] = [
			userEntry("q"),
			entry({
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "long hidden reasoning" },
						{ type: "toolCall", id: "t", name: "bash", arguments: "ls" },
					],
					timestamp: 1000,
				},
			}),
			entry({ message: { role: "toolResult", toolCallId: "t", toolName: "bash", content: [{ type: "text", text: "out" }], timestamp: 1000 } }),
		];
		const b = estimateBreakdown("", entries);
		expect(b.messageTokens).toBe(1); // only the user message "q"
	});
});
