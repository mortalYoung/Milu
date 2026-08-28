import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import { buildSystemPrompt, type PartnerPrompt } from "./prompt";

export function appendSystemReminder(messages: AgentMessage[], content: string, timestamp = Date.now()): void {
	messages.push({ role: "user", content: `<system_reminder>${content}</system_reminder>`, timestamp });
}

export class Context {
	turn = 0;
	running = false;
	lastVisibleAt = Date.now();
	lastTurnEndAt = 0;
	private partner: PartnerPrompt | null = null;
	storage_path: string | null = null;
	workspace_path: string | null = null;
	sandbox_mode: SandboxMode = "workspace-write";
	model: { provider: string; modelId?: string } | null = null;
	thinkingLevel: ThinkingLevel = "high";
	setPartner(partner: PartnerPrompt | null): void {
		this.partner = partner;
	}
	composeSystemPrompt(): string {
		return buildSystemPrompt(this.partner);
	}
	beginTurn(): number {
		this.turn += 1;
		return this.turn;
	}
	endTurn(): void {
		this.lastTurnEndAt = Date.now();
	}
	markUserMessage(): void {
		this.lastVisibleAt = Date.now();
	}
	markVisible(): void {
		this.lastVisibleAt = Date.now();
	}
	visibleElapsedMs(): number {
		return Date.now() - this.lastVisibleAt;
	}
	setRunning(value: boolean): void {
		this.running = value;
	}
	reset(): void {
		this.turn = 0;
		this.running = false;
		this.lastVisibleAt = Date.now();
	}
}
