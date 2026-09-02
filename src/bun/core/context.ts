import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import { buildSystemPrompt, type PartnerPrompt } from "./prompt";

export class Context {
	turn = 0;
	running = false;
	lastVisibleAt = Date.now();
	lastTurnEndAt = 0;
	contextClearedAt = 0;
	/** Set when set_workspace succeeded this turn; reset on the next turn so each turn may change it once. */
	workspaceSetThisTurn = false;
	skills: { name: string; description: string; digest: string }[] = [];
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
		this.workspaceSetThisTurn = false;
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
		this.contextClearedAt = Date.now();
		this.workspaceSetThisTurn = false;
	}
}
