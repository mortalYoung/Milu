import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { DisposableStore, createServiceId, Emitter, type Event, type Service } from "@milu/di";

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
	| ({ type: "turn_end" } & AgentLoopProgress)
	| ({ type: "run_end"; error?: string } & AgentLoopProgress);

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

	constructor(
		private readonly _modelsService: ModelsService,
		private readonly _toolService: ToolService,
	) {
		this._agent = new Agent({
			streamFn: this._modelsService.stream,
			followUpMode: "one-at-a-time",
			steeringMode: "one-at-a-time",
		});
		this.events = this._emitter.event;
		this._disposables.add(this._emitter);
		this._disposables.add({ dispose: this._agent.subscribe((event) => this._relay(event)) });
	}

	// ——— the surface ———

	isRunning(): boolean {
		return this._agent.state.isStreaming;
	}

	messages(): readonly AgentMessage[] {
		return this._agent.state.messages;
	}

	async run(input: string | AgentMessage): Promise<AgentLoopRun> {
		this._agent.state.tools = [...this._toolService.tools()];
		if (typeof input === "string") await this._agent.prompt(input);
		else await this._agent.prompt(input);
		await this._agent.waitForIdle();
		const error = this._agent.state.errorMessage;
		return error ? { error } : {};
	}

	followUp(message: AgentMessage): void {
		this._agent.followUp(message);
	}

	abort(): void {
		this._agent.abort();
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
		this._agent.reset();
	}

	restore(messages: readonly AgentMessage[]): void {
		this._agent.state.messages = [...messages];
	}

	dispose(): void {
		this._disposables.dispose();
	}

	// ——— pi's events, relayed as ours ———

	private _relay(event: AgentEvent): void {
		const progress = { run: this._runs, turn: this._turn };
		switch (event.type) {
			case "agent_start":
				this._runs += 1;
				this._turn = 0;
				this._emitter.fire({ type: "run_start", run: this._runs, turn: 0 });
				return;
			case "turn_start":
				this._turn += 1;
				this._emitter.fire({ type: "turn_start", run: this._runs, turn: this._turn });
				return;
			case "message_update":
				this._emitter.fire({ type: "message_update", ...progress, message: event.message });
				return;
			case "message_end":
				this._emitter.fire({ type: "message_end", ...progress, message: event.message });
				return;
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
				const error = this._agent.state.errorMessage;
				this._emitter.fire(error ? { type: "run_end", run: this._runs, turn: this._turn, error } : { type: "run_end", run: this._runs, turn: this._turn });
				return;
			}
		}
	}
}

export const AgentLoopServiceId = createServiceId<AgentLoopService>("AgentLoopService");
