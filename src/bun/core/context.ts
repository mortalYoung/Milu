/**
 * AgentContext — the double-loop context system, used together with `new Agent`.
 *
 * Responsibilities:
 * 1) **Record lifecycle values** — state produced during a double-loop run, shared across multiple event callbacks
 *    (turn count, running flag, progress-notification quota, last turn timestamp); event callbacks read and write it;
 * 2) **Provide context** — assemble the system prompt (partner profile + runtime framework/model),
 *    supplying each request's systemPrompt to the loop.
 *
 * Created inside createAgent: read at Agent construction time (initial systemPrompt),
 * written by event callbacks (agent_start/turn_start/turn_end/agent_end).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SandboxMode } from "../../shared/rpc";
import { describeRuntime } from "./agent-config";
import { buildSystemPrompt, type PartnerPrompt } from "./prompt";

/**
 * Append a system reminder as a plain user message (content wrapped in <system_reminder>).
 * It rides in the message chain and is read by the next LLM call; not persisted (a transient
 * context hint, lost on restart, never pollutes user-visible text). Use agent.steer() instead
 * when a new turn must be guaranteed — appending alone does not drive the loop.
 */
export function appendSystemReminder(messages: AgentMessage[], content: string, timestamp = Date.now()): void {
	messages.push({ role: "user", content: `<system_reminder>${content}</system_reminder>`, timestamp });
}

/** Progress-notification interval: when the user has received no visible message for longer than this, remind the model to report back before continuing. */
const NOTIFY_INTERVAL_MS = 20_000;

export class AgentContext {
	// ————— Lifecycle records (read/written by event callbacks) —————
	/** Turn count started (cleared on agent.reset). */
	turn = 0;
	/** Whether the current run (outer loop run) is in progress: decides busy-time queueing in chat, settled by agent_end. */
	running = false;
	/** Timestamp of the most recent visible activity (user message or send_message delivered); the progress-notification clock starts here. */
	lastVisibleAt = Date.now();
	/** Timestamp of the most recent progress notification (cooldown: no repeated reminders). */
	lastNudgeAt = 0;
	/** Timestamp of the most recent turn end (lifecycle record, for later use such as timing stats). */
	lastTurnEndAt = 0;

	// ————— Context inputs —————
	private partner: PartnerPrompt | null = null;
	/** The agent's own storage directory (partner-scoped; must exist). Delivered to the model via system_reminder. */
	storage_path: string | null = null;
	/** The agent's current working directory (set once per conversation via set_workspace). Delivered via system_reminder. */
	workspace_path: string | null = null;
	/** The confinement mode for tool effects (per partner; delivered via the opening reminder). */
	sandbox_mode: SandboxMode = "workspace-write";

	/** Switch Partner (takes effect on the next composeSystemPrompt). */
	setPartner(partner: PartnerPrompt | null): void {
		this.partner = partner;
	}

	/** System prompt = IDENTIFY + PERSONA + WORKSPACE + STORAGE + RESPONSE-FORMAT + Caveats. */
	composeSystemPrompt(): string {
		return buildSystemPrompt(this.partner, describeRuntime());
	}

	/** Compose a trial prompt from the given profile (for preview; does not change the current context). */
	previewSystemPrompt(partner: PartnerPrompt | null): string {
		return buildSystemPrompt(partner, describeRuntime());
	}

	// ————— Lifecycle hooks (called by event callbacks) —————
	/** Each turn start (turn_start): count +1, return the new turn number. */
	beginTurn(): number {
		this.turn += 1;
		return this.turn;
	}

	/** Turn end (turn_end): record the timestamp. */
	endTurn(): void {
		this.lastTurnEndAt = Date.now();
	}

	/** User sent a message: refresh the visible clock (waiting counts from now). */
	markUserMessage(): void {
		this.lastVisibleAt = Date.now();
	}

	/** send_message delivered to the user: refresh the visible clock. */
	markVisible(): void {
		this.lastVisibleAt = Date.now();
	}

	/**
	 * When the user has received no visible message for NOTIFY_INTERVAL_MS and the cooldown since the last
	 * reminder has passed: record this reminder and return true (triggers "notify the user first, then continue").
	 */
	shouldNotify(): boolean {
		const now = Date.now();
		if (now - this.lastVisibleAt < NOTIFY_INTERVAL_MS) return false;
		if (now - this.lastNudgeAt < NOTIFY_INTERVAL_MS) return false;
		this.lastNudgeAt = now;
		return true;
	}

	/** Milliseconds since the last visible activity (used for the reminder copy). */
	visibleElapsedMs(): number {
		return Date.now() - this.lastVisibleAt;
	}

	/** Running state (chat starts the run / agent_end settles it). */
	setRunning(value: boolean): void {
		this.running = value;
	}

	/** Full reset (called on agent.reset): clear the turn count, stop running, restart the clock. */
	reset(): void {
		this.turn = 0;
		this.running = false;
		this.lastVisibleAt = Date.now();
		this.lastNudgeAt = 0;
	}
}
