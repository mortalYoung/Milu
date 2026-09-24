import { isStrictlyWider } from "./modes";
import type { EscalationDecision, EscalationRequest, EscalationResult, SandboxMode } from "./types";

export const ESCALATION_UNAVAILABLE_TEXT = "[sandbox: escalation unavailable — no confining backend mounted]";

export async function escalate(
	request: { command: string; to: SandboxMode; justification: string; toolCallId: string },
	deps: {
		getMode: () => SandboxMode;
		isConfining: () => boolean;
		confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
	},
): Promise<EscalationResult> {
	if (!deps.isConfining() || !deps.confirmEscalation) {
		return { allowed: false, code: "sandbox_unavailable", reason: ESCALATION_UNAVAILABLE_TEXT };
	}
	const from = deps.getMode();
	if (!isStrictlyWider(from, request.to)) {
		return { allowed: false, code: "escalation_not_wider", reason: `[sandbox: escalation rejected — ${request.to} is not strictly wider than ${from}]` };
	}
	if (!request.justification) {
		return { allowed: false, code: "escalation_no_justification", reason: "[sandbox: escalation rejected — justification is required]" };
	}
	const decision = await deps.confirmEscalation({ command: request.command, from, to: request.to, justification: request.justification, toolCallId: request.toolCallId });
	return decision.approved
		? { allowed: true, mode: decision.mode }
		: { allowed: false, code: "escalation_rejected", reason: `[sandbox: escalation rejected — ${decision.reason}]` };
}
