import type { Session } from "@milu/core";
import { EVENTS } from "@milu/core";
import type { SeqEntry } from "@milu/protocol";

import type { SandboxMode } from "./types.ts";

export interface EscalationRequest {
	readonly escalationId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly params: unknown;
	readonly command: string;
	readonly from: SandboxMode;
	readonly to: SandboxMode;
	readonly justification: string;
	readonly timestamp: number;
}

export type EscalationDecision = "approved" | "rejected" | "dropped";

export interface EscalationState {
	readonly requests: readonly EscalationRequest[];
	readonly decided: ReadonlySet<string>;
}

export interface RecordedDecision {
	readonly approved: boolean;
	readonly dropped: boolean;
}

function requestOf(data: unknown): EscalationRequest | null {
	const raw = data as Partial<EscalationRequest> | undefined;
	if (typeof raw?.escalationId !== "string" || typeof raw.toolCallId !== "string" || typeof raw.toolName !== "string") return null;
	return {
		escalationId: raw.escalationId,
		toolCallId: raw.toolCallId,
		toolName: raw.toolName,
		params: raw.params,
		command: typeof raw.command === "string" ? raw.command : "",
		from: raw.from as SandboxMode,
		to: raw.to as SandboxMode,
		justification: typeof raw.justification === "string" ? raw.justification : "",
		timestamp: typeof raw.timestamp === "number" ? raw.timestamp : 0,
	};
}

export function readDecisions(entries: readonly SeqEntry[]): ReadonlyMap<string, RecordedDecision> {
	const decisions = new Map<string, RecordedDecision>();
	for (const { entry } of entries) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.escalationDecision) continue;
		const data = entry.data as { escalationId?: unknown; approved?: unknown; dropped?: unknown } | undefined;
		if (typeof data?.escalationId !== "string") continue;
		decisions.set(data.escalationId, { approved: data.approved === true, dropped: data.dropped === true });
	}
	return decisions;
}

export function readEscalations(requests: readonly SeqEntry[], decisions: readonly SeqEntry[]): EscalationState {
	const out: EscalationRequest[] = [];
	for (const { entry } of requests) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.escalationRequest) continue;
		const request = requestOf(entry.data);
		if (request) out.push(request);
	}
	return { requests: out, decided: new Set(readDecisions(decisions).keys()) };
}

export async function escalationLog(session: Session): Promise<EscalationState> {
	const [requests, decisions] = await Promise.all([session.records(EVENTS.escalationRequest), session.records(EVENTS.escalationDecision)]);
	return readEscalations(requests, decisions);
}
