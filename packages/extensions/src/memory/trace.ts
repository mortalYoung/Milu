import { type AgentMessage, EVENTS } from "@milu/core";

import type { TrajectoryBlock, TrajectoryRecord } from "../trajectory/model.ts";

export interface TraceBase {
	readonly runId: string;
	readonly startedAt: number;
	readonly model: string;
}

export function trajectoryRecordsOf(passes: readonly (readonly AgentMessage[])[], base: TraceBase): TrajectoryRecord[] {
	const records: TrajectoryRecord[] = [];
	let seq = 0;

	const push = (turn: number, record: Record<string, unknown>): void => {
		records.push({ seq, entryId: `${base.runId}-${seq}`, metaKey: String(record["metaKey"]), time: base.startedAt, run: 1, turn, ...record } as TrajectoryRecord);
		seq += 1;
	};

	const seenSystem = new Set<string>();

	passes.forEach((messages, index) => {
		const turn = index + 1;
		for (const message of messages) {
			if (message.role === "system") {
				const text = textOf(message.content).trim();
				if (text === "" || seenSystem.has(text)) continue;
				seenSystem.add(text);
				push(turn, { kind: "custom", metaKey: EVENTS.systemPrompt, data: { text } });
				continue;
			}
			if (message.role === "user") {
				push(turn, { kind: "user", metaKey: "role:user", content: textOf(message.content) });
				continue;
			}
			if (message.role === "assistant") {
				const blocks = (Array.isArray(message.content) ? message.content : []) as readonly TrajectoryBlock[];
				push(turn, { kind: "assistant", metaKey: "role:assistant", blocks, model: base.model });
				for (const block of blocks) {
					if (block.type !== "toolCall") continue;
					push(turn, {
						kind: "custom",
						metaKey: EVENTS.toolCall,
						data: { name: String(block.name ?? "tool"), args: block.arguments, callId: String(block.id ?? "") },
					});
				}
				continue;
			}
			if (message.role === "toolResult") {
				push(turn, {
					kind: "toolResult",
					metaKey: EVENTS.toolResult,
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					content: textOf(message.content),
					isError: message.isError === true,
				});
			}
		}
	});

	return records;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const part of content) {
			if (part === null || typeof part !== "object") continue;
			const value = part as { type?: unknown; text?: unknown; thinking?: unknown; sections?: unknown };
			if (typeof value.text === "string") parts.push(value.text);
			else if (value.type === "thinking" && typeof value.thinking === "string") parts.push(String(value.thinking));
			else if (Array.isArray(value.sections))
				parts.push(
					value.sections
						.map((section) => textOf(section))
						.filter((text) => text !== "")
						.join("\n"),
				);
		}
		return parts.filter((text) => text !== "").join("\n");
	}
	if (content !== null && typeof content === "object") {
		const value = content as { sections?: unknown; text?: unknown };
		if (Array.isArray(value.sections))
			return value.sections
				.map((section) => textOf(section))
				.filter((text) => text !== "")
				.join("\n");
		if (typeof value.text === "string") return value.text;
	}
	return "";
}
