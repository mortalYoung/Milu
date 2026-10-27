import { LOG_EVENTS } from "@milu/protocol";

import type { TrajectoryDetail, TrajectoryNode, TrajectoryRecord, TrajectoryRow, TrajectoryTone, TrajectoryUsage } from "./model.ts";

export interface EventMeta {
	readonly hidden?: boolean;
	readonly dedupe?: boolean;
	readonly pin?: string;
	readonly trajectory?: (record: TrajectoryRecord) => TrajectoryNode;
}

const firstLine = (text: string): string =>
	text
		.split("\n")
		.find((line) => line.trim() !== "")
		?.trim() ?? "";

const recordData = (record: TrajectoryRecord): Record<string, unknown> => (record.kind === "custom" ? ((record.data ?? {}) as Record<string, unknown>) : {});

const field = (record: TrajectoryRecord, path: string): unknown =>
	path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), { data: recordData(record) });

const recordText = (record: TrajectoryRecord, path: string): string => {
	const value = field(record, path);
	return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
};

const recordNumber = (record: TrajectoryRecord, path: string): number | undefined => {
	const value = field(record, path);
	return typeof value === "number" ? value : undefined;
};

export function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

const textDetail = (value: string): TrajectoryDetail => ({ content: { kind: "text", value } });
const codeDetail = (value: string, error?: boolean): TrajectoryDetail => ({ content: { kind: "code", value }, ...(error ? { error: true } : {}) });
const jsonDetail = (value: unknown): TrajectoryDetail => ({ content: { kind: "json", value: stringify(value) } });
const metaDetail = (...facts: (string | undefined)[]): TrajectoryDetail => ({ meta: facts.filter((fact): fact is string => fact !== undefined && fact !== "") });

const fmtTok = (value: number | undefined): string => (value && value > 0 ? value.toLocaleString() : "—");

export function formatUsage(usage: TrajectoryUsage | undefined): string | undefined {
	if (!usage) return undefined;
	const reasoning = usage.reasoning ? ` · reasoning ${fmtTok(usage.reasoning)}` : "";
	return `in ${fmtTok(usage.input)} · out ${fmtTok(usage.output)} · cacheRead ${fmtTok(usage.cacheRead)} · cacheWrite ${fmtTok(usage.cacheWrite)}${reasoning} tok`;
}

export function defaultChip(metaKey: string): string {
	const segment = metaKey.split(/[:/_-]/).find((part) => part !== "") ?? metaKey;
	return segment
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 3)
		.toUpperCase();
}

function dataNode(
	tone: TrajectoryTone,
	options: { chip?: string; caption?: (record: TrajectoryRecord) => string; details?: (record: TrajectoryRecord) => TrajectoryDetail[] } = {},
): EventMeta {
	return {
		trajectory: (record) => ({
			chip: options.chip,
			tone,
			caption: options.caption?.(record),
			details: options.details?.(record) ?? [jsonDetail(record.kind === "custom" ? record.data : record)],
		}),
	};
}

function assistantNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "assistant") return {};
	const rows: TrajectoryRow[] = [];
	for (const block of record.blocks) {
		if (block.type !== "thinking") continue;
		const thinking = String(block.thinking ?? "");
		rows.push({ chip: "THINK", tone: "plain", caption: firstLine(thinking), details: [textDetail(thinking)] });
	}
	if (record.sliceMessage !== undefined) {
		for (const block of record.blocks) {
			if (block.type !== "toolCall") continue;
			const name = String(block.name ?? "");
			const args = stringify(block.arguments).replace(/\s+/g, " ").trim();
			rows.push({
				chip: "TOOL",
				tone: "plain",
				caption: args ? `${name} · ${args}` : name,
				details: [{ label: name, description: String(block.id ?? "") }, { content: { kind: "code", value: stringify(block.arguments) } }],
			});
		}
	}
	const texts = record.blocks.filter((block) => block.type === "text").map((block) => String(block.text ?? ""));
	const others = record.blocks.filter((block) => block.type !== "text" && block.type !== "toolCall" && block.type !== "thinking");
	const caption = firstLine(texts.join("\n")) || record.blocks.find((block) => block.type === "toolCall")?.name?.toString() || "assistant";
	rows.push({
		chip: "MSG",
		tone: "plain",
		caption: firstLine(texts.join("\n")) || "assistant",
		details: [
			...texts.map((value) => textDetail(value)),
			...others.map((block) => jsonDetail(block)),
			metaDetail(
				record.model,
				record.provider !== undefined && record.api !== undefined ? `${record.provider} · ${record.api}` : record.provider,
				record.stopReason ? `stop: ${record.stopReason}` : undefined,
				record.responseModel ? `responseModel ${record.responseModel}` : undefined,
				record.responseId ? `response ${record.responseId}` : undefined,
				formatUsage(record.usage),
			),
			...(record.errorMessage ? [{ meta: [record.errorMessage], error: true }] : []),
		],
	});
	return { chip: "MSG", tone: "plain", caption, rows };
}

function toolResultNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "toolResult") return {};
	return {
		chip: "RES",
		tone: "result",
		caption: firstLine(record.content) || record.toolName,
		details: [
			codeDetail(record.content || "(no output)", record.isError),
			metaDetail(`call ${record.toolCallId}`, record.toolName, record.isError ? "error" : "ok", formatUsage(record.usage)),
			...(record.details !== undefined && record.details !== null ? [jsonDetail(record.details)] : []),
		],
	};
}

function toolCallNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "custom") return {};
	const name = recordText(record, "data.name");
	const args = stringify(field(record, "data.args")).replace(/\s+/g, " ").trim();
	return {
		chip: "TOOL",
		tone: "plain",
		caption: args ? `${name} · ${args}` : name,
		details: [{ label: name, description: recordText(record, "data.callId") }, { content: { kind: "code", value: stringify(field(record, "data.args")) } }],
	};
}

function requestHeaderNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "custom") return {};
	const tools = Array.isArray(recordData(record)["tools"])
		? (recordData(record)["tools"] as { name?: unknown; label?: unknown; description?: unknown; parameters?: unknown }[])
		: [];
	const details: TrajectoryDetail[] = tools
		.filter((tool) => tool !== null && typeof tool === "object")
		.map((tool) => ({
			label: String(tool.name ?? ""),
			description: tool.description === undefined ? undefined : String(tool.description),
			meta: tool.label === undefined ? [] : [String(tool.label)],
			content: { kind: "json", value: stringify(tool.parameters) },
		}));
	const names = Array.isArray(field(record, "data.toolNames")) ? (field(record, "data.toolNames") as unknown[]).map(String) : [];
	const caption = names.length > 0 ? `${names.join(", ")} · ${names.length} tool${names.length === 1 ? "" : "s"}` : "request header";
	return { chip: "HDR", tone: "request", caption, details: details.length > 0 ? details : names.map((name) => ({ label: name })) };
}

function agentEndNode(record: TrajectoryRecord): TrajectoryNode {
	const reason = recordText(record, "data.reason") || "completed";
	const error = recordText(record, "data.error");
	return {
		chip: "END",
		tone: "plain",
		caption: error ? `${reason} · ${error}` : reason,
		details: [metaDetail(`run ${recordNumber(record, "data.run") ?? "?"}`, reason), ...(error ? [{ meta: [error], error: true }] : [])],
	};
}

function escalationRequestNode(record: TrajectoryRecord): TrajectoryNode {
	return {
		chip: "ESC",
		tone: "request",
		caption: firstLine(recordText(record, "data.command")),
		details: [
			metaDetail("escalation", recordText(record, "data.escalationId")),
			codeDetail(recordText(record, "data.command")),
			metaDetail(`${recordText(record, "data.from")} → ${recordText(record, "data.to")}`, recordText(record, "data.justification")),
		],
	};
}

function escalationDecisionNode(record: TrajectoryRecord): TrajectoryNode {
	const approved = field(record, "data.approved") === true;
	return {
		chip: "DEC",
		tone: "decision",
		caption: approved ? "approved" : "rejected",
		details: [metaDetail(approved ? "approved" : "rejected", recordText(record, "data.escalationId"))],
	};
}

function compactionNode(record: TrajectoryRecord): TrajectoryNode {
	const summary = recordText(record, "data.summary");
	const tier = recordText(record, "data.tier");
	return {
		chip: "CMP",
		tone: "compact",
		caption: firstLine(summary) || "compaction",
		details: [textDetail(summary || "(empty summary)"), metaDetail(tier ? `tier ${tier}` : undefined), jsonDetail(field(record, "data.shadowedIds") ?? [])],
	};
}

function modelChangeNode(record: TrajectoryRecord): TrajectoryNode {
	return {
		chip: "MOD",
		tone: "change",
		caption: `${recordText(record, "data.provider")} → ${recordText(record, "data.modelId")}`,
		details: [metaDetail(recordText(record, "data.provider"), `→ ${recordText(record, "data.modelId")}`)],
	};
}

function activeToolsNode(record: TrajectoryRecord): TrajectoryNode {
	const names = Array.isArray(field(record, "data.toolNames")) ? (field(record, "data.toolNames") as unknown[]).map(String) : [];
	return { chip: "TOOLS", tone: "change", caption: names.join(", "), details: names.map((name) => ({ label: name })) };
}

export const EVENT_META: Record<string, EventMeta> = {
	"role:user": {
		trajectory: (record) =>
			record.kind !== "user"
				? {}
				: {
						chip: record.skillName ? "SKILL" : "Q",
						tone: record.skillName ? "skill" : "user",
						caption: firstLine(record.content),
						details: [textDetail(record.content)],
					},
	},
	"role:assistant": { trajectory: assistantNode },
	[LOG_EVENTS.agentStart]: { ...dataNode("change", { chip: "RUN", caption: (record) => `run ${recordNumber(record, "data.run") ?? "?"}` }) },
	[LOG_EVENTS.agentEnd]: { trajectory: agentEndNode },
	[LOG_EVENTS.turnStart]: { hidden: true, trajectory: (record) => ({ chip: "TURN", tone: "plain", caption: `turn ${recordNumber(record, "data.turn") ?? 0}` }) },
	[LOG_EVENTS.turnEnd]: { hidden: true, ...dataNode("plain", { chip: "TURN", caption: (record) => `turn ${recordNumber(record, "data.turn") ?? "?"} end` }) },
	[LOG_EVENTS.toolCall]: { trajectory: toolCallNode },
	[LOG_EVENTS.toolResult]: { trajectory: toolResultNode },
	[LOG_EVENTS.requestHeader]: { pin: LOG_EVENTS.systemPrompt, trajectory: requestHeaderNode },
	[LOG_EVENTS.systemPrompt]: {
		dedupe: true,
		trajectory: (record) => ({ chip: "SYS", tone: "system", caption: "System prompt", details: [codeDetail(recordText(record, "data.text"))] }),
	},
	[LOG_EVENTS.sendMessage]: {
		trajectory: (record) => ({ chip: "SEND", tone: "message", caption: firstLine(recordText(record, "data.text")), details: [textDetail(recordText(record, "data.text"))] }),
	},
	[LOG_EVENTS.escalationRequest]: { trajectory: escalationRequestNode },
	[LOG_EVENTS.escalationDecision]: { trajectory: escalationDecisionNode },
	[LOG_EVENTS.compaction]: { trajectory: compactionNode },
	[LOG_EVENTS.modelChange]: { trajectory: modelChangeNode },
	["active_tools_change"]: { trajectory: activeToolsNode },
	[LOG_EVENTS.timeGapReminder]: {
		trajectory: (record) => ({ chip: "GAP", tone: "reminder", caption: firstLine(recordText(record, "data.text")), details: [textDetail(recordText(record, "data.text"))] }),
	},
	[LOG_EVENTS.contextChanged]: dataNode("reminder", { chip: "CTX", caption: (record) => firstLine(recordText(record, "data.workspace")) }),
	[LOG_EVENTS.instructionsChanged]: dataNode("reminder", { chip: "INS" }),
	[LOG_EVENTS.mcpChanged]: dataNode("reminder", { chip: "MCP", caption: (record) => `${recordText(record, "data.server")} · ${recordText(record, "data.change")}` }),
	[LOG_EVENTS.rewind]: dataNode("custom", { chip: "RWD" }),
	[LOG_EVENTS.memoryRunStart]: dataNode("custom", { chip: "MEM", caption: (record) => recordText(record, "data.stage") }),
	[LOG_EVENTS.memoryRunEnd]: dataNode("custom", { chip: "MEM", caption: (record) => recordText(record, "data.reason") }),
	[LOG_EVENTS.memoryContext]: dataNode("custom", { chip: "MEM", caption: (record) => firstLine(recordText(record, "data.text")) }),
	[LOG_EVENTS.taskStart]: dataNode("custom", { chip: "TASK", caption: (record) => recordText(record, "data.title") || recordText(record, "data.taskId") }),
	[LOG_EVENTS.taskEnd]: dataNode("custom", { chip: "TASK", caption: (record) => recordText(record, "data.status") }),
	[LOG_EVENTS.scheduleRun]: dataNode("custom", { chip: "SCHED", caption: (record) => recordText(record, "data.scheduleTitle") }),
	[LOG_EVENTS.commandRun]: dataNode("custom", { chip: "CMD", caption: (record) => firstLine(recordText(record, "data.name")) }),
	[LOG_EVENTS.commandDone]: dataNode("custom", { chip: "CMD", caption: (record) => firstLine(recordText(record, "data.text")) || recordText(record, "data.kind") }),
	[LOG_EVENTS.shellRun]: dataNode("custom", { chip: "SHLL", caption: (record) => firstLine(recordText(record, "data.command")) }),
	[LOG_EVENTS.shellDone]: dataNode("custom", { chip: "SHLL", caption: (record) => firstLine(recordText(record, "data.command")) }),
};

export function trajectoryNode(record: TrajectoryRecord): TrajectoryNode & { chip: string; tone: TrajectoryTone; caption: string; details: TrajectoryDetail[] } {
	const node = EVENT_META[record.metaKey]?.trajectory?.(record) ?? { details: [jsonDetail(record.kind === "custom" ? record.data : record)] };
	return { ...node, chip: node.chip ?? defaultChip(record.metaKey), tone: node.tone ?? "custom", caption: node.caption ?? record.metaKey, details: node.details ?? [] };
}
