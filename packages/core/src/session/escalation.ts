import type { ToolService } from "../services/tools.ts";
import { EVENTS } from "./events.ts";
import type { Session } from "./session.ts";

export interface EscalationRequest {
	readonly escalationId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly params: unknown;
	readonly command: string;
	readonly from: string;
	readonly to: string;
	readonly justification: string;
	readonly timestamp: number;
}

export type EscalationDecision = "approved" | "rejected" | "dropped";

export async function settleEscalation(session: Session, tools: ToolService, request: EscalationRequest, decision: EscalationDecision, drive = true): Promise<boolean> {
	if (!session.claimEscalation(request.escalationId)) return false;
	try {
		if (await decidedAt(session, request.escalationId)) return false;
		const resumed = await session.resume(request.toolCallId, async () => {
			await session.record(EVENTS.escalationDecision, {
				escalationId: request.escalationId,
				approved: decision === "approved",
				...(decision === "dropped" ? { dropped: true } : {}),
				timestamp: Date.now(),
			});
			return tools.run(session, { toolCallId: request.toolCallId, name: request.toolName, params: request.params });
		});
		if (!resumed) await session.record(EVENTS.escalationDecision, { escalationId: request.escalationId, approved: false, dropped: true, timestamp: Date.now() });
		if (resumed && drive) void session.continue();
		return resumed;
	} finally {
		session.releaseEscalation(request.escalationId);
	}
}

async function decidedAt(session: Session, escalationId: string): Promise<boolean> {
	const records = await session.records(EVENTS.escalationDecision);
	return records.some(({ entry }) => {
		if (entry.type !== "custom" || entry.customType !== EVENTS.escalationDecision) return false;
		return (entry.data as { escalationId?: unknown } | undefined)?.escalationId === escalationId;
	});
}

export async function pendingEscalations(session: Session): Promise<readonly EscalationRequest[]> {
	const [requests, decisions] = await Promise.all([session.records(EVENTS.escalationRequest), session.records(EVENTS.escalationDecision)]);
	const settled = new Set<string>();
	for (const { entry } of decisions) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.escalationDecision) continue;
		const data = entry.data as { escalationId?: unknown } | undefined;
		if (typeof data?.escalationId === "string") settled.add(data.escalationId);
	}
	const open: EscalationRequest[] = [];
	for (const { entry } of requests) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.escalationRequest) continue;
		const request = entry.data as Partial<EscalationRequest> | undefined;
		if (typeof request?.escalationId !== "string" || settled.has(request.escalationId)) continue;
		open.push(request as EscalationRequest);
	}
	return open;
}
