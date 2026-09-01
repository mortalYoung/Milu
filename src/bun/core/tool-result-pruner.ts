import type { Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Surface, SurfaceNode } from "../../shared/surface";
import type { SessionScope } from "../persist";
import { EVENTS } from "../persist/events";

export interface PruneOptions {
	thresholdChars?: number;
	headChars?: number;
	tailChars?: number;
}

export interface PrunePlan {
	index: number;
	id: string;
	result: ToolResultMessage;
	shadowedTokenEstimate: number;
}

const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";

function codePointLength(text: string): number {
	return Array.from(text).length;
}

function textBlockCount(content: unknown): number {
	if (typeof content === "string") return codePointLength(content);
	if (!Array.isArray(content)) return 0;
	return content.reduce((n, b) => {
		const block = b as { type?: unknown; text?: unknown } | null;
		return n + (block && block.type === "text" && typeof block.text === "string" ? codePointLength(block.text) : 0);
	}, 0);
}

function pruneContent(content: unknown, headChars: number, tailChars: number): unknown {
	if (typeof content === "string") {
		if (codePointLength(content) <= headChars + tailChars) return content;
		return `${Array.from(content).slice(0, headChars).join("")}${PRUNE_MARKER}${Array.from(content).slice(-tailChars).join("")}`;
	}
	if (!Array.isArray(content)) return content;
	const out: unknown[] = [];
	let remainingHead = headChars;
	let remainingTail = tailChars;
	let sawMarker = false;
	for (const b of content) {
		const block = b as { type?: unknown; text?: unknown } | null;
		if (block && block.type === "text" && typeof block.text === "string") {
			const text = block.text;
			if (!sawMarker) {
				const head = Array.from(text).slice(0, remainingHead).join("");
				remainingHead -= codePointLength(head);
				if (remainingHead <= 0 && codePointLength(text) > headChars) {
					out.push({ ...block, text: `${head}${PRUNE_MARKER}` });
					sawMarker = true;
					remainingTail -= 0;
				} else {
					out.push({ ...block, text: head });
				}
			} else if (remainingTail > 0) {
				const tail = Array.from(text).slice(-remainingTail).join("");
				remainingTail -= codePointLength(tail);
				if (tail) out.push({ ...block, text: tail });
			}
		} else {
			out.push(b);
		}
	}
	return out;
}

export function planToolResultPrunes(entries: Entry[], surface: Surface, opts: PruneOptions = {}): PrunePlan[] {
	const threshold = opts.thresholdChars ?? 8192;
	const headChars = opts.headChars ?? 4096;
	const tailChars = opts.tailChars ?? 1024;
	const byId = new Map(entries.map((e) => [e.id, e]));
	const plans: PrunePlan[] = [];
	surface.nodes.forEach((node: SurfaceNode, index: number) => {
		if (node.kind !== "tool_result") return;
		const entry = byId.get(node.id);
		if (!entry || entry.type !== "custom" || entry.customType !== EVENTS.toolResult) return;
		const data = entry.data as ToolResultMessage & { timestamp?: unknown };
		if (textBlockCount(data.content) <= threshold) return;
		const ts = typeof data.timestamp === "number" ? data.timestamp : Date.now();
		const { timestamp: _ts, ...rest } = data as ToolResultMessage & { timestamp?: unknown };
		const result: ToolResultMessage = {
			...rest,
			timestamp: ts,
			content: pruneContent(rest.content, headChars, tailChars) as ToolResultMessage["content"],
		};
		plans.push({ index, id: node.id, result, shadowedTokenEstimate: Math.ceil(textBlockCount(data.content) / 4) });
	});
	return plans;
}

export async function applyToolResultPrunes(scope: SessionScope, surface: Surface, plans: PrunePlan[]): Promise<void> {
	if (plans.length === 0) return;
	const ts = Date.now();
	let generation = surface.replaceGeneration;
	for (const plan of [...plans].sort((a, b) => b.index - a.index)) {
		generation += 1;
		await scope.appendCompactionRecord(
			"compaction/prune",
			{ range: { start: plan.index, end: plan.index }, shadowedSeqs: [plan.id], shadowedTokenEstimate: plan.shadowedTokenEstimate },
			ts,
		);
		const replacementId = await scope.appendToolResult(plan.result, ts);
		await scope.appendSurfaceOp({ op: "replace", start: plan.index, end: plan.index, sourceEventSeqs: [plan.id], replaceGeneration: generation, replacementId }, ts);
	}
}
