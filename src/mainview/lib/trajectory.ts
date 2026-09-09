import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createEffect, createMemo, createSignal } from "solid-js";
import { projectView, type SliceItem } from "../../shared/entry-meta";
import type { TrajectoryBlock, TrajectoryRecord } from "../../shared/rpc";
import { foldSliceItems } from "../../shared/slice";
import { fold } from "../../shared/timeline";
import { useSession } from "./contexts/session-context";

export type TrajectoryMode = "origin" | "slice" | "view";

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			if (!block || block.type !== "text") return "";
			return String(block.text ?? "");
		})
		.join("\n");
}

function assistantBlocks(content: unknown): TrajectoryBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content as unknown as TrajectoryBlock[];
}

function messageContent(m: AgentMessage): unknown {
	return (m as unknown as { content?: unknown }).content;
}

function agentMessageToRecord(item: SliceItem, index: number, turn: number): TrajectoryRecord {
	const m = item.message;
	const base = {
		seq: index,
		entryId: item.id,
		time: (m as { timestamp?: number }).timestamp ?? 0,
		sliceMessage: m,
	};
	if (m.role === "user") {
		return { ...base, kind: "user", content: contentText(messageContent(m)) };
	}
	if (m.role === "assistant") {
		const raw = m as unknown as {
			api?: string;
			provider?: string;
			model?: string;
			responseModel?: string;
			responseId?: string;
			stopReason?: string;
			errorMessage?: string;
		};
		return {
			...base,
			kind: "assistant",
			turn,
			blocks: assistantBlocks(messageContent(m)),
			api: raw.api ?? "",
			provider: raw.provider ?? "",
			model: raw.model ?? "",
			responseModel: raw.responseModel,
			responseId: raw.responseId,
			stopReason: raw.stopReason ?? "stop",
			errorMessage: raw.errorMessage,
		};
	}
	if (m.role === "toolResult") {
		const raw = m as unknown as {
			toolCallId?: string;
			toolName?: string;
			content?: unknown;
			isError?: boolean;
		};
		return {
			...base,
			kind: "toolResult",
			turn,
			toolCallId: raw.toolCallId ?? "",
			toolName: raw.toolName ?? "",
			content: contentText(raw.content ?? messageContent(m)),
			isError: raw.isError === true,
		};
	}
	const content = contentText(messageContent(m));
	return {
		...base,
		kind: "custom",
		customType: (m as { customType?: string }).customType ?? "send_message",
		data: { text: content, timestamp: base.time },
	};
}

export function createTrajectory() {
	const { data: session, mutate: sessionMutate } = useSession();
	const [open, setOpen] = createSignal(false);
	const [mode, setMode] = createSignal<TrajectoryMode>("origin");
	const sliceItems = createMemo<SliceItem[]>(() => foldSliceItems(session.origin.entries));

	const sliceRecords = createMemo<TrajectoryRecord[]>(() => {
		let turn = 0;
		return sliceItems().map((item, i) => {
			if (item.message.role === "assistant") turn += 1;
			return agentMessageToRecord(item, i, turn);
		});
	});

	const records = createMemo<TrajectoryRecord[]>(() => {
		const entries = session.origin.entries;
		if (mode() === "slice") return sliceRecords();
		const all = fold(entries);
		if (mode() === "view") {
			const viewIds = new Set(projectView(entries).map((v) => v.id));
			return all.filter((r) => viewIds.has(r.entryId));
		}
		return all;
	});

	function view() {
		const name = session.selected;
		if (!name) return;
		setMode("origin");
		setOpen(true);
		void sessionMutate.originRefresh();
	}

	function changeMode(next: TrajectoryMode) {
		setMode(mode() === next ? "origin" : next);
	}

	createEffect(() => {
		void session.selected;
		setOpen(false);
	});

	return {
		data: { open, records, mode, sliceItems },
		mutate: { setOpen, changeMode, view },
	};
}
