import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentMessage, AgentToolResult } from "@earendil-works/pi-agent-core";
import { isContextOverflow } from "@earendil-works/pi-ai";
import type { Api, AssistantMessage, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { DisposableStore, Emitter, type Event } from "@milu/di";
import type { Entry, ImageRef, PendingKind, PreviewKind, PromptImage, SeqEntry, SessionRow } from "@milu/protocol";

import { encodeImageBytes, type ImageStore } from "../attachments/store.ts";
import { AgentLoopService, type AgentLoopEvent, type PendingMessage } from "../services/agent-loop.ts";
import type { CompactionService } from "../services/compaction.ts";
import type { ExecutionService } from "../services/execution.ts";
import type { HookService } from "../services/hooks.ts";
import type { ModelsService } from "../services/models.ts";
import type { PromptService } from "../services/prompt.ts";
import type { SettingsService } from "../services/settings.ts";
import type { ToolService } from "../services/tools.ts";
import { compactionBudget, compactionPolicy, type CompactionBudget } from "./budget.ts";
import { EVENTS } from "./events.ts";
import {
	modelOf,
	promptChangedSinceLastPersist,
	forkingOf,
	profileOf,
	readAtOf,
	recordPrompt,
	sandboxOf,
	type SandboxConfig,
	type SessionModel,
	tildify,
	type SessionProfile,
	workspaceOf,
	writeWorkspace,
	type WorkspaceFacts,
	writeModel,
	writePinned,
	writeProfile,
	writeReadAt,
	writeSandbox,
} from "./files.ts";
import { SessionLog } from "./log.ts";
import type { OriginWindow } from "./origin.ts";
import type { SliceItem } from "./slice.ts";
import { textOf } from "./text.ts";
import { type ContextBreakdown, priceMessages, totalTokens } from "./tokens.ts";

const DEEP_TAIL_BYTES = 8 * 1024 * 1024;

const DEFAULT_THINKING_LEVEL = "high";

const SEND_MESSAGE = "send_message";
const SKILL_RUN = "skill/run";

interface LastVisible {
	text: string;
	kind: PreviewKind;
	time: number;
}

function echoed(message: AgentMessage, candidate: AgentMessage): boolean {
	if (message.role !== candidate.role) return false;
	return JSON.stringify(message.content) === JSON.stringify(candidate.content);
}

function saidAnything(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	return content.some((block) => {
		const value = block as { type?: unknown; text?: unknown; thinking?: unknown; redacted?: unknown };
		if (value.type === "text") return String(value.text ?? "").trim() !== "";
		if (value.type === "thinking") return value.redacted === true || String(value.thinking ?? "").trim() !== "";
		return false;
	});
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
			if (typeof (message as { skill?: unknown }).skill === "string") continue;
			const text = textOf(message.content).trim();
			if (text === "") continue;
			last = { text, kind: message.role, time: message.timestamp ?? 0 };
			continue;
		}
		if (entry.type !== "custom") continue;
		const data = (entry.data ?? {}) as {
			text?: unknown;
			name?: unknown;
			command?: unknown;
			commandId?: unknown;
			skillId?: unknown;
			shellId?: unknown;
			via?: unknown;
			timestamp?: unknown;
		};
		if (entry.customType === SEND_MESSAGE && typeof data.text === "string" && data.via !== "shell") {
			last = { text: data.text, kind: "send_message", time: stampOf(entry, data) };
		} else if (entry.customType === EVENTS.commandRun && data.commandId != null) {
			last = { text: String(data.name ?? ""), kind: "command", time: stampOf(entry, data) };
		} else if (entry.customType === SKILL_RUN && data.skillId != null) {
			last = { text: String(data.name ?? ""), kind: "skill", time: stampOf(entry, data) };
		} else if (entry.customType === EVENTS.shellRun && data.shellId != null) {
			last = { text: String(data.command ?? ""), kind: "shell", time: stampOf(entry, data) };
		}
	}
	return last;
}

type ToolResult = Extract<AgentMessage, { role: "toolResult" }>;

interface ToolCallBlock {
	readonly type?: string;
	readonly id?: unknown;
	readonly name?: unknown;
}

function toolCalls(message: AgentMessage): ToolCallBlock[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return (message.content as ToolCallBlock[]).filter((block) => block.type === "toolCall");
}

export interface SessionDeps {
	readonly name: string;
	readonly root: string;
	readonly executionService: ExecutionService;
	readonly modelsService: ModelsService;
	readonly toolService: ToolService;
	readonly promptService: PromptService;
	readonly hookService: HookService;
	readonly compactionService: CompactionService;
	readonly settingsService: SettingsService;
	readonly images: ImageStore;
}

export class Session {
	readonly name: string;
	readonly root: string;
	readonly path: string;
	readonly storage: string;
	readonly images: ImageStore;

	readonly onEntry: Event<SeqEntry>;
	readonly onLoopEvent: Event<AgentLoopEvent>;
	readonly onCompacting: Event<boolean>;

	private readonly _deps: SessionDeps;
	private readonly _log: SessionLog;
	private readonly _entryEmitter = new Emitter<SeqEntry>();
	private readonly _loopEmitter = new Emitter<AgentLoopEvent>();
	private readonly _compactingEmitter = new Emitter<boolean>();
	private readonly _disposables = new DisposableStore();
	private _loop: AgentLoopService | null = null;
	private _opening: Promise<AgentLoopService> | null = null;
	private _profile: SessionProfile | null | undefined;
	private _readAt: number | undefined;
	private _workspace: WorkspaceFacts | null | undefined;
	private _model: SessionModel | null | undefined;
	private _usedTokens: number | null | undefined;
	private _headerSignature: string | null = null;
	private _compacted = false;
	private _overflowCompactions = 0;
	private _compacting = false;
	private _error: string | null = null;
	private _errorAt = 0;
	private _prompt = "";
	private readonly _suspended = new Set<string>();
	private readonly _preLogged = new Set<AgentMessage>();

	constructor(deps: SessionDeps) {
		this._deps = deps;
		this.name = deps.name;
		this.root = deps.root;
		this.path = tildify(deps.root);
		this.storage = tildify(`${deps.root}/storage`);
		this.images = deps.images;
		this._log = new SessionLog(deps.executionService, deps.root, deps.images);
		this.onEntry = this._entryEmitter.event;
		this.onLoopEvent = this._loopEmitter.event;
		this.onCompacting = this._compactingEmitter.event;
		this._disposables.add(this._entryEmitter);
		this._disposables.add(this._loopEmitter);
		this._disposables.add(this._compactingEmitter);
		this._disposables.add(this._log);
		this._disposables.add(this._log.onEntry((entry) => this._entryEmitter.fire(entry)));
	}

	// ——— what the row needs (cheap: files, plus the log's head) ———

	async row(): Promise<SessionRow> {
		const profile = await this._profileOf();
		const readAt = await this._readAtOf();
		const workspace = await this._workspaceOf();
		const facts = await this._facts();
		const forking = (await forkingOf(this.root)) !== null;
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
			...(workspace ? { workspace: workspace.path } : {}),
			...(facts.last ? { lastMessage: facts.last.text, lastMessageAt: facts.last.time, lastMessageKind: facts.last.kind } : {}),
			running: this.running,
			...(this._compacting ? { compacting: true } : {}),
			...(forking ? { forking: true } : {}),
			...(this._error ? { error: this._error, ...(this._errorAt > 0 ? { errorAt: this._errorAt } : {}) } : {}),
		};
	}

	get running(): boolean {
		return this._loop?.isRunning() ?? false;
	}

	get compacting(): boolean {
		return this._compacting;
	}

	messages(): readonly AgentMessage[] {
		return this._loop?.messages() ?? [];
	}

	// ——— the log ———

	async records(customType: string): Promise<SeqEntry[]> {
		return this._log.records(customType);
	}

	async window(options: { mode?: "older" | "newer"; cursor?: string; conversations: number }): Promise<OriginWindow> {
		return this._log.window(options);
	}

	async seqsOf(entries: readonly Entry[]): Promise<SeqEntry[]> {
		return entries.map((entry) => ({ seq: entry.seq, entry })).filter((each) => each.seq > 0);
	}

	async transcript(options?: { keepDangling?: boolean }): Promise<AgentMessage[]> {
		return this._log.transcript(options);
	}

	async sliceItems(): Promise<SliceItem[]> {
		return this._log.sliceItems();
	}

	async rawEntries(): Promise<Entry[]> {
		return this._log.rawEntries();
	}

	async flush(): Promise<void> {
		return this._log.flush();
	}

	async deliver(
		text: string,
		meta: {
			schedule?: { scheduleId: string; runId: string; title: string };
			peer?: { from: string; hop: number; notice?: boolean };
			skill?: string;
		} = {},
	): Promise<{ ok: true } | { ok: false; error: string }> {
		return this._submit({
			role: "user",
			content: text,
			timestamp: Date.now(),
			...(meta.skill ? { skill: meta.skill } : {}),
			...(meta.schedule ? { scheduleId: meta.schedule.scheduleId, scheduleRunId: meta.schedule.runId, scheduleTitle: meta.schedule.title } : {}),
			...(meta.peer ? { from: meta.peer.from, hop: meta.peer.hop, ...(meta.peer.notice ? { notice: true } : {}) } : {}),
		} as AgentMessage);
	}

	private async _submit(message: AgentMessage, wire: AgentMessage = message): Promise<{ ok: true } | { ok: false; error: string }> {
		const loop = await this.open();
		if (loop.isRunning()) {
			const queued = { ...wire, pendingId: randomUUID() } as unknown as AgentMessage;
			if (this._deps.settingsService.get().sendWhileRunning === "steering") loop.steer(queued);
			else loop.followUp(queued);
			return { ok: true };
		}
		const failure = this._applyModel(loop, await this._modelOf());
		if (failure !== null) {
			await this._failBeforeRun(message, failure);
			return { ok: false, error: failure };
		}
		await this._log.append(message);
		this._preLogged.add(wire);
		await this._autoCompact();
		this._launch(loop, wire);
		return { ok: true };
	}

	private _launch(loop: AgentLoopService, message: AgentMessage): void {
		void loop.run(message).catch((error: unknown) => {
			this._error = error instanceof Error ? error.message : String(error);
			this._errorAt = Date.now();
			console.error(`session ${this.name}: run failed:`, error);
		});
	}

	private async _failBeforeRun(message: AgentMessage | null, failure: string): Promise<void> {
		this._error = null;
		this._errorAt = 0;
		if (message !== null) await this._log.append(message);
		await this._log.record(EVENTS.agentEnd, { reason: "error", error: failure, timestamp: Date.now() });
	}

	async record(type: string, data?: unknown): Promise<void> {
		await this._log.record(type, data);
	}

	async replay(messages: readonly AgentMessage[]): Promise<void> {
		for (const message of messages) await this._log.append(message);
	}

	suspend(toolCallId: string): void {
		this._suspended.add(toolCallId);
	}

	hasSuspended(): boolean {
		return this._suspended.size > 0;
	}

	async resume(toolCallId: string, build: () => Promise<AgentToolResult<unknown>>): Promise<boolean> {
		const loop = await this.open();
		if (loop.isStreaming()) {
			this._suspended.delete(toolCallId);
			return false;
		}
		const messages = [...(await this._log.transcript({ keepDangling: true }))];
		const at = messages.findIndex((message) => toolCalls(message).some((call) => call.id === toolCallId));
		if (at < 0) {
			this._suspended.delete(toolCallId);
			return false;
		}
		if (messages.slice(at + 1).some((message) => message.role !== "toolResult")) {
			this._suspended.delete(toolCallId);
			return false;
		}

		const call = toolCalls(messages[at]!).find((each) => each.id === toolCallId);
		const outcome = await build();
		const result = {
			role: "toolResult",
			toolCallId,
			toolName: String(call?.name ?? ""),
			content: outcome.content,
			details: outcome.details,
			timestamp: Date.now(),
		} as ToolResult;
		loop.restore([...messages, result]);
		await this._recordToolResult(result);
		this._suspended.delete(toolCallId);
		return true;
	}

	async continue(): Promise<void> {
		const loop = await this.open();
		if (loop.isRunning()) return;
		const failure = this._applyModel(loop, await this._modelOf());
		if (failure !== null) return this._failBeforeRun(null, failure);
		await this._autoCompact();
		if (loop.isRunning()) return;
		void loop.continue().catch((error: unknown) => {
			this._error = error instanceof Error ? error.message : String(error);
			this._errorAt = Date.now();
			console.error(`session ${this.name}: continue failed:`, error);
		});
	}

	// ——— the run ———

	async reset(): Promise<void> {
		await this._log.reset();
		const loop = await this.open();
		loop.reset();
		this._suspended.clear();
		this._usedTokens = null;
		this._compacted = false;
		this._error = null;
		this._errorAt = 0;
	}

	private async _autoCompact(): Promise<void> {
		const policy = compactionPolicy(this._deps.settingsService.get().compaction, await this._compactionTarget());
		if (!(policy.thresholdRatio > 0)) return;
		const budget = await this._compactionBudget();
		if (!budget) return;
		const used = await this._contextTokens();
		if (used === null || used < budget.threshold) return;
		try {
			await this.compact();
		} catch (error) {
			console.error(`session ${this.name}: auto compact failed:`, error);
		}
	}

	private async _compactionBudget(): Promise<CompactionBudget | null> {
		const model = await this._resolvedModel();
		if (!model) return null;
		const policy = compactionPolicy(this._deps.settingsService.get().compaction, await this._compactionTarget());
		try {
			return compactionBudget({ contextWindow: model.contextWindow, outputReserve: model.maxTokens, policy });
		} catch (error) {
			console.error(`session ${this.name}: compaction is misconfigured:`, error);
			return null;
		}
	}

	private async _compactionTarget(): Promise<{ readonly provider: string; readonly model?: string }> {
		const target = await this._modelOf();
		return { provider: target?.provider ?? "", ...(target?.modelId === undefined ? {} : { model: target.modelId }) };
	}

	async compact(): Promise<{ shadowed: number } | null> {
		return this._compact({ duringRun: false });
	}

	async recoverOverflow(message: AssistantMessage): Promise<boolean> {
		if (this._overflowCompactions >= (this._deps.settingsService.get().compaction?.maxOverflowRetries ?? 1)) return false;
		if (!isContextOverflow(message, (await this._contextWindow()) ?? undefined)) return false;
		this._overflowCompactions += 1;
		try {
			return (await this._compact({ duringRun: true })) !== null;
		} catch (error) {
			console.error(`session ${this.name}: overflow recovery failed:`, error);
			return false;
		}
	}

	private async _compact(options: { readonly duringRun: boolean }): Promise<{ shadowed: number } | null> {
		if (!options.duringRun && this.running) throw new Error("the chat is busy");
		if (this.hasSuspended()) throw new Error("an approval is pending");
		if (this._compacting) throw new Error("a compaction is already running");
		if ((await this._log.openCompaction()) !== null) {
			throw new Error("a compaction is already recorded as running — restart the app if it crashed mid-compaction");
		}
		this._setCompacting(true);
		let locked = false;
		try {
			const entries = await this._log.rawEntries();
			await this._log.record(EVENTS.compactionStart, { timestamp: Date.now() });
			locked = true;
			const messages = await this._log.transcript();
			const retainTokens = (await this._compactionBudget())?.retainTokens ?? 0;
			const plan = await this._deps.compactionService.plan({ session: this, entries, messages, retainTokens });
			if (!plan) {
				await this._log.record(EVENTS.compactionEnd, { timestamp: Date.now() });
				locked = false;
				return null;
			}
			if (this.running && !options.duringRun) throw new Error("the chat is busy");
			const fresh = await this._log.rawEntries();
			const prefixHeld = plan.shadowedIds.length <= fresh.length && plan.shadowedIds.every((id, index) => fresh[index]?.id === id);
			if (!prefixHeld) throw new Error("the conversation changed while it was being compacted — nothing was written; run it again");
			if (plan.shadowedTokens > 0 && Math.ceil(plan.summary.length / 4) >= plan.shadowedTokens) {
				throw new Error(`the summary did not shrink the conversation (${plan.shadowedTokens} tokens condensed into a longer summary) — nothing was written`);
			}
			await this._log.record(EVENTS.compactionSummary, {
				summary: plan.summary,
				throughEntryId: plan.throughEntryId,
				tailStartEntryId: plan.tailStartEntryId,
				shadowedIds: plan.shadowedIds,
				shadowed: plan.shadowed,
				shadowedTokens: plan.shadowedTokens,
				retainedTokens: plan.retainedTokens,
				tier: plan.tier,
				timestamp: Date.now(),
			});
			this._usedTokens = null;
			this._compacted = true;
			const loop = await this.open();
			loop.restore(this._contextWithoutEcho(await this._log.transcript()));
			await loop.refreshContext();
			await this._log.record(EVENTS.compactionEnd, { timestamp: Date.now() });
			locked = false;
			return { shadowed: plan.shadowed };
		} catch (error) {
			if (locked) await this._log.record(EVENTS.compactionEnd, { error: error instanceof Error ? error.message : String(error), timestamp: Date.now() }).catch(() => undefined);
			throw error;
		} finally {
			this._setCompacting(false);
		}
	}

	private _setCompacting(value: boolean): void {
		if (this._compacting === value) return;
		this._compacting = value;
		this._compactingEmitter.fire(value);
	}

	async open(): Promise<AgentLoopService> {
		if (this._loop) return this._loop;
		this._opening ??= this._openLoop().catch((error: unknown) => {
			this._opening = null;
			throw error;
		});
		return this._opening;
	}

	private async _openLoop(): Promise<AgentLoopService> {
		await mkdir(join(this.root, "storage"), { recursive: true });
		await this._log.open();
		if ((await this._log.openCompaction()) !== null) {
			await this._log.record(EVENTS.compactionEnd, { error: "abandoned", timestamp: Date.now() }).catch(() => undefined);
		}

		const loop = new AgentLoopService(this._deps.modelsService, this._deps.toolService, this._deps.hookService, this);
		this._applyModel(loop, await this._modelOf());
		await this._applyPrompt(loop);
		this._loop = loop;
		this._disposables.add(loop);
		this._disposables.add(loop.events((event) => this._loopEmitter.fire(event)));
		this._disposables.add(this._record(loop));

		const resumed = await this._log.tailTranscript();
		if (resumed.length > 0) loop.restore(resumed);
		return loop;
	}

	async run(text: string): Promise<void> {
		await this.send(text);
	}

	async send(text: string, images: readonly PromptImage[] = []): Promise<void> {
		if (images.length > 0) await this._requireImageModel();
		const refs = await this.images.admit(images);
		const timestamp = Date.now();
		if (refs.length === 0) {
			await this._submit({ role: "user", content: text, timestamp } as AgentMessage);
			return;
		}
		const tail = text === "" ? [] : [{ type: "text" as const, text }];
		const durable = {
			role: "user",
			content: [...refs.map((attachment) => ({ type: "image" as const, attachment })), ...tail],
			timestamp,
		} as AgentMessage;
		const wire = {
			role: "user",
			content: [...images.map((image) => ({ type: "image" as const, data: encodeImageBytes(image.data), mimeType: image.mediaType })), ...tail],
			timestamp,
		} as AgentMessage;
		await this._submit(durable, wire);
	}

	async imageRef(id: string): Promise<ImageRef | undefined> {
		const entries = await this._log.rawEntries();
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index]!;
			if (entry.type !== "message") continue;
			const content = (entry.message as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const candidate = block as { type?: unknown; attachment?: ImageRef };
				const ref = candidate.type === "image" ? candidate.attachment : undefined;
				if (ref?.attachmentId === id) return ref;
			}
		}
		return undefined;
	}

	abort(): boolean {
		if (!this._loop?.isRunning()) return false;
		this._loop.stop();
		return true;
	}

	pending(): readonly PendingMessage[] {
		return this._loop?.pending() ?? [];
	}

	cancelPending(id: string): boolean {
		return this._loop?.cancelPending(id) ?? false;
	}

	convertPending(id: string, kind: PendingKind): boolean {
		return this._loop?.convertPending(id, kind) ?? false;
	}

	private _isPreLogged(message: AgentMessage): boolean {
		for (const candidate of this._preLogged) {
			if (candidate === message || echoed(candidate, message)) return true;
		}
		return false;
	}

	private _takePreLogged(message: AgentMessage): boolean {
		for (const candidate of this._preLogged) {
			if (candidate !== message && !echoed(candidate, message)) continue;
			this._preLogged.delete(candidate);
			return true;
		}
		return false;
	}

	private _contextWithoutEcho(messages: readonly AgentMessage[]): AgentMessage[] {
		const last = messages.at(-1);
		if (this._preLogged.size === 0 || last === undefined || last.role !== "user") return [...messages];
		return this._isPreLogged(last) ? messages.slice(0, -1) : [...messages];
	}

	private _record(loop: AgentLoopService): { dispose(): void } {
		const record = (type: string, data: Record<string, unknown>) => void this._log.record(type, data);
		return loop.events((event) => {
			const timestamp = Date.now();
			switch (event.type) {
				case "message_update":
					return;
				case "message_end": {
					const message = event.message;
					if (message.role === "assistant" && message.usage) {
						const usage = message.usage;
						this._usedTokens = usage.input + usage.cacheRead + usage.cacheWrite;
						this._compacted = false;
					}
					if (message.role === "toolResult") {
						if (!this._suspended.has(message.toolCallId)) void this._recordToolResult(message);
						return;
					}
					if (message.role === "assistant" && message.stopReason === "aborted" && !saidAnything(message.content)) return;
					if (message.role === "user" && this._takePreLogged(message)) return;
					void this._log.append(message);
					return;
				}
				case "run_start":
					this._error = null;
					this._errorAt = 0;
					record(EVENTS.agentStart, { run: event.run, timestamp });
					return;
				case "run_end": {
					this._preLogged.clear();
					const reason = event.stopped ? "aborted" : event.error ? "error" : "completed";
					if (reason !== "error") this._overflowCompactions = 0;
					record(EVENTS.agentEnd, { run: event.run, reason, ...(reason === "error" && event.error ? { error: event.error } : {}), timestamp });
					return;
				}
				case "retry_scheduled":
					record(EVENTS.retryScheduled, {
						retryId: `${event.run}:${event.retry}`,
						run: event.run,
						turn: event.turn,
						retry: event.retry,
						maxRetries: event.maxRetries,
						delayMs: event.delayMs,
						error: event.error,
						timestamp,
					});
					return;
				case "retry_started":
					record(EVENTS.retryStarted, { retryId: `${event.run}:${event.retry}`, run: event.run, turn: event.turn, retry: event.retry, timestamp });
					return;
				case "reminder":
					record(event.reminder.type, { ...event.reminder.data, timestamp });
					return;
				case "turn_start":
					record(EVENTS.turnStart, { run: event.run, turn: event.turn, timestamp });
					{
						const header = this._requestHeader();
						if (header) record(EVENTS.requestHeader, header);
					}
					return;
				case "turn_end":
					record(EVENTS.turnEnd, { run: event.run, turn: event.turn, timestamp });
					return;
				case "tool_start":
					record(EVENTS.toolCall, { callId: event.toolCallId, name: event.toolName, args: event.args, run: event.run, turn: event.turn, timestamp });
					return;
				case "tool_end":
					return;
			}
		});
	}

	// ——— edits ———

	async workspace(): Promise<WorkspaceFacts | null> {
		return this._workspaceOf();
	}

	async sandbox(): Promise<SandboxConfig> {
		return sandboxOf(this.root);
	}

	async setSandbox(mode: string): Promise<void> {
		await writeSandbox(this.root, mode);
	}

	async setWorkspace(path: string | null): Promise<void> {
		if (path === null) {
			await writeWorkspace(this.root, null);
			this._workspace = undefined;
			return;
		}
		const target = resolve(path);
		const info = await stat(target).catch(() => null);
		if (info === null || !info.isDirectory()) throw new Error(`workspace is not a directory: ${target}`);
		await writeWorkspace(this.root, target);
		this._workspace = undefined;
	}

	async profile(): Promise<SessionProfile | null> {
		return this._profileOf();
	}

	invalidate(): void {
		this._log.invalidate();
		this._profile = undefined;
		this._readAt = undefined;
		this._workspace = undefined;
		this._model = undefined;
		this._usedTokens = undefined;
	}

	async forking(): Promise<boolean> {
		return (await forkingOf(this.root)) !== null;
	}

	async forkInto(target: string): Promise<void> {
		await this._log.forkInto(target);
	}

	async promote(): Promise<void> {
		const profile = (await this._profileOf()) ?? { name: this.name, createdAt: Date.now() };
		if (profile.forkedFrom === undefined) throw new Error(`"${this.name}" is already a root chat`);
		const next = { ...profile };
		delete next.forkedFrom;
		await writeProfile(this.root, next);
		this._profile = next;
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

	async contextUsage(): Promise<{
		used: number;
		window: number;
		percent: number;
		breakdown: ContextBreakdown | null;
	} | null> {
		const window = await this._contextWindow();
		if (!window) return null;

		const tools = await this._deps.toolService.tools(this);
		const prompt = this.systemPrompt();
		const fixed = priceMessages(prompt, tools, []);
		const used = await this._contextTokens();
		if (used === null) {
			const breakdown = priceMessages(prompt, tools, await this._log.transcript());
			const estimated = totalTokens(breakdown);
			return { used: estimated, window, percent: estimated === 0 ? 0 : Math.min(100, Math.round((estimated / window) * 100)), breakdown };
		}
		const breakdown = { ...fixed, messageTokens: Math.max(0, used - fixed.systemTokens - fixed.toolsTokens) };
		return { used, window, percent: used === 0 ? 0 : Math.min(100, Math.round((used / window) * 100)), breakdown };
	}

	async markRead(readAt: number): Promise<void> {
		await writeReadAt(this.root, readAt);
		this._readAt = readAt;
	}

	// ——— lifecycle ———

	async close(): Promise<void> {
		this._loop?.stop();
		await this._log.flush();
		this._disposables.dispose();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	// ——— the files behind the row ———

	private async _contextWindow(): Promise<number | null> {
		if (this._loop) return this._loop.modelContextWindow();
		return (await this._resolvedModel())?.contextWindow ?? null;
	}

	private async _requireImageModel(): Promise<void> {
		const model = this._deps.modelsService.resolve((await this._modelOf()) ?? undefined);
		if (!model.input.includes("image")) throw new Error(`Model "${model.id}" does not accept image input; pick a vision model first.`);
	}

	private async _resolvedModel(): Promise<Model<Api> | null> {
		try {
			return this._deps.modelsService.resolve((await this._modelOf()) ?? undefined);
		} catch {
			return null;
		}
	}

	private async _contextTokens(): Promise<number | null> {
		if (this._compacted) return null;
		if (this._usedTokens !== undefined) return this._usedTokens;
		this._usedTokens = await this._log.lastUsageTokens();
		return this._usedTokens;
	}

	private async _modelOf(): Promise<SessionModel | null> {
		if (this._model === undefined) this._model = await modelOf(this.root);
		return this._model;
	}

	systemPrompt(): string {
		return this._loop?.systemPrompt() ?? this._prompt;
	}

	private async _applyPrompt(loop: AgentLoopService): Promise<void> {
		const prompt = await this._deps.promptService.compose(this);
		this._prompt = prompt;
		loop.setSystemPrompt(prompt);
		if (!(await promptChangedSinceLastPersist(this.root, prompt))) return;
		await this._log.record(EVENTS.systemPrompt, { text: prompt, timestamp: Date.now() });
		await recordPrompt(this.root, prompt);
	}

	private _recordToolResult(message: ToolResult): Promise<string | undefined> {
		return this._log.record(EVENTS.toolResult, {
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: message.content,
			...(message.details === undefined ? {} : { details: message.details }),
			...(message.usage === undefined ? {} : { usage: message.usage }),
			isError: message.isError === true,
			timestamp: Date.now(),
		});
	}

	private _requestHeader(): Record<string, unknown> | null {
		const prompt = this.systemPrompt();
		const tools = (this._loop?.tools() ?? []).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
		const signature = `${prompt}\u0000${tools.map((tool) => `${tool.name}\u0000${tool.description ?? ""}`).join("\u0001")}`;
		if (signature === this._headerSignature) return null;
		this._headerSignature = signature;
		return { systemPrompt: prompt, toolNames: tools.map((tool) => tool.name), tools, timestamp: Date.now() };
	}

	private _applyModel(loop: AgentLoopService, model: SessionModel | null): string | null {
		try {
			loop.setModel(this._deps.modelsService.resolve(model ?? undefined));
			loop.setThinkingLevel((model?.thinkingLevel ?? DEFAULT_THINKING_LEVEL) as ModelThinkingLevel);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
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
		const peek = await this._log.peek();
		const last = lastVisible(peek.tail) ?? (await this._lastVisible());
		return { ...(peek.createdAt ? { startedAt: peek.createdAt } : {}), last };
	}

	private async _lastVisible(): Promise<LastVisible | null> {
		return lastVisible((await this._log.peek(DEEP_TAIL_BYTES)).tail);
	}
}
