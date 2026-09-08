import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENT_META, entryKey } from "./entry-meta";
import { EVENTS } from "./events";
import type { Surface, SurfaceNode, SurfaceOpRecord } from "./surface";

export class SurfaceError extends Error {}

function sliceNodeKind(entry: Entry): SurfaceNode["kind"] | null {
	const node = EVENT_META[entryKey(entry)]?.slice?.node;
	return typeof node === "function" ? node(entry) : (node ?? null);
}

export function isSurfaceEntry(entry: Entry): boolean {
	return sliceNodeKind(entry) != null;
}

function entryTime(entry: Entry): number {
	if (entry.type === "message") return entry.message.timestamp ?? entry.timestamp ?? 0;
	if (entry.type === "custom") {
		const data = entry.data as { timestamp?: number } | undefined;
		return data?.timestamp ?? entry.timestamp ?? 0;
	}
	return entry.timestamp ?? 0;
}

function nodeFor(entry: Entry, seq: number): SurfaceNode | null {
	const kind = sliceNodeKind(entry);
	if (!kind) return null;
	return { kind, seq, id: entry.id, time: entryTime(entry) };
}

export function surfaceNodeIds(entries: Entry[]): Set<string> {
	const shadowed = new Set<string>();
	const summaries = new Map<string, Entry>();
	const checkpoints = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType === EVENTS.compactionSummary) {
			summaries.set(entry.id, entry);
			continue;
		}
		if (entry.customType !== EVENTS.surfaceOp) continue;
		const d = (entry.data ?? {}) as SurfaceOpRecord;
		for (const id of d.sourceEventSeqs ?? []) shadowed.add(id);
		if (typeof d.checkpointId === "string") checkpoints.add(d.checkpointId);
	}
	const ids = new Set<string>();
	for (const entry of entries) {
		const node = nodeFor(entry, 0);
		if (!node || shadowed.has(entry.id)) continue;
		ids.add(entry.id);
	}
	for (const id of checkpoints) {
		if (summaries.has(id)) ids.add(id);
	}
	return ids;
}

export function foldSurface(entries: Entry[]): Surface {
	const nodes: SurfaceNode[] = [];
	let replaceGeneration = 0;
	const pendingSummaries = new Map<string, Entry>();
	const pendingReplacements = new Map<string, Entry>();
	const replacementIds = new Set<string>();
	for (const e of entries) {
		if (e.type !== "custom" || e.customType !== EVENTS.surfaceOp) continue;
		const d = (e.data ?? {}) as SurfaceOpRecord;
		if (typeof d.replacementId === "string") replacementIds.add(d.replacementId);
	}
	for (const entry of entries) {
		if (entry.type === "custom") {
			if (entry.customType === EVENTS.compactionSummary) {
				pendingSummaries.set(entry.id, entry);
				continue;
			}
			if (entry.customType === EVENTS.surfaceOp) {
				const op = (entry.data ?? {}) as SurfaceOpRecord;
				applyReplace(nodes, op, entry.id, pendingSummaries, pendingReplacements);
				replaceGeneration = op.replaceGeneration;
				continue;
			}
			if (replacementIds.has(entry.id) && isSurfaceEntry(entry)) {
				pendingReplacements.set(entry.id, entry);
				continue;
			}
		}
		const node = nodeFor(entry, nodes.length);
		if (node) nodes.push(node);
	}
	return { nodes, replaceGeneration };
}

export function applyReplace(nodes: SurfaceNode[], op: SurfaceOpRecord, opEntryId: string, pendingSummaries?: Map<string, Entry>, pendingReplacements?: Map<string, Entry>): void {
	if (op.op !== "replace") {
		throw new SurfaceError(`surface_op ${opEntryId}: unknown op ${JSON.stringify(op)}`);
	}
	if (!Number.isInteger(op.start) || !Number.isInteger(op.end) || op.start < 0 || op.end < op.start || op.end >= nodes.length) {
		throw new SurfaceError(`surface_op ${opEntryId}: invalid range [${op.start}, ${op.end}] for ${nodes.length} nodes`);
	}
	const shadowed = nodes.slice(op.start, op.end + 1);
	const shadowedIds = new Set(shadowed.map((n) => n.id));
	const missing = shadowed.filter((n) => !op.sourceEventSeqs.includes(n.id));
	if (missing.length > 0) {
		throw new SurfaceError(`surface_op ${opEntryId}: provenance missing ${missing.map((n) => n.id).join(",")}`);
	}
	const extra = op.sourceEventSeqs.filter((id) => !shadowedIds.has(id));
	if (extra.length > 0) {
		throw new SurfaceError(`surface_op ${opEntryId}: sourceEventSeqs lists non-shadowed ${extra.join(",")}`);
	}
	nodes.splice(op.start, op.end - op.start + 1);
	if (op.checkpointId) {
		const summary = pendingSummaries?.get(op.checkpointId);
		if (!summary) {
			throw new SurfaceError(`surface_op ${opEntryId}: checkpoint ${op.checkpointId} not found`);
		}
		nodes.splice(op.start, 0, { kind: "user", seq: op.start, id: summary.id, time: entryTime(summary) });
	} else if (op.replacementId) {
		const entry = pendingReplacements?.get(op.replacementId);
		if (!entry) {
			throw new SurfaceError(`surface_op ${opEntryId}: replacement ${op.replacementId} not found`);
		}
		const node = nodeFor(entry, op.start);
		if (!node) {
			throw new SurfaceError(`surface_op ${opEntryId}: replacement ${op.replacementId} is not a surface node`);
		}
		nodes.splice(op.start, 0, node);
	}
}
