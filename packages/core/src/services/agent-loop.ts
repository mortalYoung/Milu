import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { DisposableStore, createServiceId, Emitter, type Event, type Service } from "@milu/di";

import { type AgentReminder, reminderText } from "../session/events.ts";
import { followUpId } from "../session/followups.ts";
import type { Session } from "../session/session.ts";
import type { AgentHookPoint, HookService } from "./hooks.ts";
import type { ModelsService } from "./models.ts";
import type { ToolService } from "./tools.ts";

export interface AgentLoopProgress {
	run: number;
	turn: number;
}

export type AgentLoopEvent =
	| ({ type: "run_start" } & AgentLoopProgress)
	| ({ type: "turn_start" } & AgentLoopProgress)
	| ({ type: "message_update"; message: AgentMessage } & AgentLoopProgress)
	| ({ type: "message_end"; message: AgentMessage } & AgentLoopProgress)
	| ({ type: "tool_start"; toolCallId: string; toolName: string; args: unknown } & AgentLoopProgress)
	| ({ type: "tool_end"; toolCallId: string; toolName: string; isError: boolean } & AgentLoopProgress)
	| { type: "reminder"; reminder: AgentReminder }
	| ({ type: "turn_end" } & AgentLoopProgress)
	| ({ type: "retry_scheduled"; retry: number; maxRetries: number; delayMs: number; error: string } & AgentLoopProgress)
	| ({ type: "retry_started"; retry: number } & AgentLoopProgress)
	| { type: "followups"; items: readonly AgentMessage[] }
	| ({ type: "run_end"; stopped?: boolean; error?: string } & AgentLoopProgress);

export interface AgentLoopRun {
	error?: string;
}

export class AgentLoopService implements Service {
	readonly events: Event<AgentLoopEvent>;

	private readonly _agent: Agent;
	private readonly _emitter = new Emitter<AgentLoopEvent>();
	private readonly _disposables = new DisposableStore();
	private _runs = 0;
	private _turn = 0;
	private _running = false;
	private _stopped = false;
	private readonly _pending: (string | AgentMessage)[] = [];
	private readonly _followUps: AgentMessage[] = [];
	/** A failed attempt's tail, held until the retry decision says whether it is final. */
	private _held: AgentEvent[] = [];
	private _releasing = false;
	private _retries = 0;
	private _wake: (() => void) | null = null;

	constructor(
		private readonly _modelsService: ModelsService,
		private readonly _toolService: ToolService,
		private readonly _hookService: HookService,
		private readonly _session: Session,
	) {
		this._agent = new Agent({
			streamFn: this._modelsService.stream,
			followUpMode: "one-at-a-time",
			steeringMode: "one-at-a-time",
			transformContext: async (messages) => {
				const injected = await this._emit("beforeRequest", messages);
				if (injected.length === 0) return messages;
				return [...messages, ...injected];
			},
		});
		this.events = this._emitter.event;
		this._disposables.add(this._emitter);
		this._disposables.add({ dispose: this._agent.subscribe((event) => this._relay(event)) });
	}

	// ——— the surface ———

	isRunning(): boolean {
		return this._running;
	}

	isStreaming(): boolean {
		return this._agent.state.isStreaming;
	}

	messages(): readonly AgentMessage[] {
		return this._agent.state.messages;
	}

	tools(): readonly AgentTool[] {
		return this._agent.state.tools;
	}

	async run(input: string | AgentMessage): Promise<AgentLoopRun> {
		if (this._running) {
			this._pending.push(input);
			return {};
		}
		this._stopped = false;
		this._running = true;
		try {
			return await this._runWithRetry(input);
		} finally {
			this._running = false;
			this._requeueFollowUps();
			void this._drain();
		}
	}

	async continue(): Promise<AgentLoopRun> {
		if (this._running) throw new Error("the loop is already running");
		this._stopped = false;
		this._running = true;
		try {
			return await this._runWithRetry(null);
		} finally {
			this._running = false;
			this._requeueFollowUps();
			void this._drain();
		}
	}

	followUp(message: AgentMessage): void {
		this._followUps.push(message);
		this._agent.followUp(message);
		this._emitFollowUps();
	}

	followUps(): readonly AgentMessage[] {
		return [...this._followUps];
	}

	cancelFollowUp(id: string): boolean {
		const at = this._followUps.findIndex((item) => followUpId(item) === id);
		if (at < 0) return false;
		this._followUps.splice(at, 1);
		this._agent.clearFollowUpQueue();
		for (const item of this._followUps) this._agent.followUp(item);
		this._emitFollowUps();
		return true;
	}

	/** One attempt, then another if the failure hook asks for it — the failed one leaves no trace. */
	private async _runWithRetry(input: string | AgentMessage | null): Promise<AgentLoopRun> {
		let next = input;
		this._retries = 0;
		for (;;) {
			const result = await this._attempt(next);
			if (result.error === undefined) {
				this._release();
				return result;
			}
			const message = this._agent.state.messages.at(-1);
			this._retries += 1;
			const decision =
				this._stopped || message?.role !== "assistant"
					? null
					: await this._hookService.askRetry({ session: this._session, message: message as AssistantMessage, attempt: this._retries });
			if (decision === null) {
				this._release();
				return result;
			}
			this._held = [];
			this._dropFailure();
			this._emitter.fire({
				type: "retry_scheduled",
				run: this._runs,
				turn: this._turn,
				retry: this._retries,
				maxRetries: decision.maxRetries,
				delayMs: decision.delayMs,
				error: result.error,
			});
			await this._idle(decision.delayMs);
			if (this._stopped) {
				this._stopped = false;
				this._emitter.fire({ type: "run_end", run: this._runs, turn: this._turn, stopped: true });
				return {};
			}
			this._emitter.fire({ type: "retry_started", run: this._runs, turn: this._turn, retry: this._retries });
			next = null;
		}
	}

	private async _attempt(input: string | AgentMessage | null): Promise<AgentLoopRun> {
		if (input !== null) {
			this._agent.state.tools = [...(await this._toolService.tools(this._session))];
			await this._emit("beforeRun", this._agent.state.messages);
			if (typeof input === "string") await this._agent.prompt(input);
			else await this._agent.prompt(input);
		} else {
			await this._agent.continue();
		}
		await this._agent.waitForIdle();
		const error = this._agent.state.errorMessage;
		return error ? { error } : {};
	}

	/** Give the failed attempt back to whoever listens — the records are written from here. */
	private _release(): void {
		const held = this._held;
		this._held = [];
		this._releasing = true;
		try {
			for (const event of held) this._relay(event);
		} finally {
			this._releasing = false;
		}
	}

	private _dropFailure(): void {
		const messages = this._agent.state.messages;
		const last = messages.at(-1);
		if (last !== undefined && last.role === "assistant" && (last as { stopReason?: unknown }).stopReason === "error") this._agent.state.messages = messages.slice(0, -1);
	}

	/** The backoff, woken early by `stop()` so an aborted retry does not wait out its delay. */
	private _idle(ms: number): Promise<void> {
		if (ms <= 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this._wake = null;
				resolve();
			};
			const timer = setTimeout(done, ms);
			this._wake = done;
		});
	}

	private _awaitingToolResult(): boolean {
		const last = this._agent.state.messages.at(-1);
		if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return false;
		return last.content.some((block) => (block as { type?: unknown }).type === "toolCall");
	}

	private async _drain(): Promise<void> {
		while (!this._running && !this._session.hasSuspended?.() && !this._awaitingToolResult() && this._pending.length > 0) {
			const next = this._pending.shift()!;
			this._running = true;
			this._stopped = false;
			try {
				await this._runWithRetry(next);
			} catch (error) {
				console.error(`loop ${this._session.name}: queued message failed:`, error);
				return;
			} finally {
				this._running = false;
				this._requeueFollowUps();
			}
		}
	}

	stop(): void {
		this._stopped = true;
		this._pending.length = 0;
		this._clearFollowUps();
		this._agent.abort();
		this._wake?.();
	}

	waitForIdle(): Promise<void> {
		return this._agent.waitForIdle();
	}

	systemPrompt(): string {
		return this._agent.state.systemPrompt;
	}

	setSystemPrompt(prompt: string): void {
		this._agent.state.systemPrompt = prompt;
	}

	modelContextWindow(): number | null {
		return this._agent.state.model?.contextWindow ?? null;
	}

	usage(): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null {
		const messages = this._agent.state.messages;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (!message || message.role !== "assistant") continue;
			const usage = message.usage;
			return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, total: usage.totalTokens };
		}
		return null;
	}

	setModel(model: Model<Api>): void {
		this._agent.state.model = model;
	}

	thinkingLevel(): ModelThinkingLevel {
		return this._agent.state.thinkingLevel;
	}

	setThinkingLevel(level: ModelThinkingLevel): void {
		this._agent.state.thinkingLevel = level;
	}

	reset(): void {
		this._running = false;
		this._stopped = false;
		this._pending.length = 0;
		this._clearFollowUps();
		this._agent.reset();
	}

	restore(messages: readonly AgentMessage[]): void {
		this._agent.state.messages = [...messages];
	}

	async refreshContext(): Promise<void> {
		await this._emit("afterCompact", this._agent.state.messages);
	}

	private inject(messages: readonly AgentMessage[]): void {
		this._agent.state.messages = [...this._agent.state.messages, ...messages];
	}

	dispose(): void {
		this._disposables.dispose();
	}

	// ——— the hooks, fired where the loop turns ———

	private async _emit(point: AgentHookPoint, messages: readonly AgentMessage[]): Promise<readonly AgentMessage[]> {
		const reminders = await this._hookService.emit(point, { session: this._session, messages });
		const timestamp = Date.now();
		const injected: AgentMessage[] = [];
		for (const reminder of reminders) {
			const text = reminderText(reminder.type, reminder.data);
			if (text.trim() === "") continue;
			injected.push({ role: "user", content: text, timestamp, reminder: reminder.type } as AgentMessage);
			this._emitter.fire({ type: "reminder", reminder });
		}
		if (injected.length === 0) return [];
		this.inject(injected);
		return injected;
	}

	private _emitFollowUps(): void {
		this._emitter.fire({ type: "followups", items: [...this._followUps] });
	}

	private _clearFollowUps(): void {
		const had = this._followUps.length > 0;
		this._followUps.length = 0;
		this._agent.clearFollowUpQueue();
		if (had) this._emitFollowUps();
	}

	private _dropFollowUp(id: string): void {
		const at = this._followUps.findIndex((item) => followUpId(item) === id);
		if (at < 0) return;
		this._followUps.splice(at, 1);
		this._emitFollowUps();
	}

	/** A follow-up the run never reached starts the next run instead of being lost. */
	private _requeueFollowUps(): void {
		if (this._followUps.length === 0) return;
		this._pending.push(...this._followUps.splice(0));
		this._agent.clearFollowUpQueue();
		this._emitFollowUps();
	}

	// ——— pi's events, relayed as ours ———

	private _relay(event: AgentEvent): void {
		if (!this._releasing) {
			if (event.type === "agent_end") {
				this._held.push(event);
				return;
			}
			if (event.type === "message_end" && event.message.role === "assistant" && (event.message as { stopReason?: unknown }).stopReason === "error") {
				this._held.push(event);
				return;
			}
		}
		const progress = { run: this._runs, turn: this._turn };
		switch (event.type) {
			case "agent_start":
				this._runs += 1;
				this._turn = 0;
				if (this._stopped) this._agent.abort();
				this._emitter.fire({ type: "run_start", run: this._runs, turn: 0 });
				return;
			case "turn_start":
				this._turn += 1;
				this._emitter.fire({ type: "turn_start", run: this._runs, turn: this._turn });
				return;
			case "message_update":
				this._emitter.fire({ type: "message_update", ...progress, message: event.message });
				return;
			case "message_end": {
				const claimed = event.message.role === "user" ? followUpId(event.message) : null;
				if (claimed !== null) this._dropFollowUp(claimed);
				this._emitter.fire({ type: "message_end", ...progress, message: event.message });
				return;
			}
			case "tool_execution_start":
				this._emitter.fire({ type: "tool_start", ...progress, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
				return;
			case "tool_execution_end":
				this._emitter.fire({ type: "tool_end", ...progress, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
				return;
			case "turn_end":
				this._emitter.fire({ type: "turn_end", ...progress });
				return;
			case "agent_end": {
				const stopped = this._stopped;
				const error = stopped ? undefined : this._agent.state.errorMessage;
				this._stopped = false;
				this._emitter.fire({
					type: "run_end",
					run: this._runs,
					turn: this._turn,
					...(stopped ? { stopped: true } : {}),
					...(error ? { error } : {}),
				});
				return;
			}
		}
	}
}

export const IAgentLoopService = createServiceId<AgentLoopService>("AgentLoopService");
