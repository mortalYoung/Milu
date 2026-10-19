import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { DisposableStore, Emitter, type Event } from "@milu/di";
import type { PreviewKind, SeqEntry, SessionRow } from "@milu/protocol";

import { AgentLoopService, type AgentLoopEvent } from "../services/agent-loop.ts";
import type { ExecutionService } from "../services/execution.ts";
import type { ModelsService } from "../services/models.ts";
import type { ToolService } from "../services/tools.ts";
import { modelOf, profileOf, readAtOf, type SessionModel, tildify, type SessionProfile, workspaceOf, type WorkspaceFacts, writeModel, writePinned, writeReadAt } from "./files.ts";
import { SessionLog } from "./log.ts";

const DEFAULT_THINKING_LEVEL = "high";

const SEND_MESSAGE = "send_message";
const COMMAND_RUN = "command/run";
const SKILL_RUN = "skill/run";
const SHELL_RUN = "shell/run";

interface LastVisible {
	text: string;
	kind: PreviewKind;
	time: number;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
		.join("");
}

function stampOf(entry: Entry, data: { timestamp?: unknown }): number {
	return typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0);
}

function lastVisible(entries: readonly Entry[]): LastVisible | null {
	let last: LastVisible | null = null;
	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (!("content" in message) || (message.role !== "user" && message.role !== "assistant")) continue;
			const text = textOf(message.content).trim();
			if (text === "") continue;
			last = { text, kind: message.role, time: message.timestamp ?? 0 };
			continue;
		}
		if (entry.type !== "custom") continue;
		const data = (entry.data ?? {}) as { text?: unknown; name?: unknown; command?: unknown; commandId?: unknown; skillId?: unknown; shellId?: unknown; timestamp?: unknown };
		if (entry.customType === SEND_MESSAGE && typeof data.text === "string") {
			last = { text: data.text, kind: "send_message", time: stampOf(entry, data) };
		} else if (entry.customType === COMMAND_RUN && data.commandId != null) {
			last = { text: String(data.name ?? ""), kind: "command", time: stampOf(entry, data) };
		} else if (entry.customType === SKILL_RUN && data.skillId != null) {
			last = { text: String(data.name ?? ""), kind: "skill", time: stampOf(entry, data) };
		} else if (entry.customType === SHELL_RUN && data.shellId != null) {
			last = { text: String(data.command ?? ""), kind: "shell", time: stampOf(entry, data) };
		}
	}
	return last;
}

export interface SessionDeps {
	readonly name: string;
	readonly root: string;
	readonly executionService: ExecutionService;
	readonly modelsService: ModelsService;
	readonly toolService: ToolService;
}

export class Session {
	readonly name: string;
	readonly root: string;
	readonly path: string;
	readonly storage: string;

	readonly onEntry: Event<SeqEntry>;
	readonly onLoopEvent: Event<AgentLoopEvent>;

	private readonly _deps: SessionDeps;
	private readonly _log: SessionLog;
	private readonly _entryEmitter = new Emitter<SeqEntry>();
	private readonly _loopEmitter = new Emitter<AgentLoopEvent>();
	private readonly _disposables = new DisposableStore();
	private _loop: AgentLoopService | null = null;
	private _profile: SessionProfile | null | undefined;
	private _readAt: number | undefined;
	private _workspace: WorkspaceFacts | null | undefined;
	private _model: SessionModel | null | undefined;

	constructor(deps: SessionDeps) {
		this._deps = deps;
		this.name = deps.name;
		this.root = deps.root;
		this.path = tildify(deps.root);
		this.storage = tildify(`${deps.root}/storage`);
		this._log = new SessionLog(deps.executionService, deps.root);
		this.onEntry = this._entryEmitter.event;
		this.onLoopEvent = this._loopEmitter.event;
		this._disposables.add(this._entryEmitter);
		this._disposables.add(this._loopEmitter);
		this._disposables.add(this._log);
		this._disposables.add(this._log.onEntry((entry) => this._entryEmitter.fire(entry)));
	}

	// ——— what the row needs (cheap: files, plus the log's head) ———

	async row(): Promise<SessionRow> {
		const profile = await this._profileOf();
		const readAt = await this._readAtOf();
		const workspace = await this._workspaceOf();
		const facts = await this._facts();
		return {
			name: this.name,
			path: this.path,
			storage: this.storage,
			createdAt: profile?.createdAt ?? 0,
			...(profile?.persona ? { persona: profile.persona } : {}),
			...(profile?.forkedFrom ? { forkedFrom: profile.forkedFrom } : {}),
			...(profile?.pinned ? { pinned: true } : {}),
			...(facts.startedAt ? { startedAt: facts.startedAt } : {}),
			...(readAt !== undefined ? { readAt } : {}),
			...(workspace ? { workspace: workspace.path, workspaceKind: workspace.kind, workspaceRepo: workspace.repo } : {}),
			...(facts.last ? { lastMessage: facts.last.text, lastMessageAt: facts.last.time, lastMessageKind: facts.last.kind } : {}),
			running: this.running,
		};
	}

	get running(): boolean {
		return this._loop?.isRunning() ?? false;
	}

	// ——— the log ———

	async entries(since = 0): Promise<SeqEntry[]> {
		return this._log.entries(since);
	}

	async transcript(): Promise<AgentMessage[]> {
		return this._log.transcript();
	}

	// ——— the run ———

	async open(): Promise<AgentLoopService> {
		if (this._loop) return this._loop;
		await this._log.open();

		const loop = new AgentLoopService(this._deps.modelsService, this._deps.toolService);
		this._applyModel(loop, await this._modelOf());
		this._loop = loop;
		this._disposables.add(loop);
		this._disposables.add(loop.events((event) => this._loopEmitter.fire(event)));
		this._disposables.add(this._record(loop));

		const resumed = await this._log.transcript();
		if (resumed.length > 0) loop.restore(resumed);
		return loop;
	}

	async run(text: string): Promise<void> {
		const loop = await this.open();
		this._applyModel(loop, await this._modelOf());
		void loop.run(text).catch((error: unknown) => {
			console.error(`session ${this.name}: run failed:`, error);
		});
	}

	abort(): void {
		this._loop?.abort();
	}

	private _record(loop: AgentLoopService): { dispose(): void } {
		const started = new Map<string, number>();
		const record = (type: string, data: Record<string, unknown>) => void this._log.record(type, data);
		return loop.events((event) => {
			const progress = { run: event.run, turn: event.turn };
			switch (event.type) {
				case "message_update":
					return;
				case "message_end":
					void this._log.append(event.message);
					return;
				case "run_start":
					record("milu/run", { ...progress, phase: "start", at: Date.now() });
					return;
				case "run_end":
					record("milu/run", { ...progress, phase: "end", at: Date.now(), ...(event.error ? { error: event.error } : {}) });
					return;
				case "turn_start":
					record("milu/turn", { ...progress, phase: "start", at: Date.now() });
					return;
				case "turn_end":
					record("milu/turn", { ...progress, phase: "end", at: Date.now() });
					return;
				case "tool_start":
					started.set(event.toolCallId, Date.now());
					record("milu/tool", { ...progress, phase: "start", id: event.toolCallId, name: event.toolName });
					return;
				case "tool_end": {
					const at = started.get(event.toolCallId);
					started.delete(event.toolCallId);
					record("milu/tool", {
						...progress,
						phase: "end",
						id: event.toolCallId,
						name: event.toolName,
						isError: event.isError,
						...(at === undefined ? {} : { ms: Date.now() - at }),
					});
					return;
				}
			}
		});
	}

	// ——— edits ———

	async workspace(): Promise<WorkspaceFacts | null> {
		return this._workspaceOf();
	}

	async profile(): Promise<SessionProfile | null> {
		return this._profileOf();
	}

	async pin(pinned: boolean): Promise<void> {
		await writePinned(this.root, pinned);
		this._profile = { ...(this._profile ?? { name: this.name, createdAt: Date.now() }), pinned };
	}

	async model(): Promise<SessionModel | null> {
		return this._modelOf();
	}

	thinkingLevel(): string {
		return this._loop?.thinkingLevel() ?? this._model?.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
	}

	async setModel(model: SessionModel): Promise<void> {
		await writeModel(this.root, model);
		this._model = model;
		if (this._loop) this._applyModel(this._loop, model);
	}

	contextUsage(): { used: number; window: number; percent: number } | null {
		const usage = this._loop?.usage();
		if (!usage) return null;
		const window = this._loop?.modelContextWindow();
		if (!window) return null;
		const used = usage.total;
		return { used, window, percent: Math.min(100, Math.round((used / window) * 100)) };
	}

	async markRead(readAt: number): Promise<void> {
		await writeReadAt(this.root, readAt);
		this._readAt = readAt;
	}

	// ——— lifecycle ———

	async close(): Promise<void> {
		this._disposables.dispose();
		await this._log.flush();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	// ——— the files behind the row ———

	private async _modelOf(): Promise<SessionModel | null> {
		if (this._model === undefined) this._model = await modelOf(this.root);
		return this._model;
	}

	private _applyModel(loop: AgentLoopService, model: SessionModel | null): void {
		try {
			loop.setModel(this._deps.modelsService.resolve(model ?? undefined));
			loop.setThinkingLevel((model?.thinkingLevel ?? DEFAULT_THINKING_LEVEL) as ModelThinkingLevel);
		} catch {
			return;
		}
	}

	private async _profileOf(): Promise<SessionProfile | null> {
		if (this._profile === undefined) this._profile = await profileOf(this.root);
		return this._profile;
	}

	private async _readAtOf(): Promise<number | undefined> {
		if (this._readAt === undefined) this._readAt = await readAtOf(this.root);
		return this._readAt;
	}

	private async _workspaceOf(): Promise<WorkspaceFacts | null> {
		if (this._workspace === undefined) this._workspace = await workspaceOf(this.root);
		return this._workspace;
	}

	private async _facts(): Promise<{ startedAt?: number; last: LastVisible | null }> {
		await this._log.open();
		const startedAt = await this._log.startedAt();
		const entries = await this._log.entries();
		return { ...(startedAt ? { startedAt } : {}), last: lastVisible(entries.map((each) => each.entry)) };
	}
}
