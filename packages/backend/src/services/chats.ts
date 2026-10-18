import { join } from "node:path";

import { JsonlSessionRepo, type Entry } from "@earendil-works/pi-agent-core";
import { Container, createServiceId, DisposableStore, Emitter, type Event, type Service } from "@milu/di";
import type { ChatPreviewKind, ChatRow, SeqEntry } from "@milu/protocol";

import type { Extension } from "../extensions/types.ts";
import { AgentLoopService, AgentLoopServiceId, type AgentLoopEvent } from "./agent-loop.ts";
import { ConfigServiceId } from "./config.ts";
import { ContributionServiceId } from "./contributions.ts";
import { ExecutionService, ExecutionServiceId } from "./execution.ts";
import { ExtensionService, ExtensionServiceId } from "./extensions.ts";
import { ModelsServiceId } from "./models.ts";
import { profileOf, readAtOf, tildify, workspaceOf, writeReadAt } from "./partners.ts";
import { SessionService, SessionServiceId, type ChatContext } from "./sessions.ts";
import { expandHome, type SettingsService } from "./settings.ts";
import { ToolServiceId } from "./tools.ts";

/** One chat's own container: its session log, its agent loop, its extensions. */
export interface ChatScope {
	readonly chat: ChatContext;
	readonly container: Container;
	readonly sessions: SessionService;
	readonly loop: AgentLoopService;
}

export interface ChatEntry {
	readonly chat: string;
	readonly entry: SeqEntry;
}

export interface ChatLoopEvent {
	readonly chat: string;
	readonly event: AgentLoopEvent;
}

export interface ChatScopeDeps {
	extensions: readonly Extension[];
}

/** What v1 wrote into a chat's log when something other than a message happened. */
const SEND_MESSAGE = "send_message";
const COMMAND_RUN = "command/run";
const SKILL_RUN = "skill/run";
const SHELL_RUN = "shell/run";

interface LastVisible {
	text: string;
	kind: ChatPreviewKind;
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

/** The last thing a user would call "the last message": a message, or a command/skill/shell run. */
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

/**
 * Every chat the user has opened gets a child container of its own, so two chats run at once and
 * neither can see the other's session, loop, or extension state. Chats that were never opened cost
 * nothing: `list()` reads the disk, it does not open a scope.
 */
export class ChatScopeService implements Service {
	readonly onEntry: Event<ChatEntry>;
	readonly onLoopEvent: Event<ChatLoopEvent>;

	private _partnerRoot = "";
	private readonly _scopes = new Map<string, ChatScope>();
	private readonly _extensions: readonly Extension[];
	private readonly _entryEmitter = new Emitter<ChatEntry>();
	private readonly _loopEmitter = new Emitter<ChatLoopEvent>();

	constructor(
		private readonly _container: Container,
		private readonly _settingsService: SettingsService,
		private readonly _executionService: ExecutionService,
		deps: ChatScopeDeps,
	) {
		this.onEntry = this._entryEmitter.event;
		this.onLoopEvent = this._loopEmitter.event;
		this._extensions = deps.extensions;
	}

	async initialize(): Promise<void> {
		this._partnerRoot = expandHome(this._settingsService.get().partner_profile_path);
	}

	get partnerRoot(): string {
		return this._partnerRoot;
	}

	/** One row per partner directory, built from the partner's own files plus its newest session. */
	async list(): Promise<readonly ChatRow[]> {
		const rows: ChatRow[] = [];
		for (const name of await this._chatNames()) {
			const dir = join(this._partnerRoot, name);
			const profile = await profileOf(dir);
			const readAt = await readAtOf(dir);
			const workspace = await workspaceOf(dir);
			const { startedAt, last } = await this._factsOf(dir);
			rows.push({
				name,
				path: tildify(dir),
				storage: tildify(join(dir, "storage")),
				createdAt: profile?.createdAt ?? 0,
				...(profile?.persona ? { persona: profile.persona } : {}),
				...(profile?.forkedFrom ? { forkedFrom: profile.forkedFrom } : {}),
				...(profile?.pinned ? { pinned: true } : {}),
				...(startedAt ? { startedAt } : {}),
				...(readAt !== undefined ? { readAt } : {}),
				...(workspace ? { workspace: workspace.path, workspaceKind: workspace.kind, workspaceRepo: workspace.repo } : {}),
				...(last ? { lastMessage: last.text, lastMessageAt: last.time, lastMessageKind: last.kind } : {}),
				writing: this.get(name)?.loop.isRunning() ?? false,
			});
		}
		return rows.sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.name.localeCompare(right.name));
	}

	/** Remembers how far this chat has been read, in the partner's own `read.json`. */
	async markRead(name: string, readAt: number): Promise<void> {
		if (!(await this._chatNames()).includes(name)) throw new Error(`no chat named "${name}"`);
		await writeReadAt(join(this._partnerRoot, name), readAt);
	}

	get(name: string): ChatScope | undefined {
		return this._scopes.get(name);
	}

	/** Opens a chat on first use: builds its container, restores its transcript, then subscribes. */
	async ensure(name: string): Promise<ChatScope> {
		const existing = this._scopes.get(name);
		if (existing) return existing;

		const names = await this._chatNames();
		if (!names.includes(name)) throw new Error(`no chat named "${name}"`);

		const chat: ChatContext = { name, root: join(this._partnerRoot, name) };
		const container = this._container.createChild();
		container.register(SessionServiceId, (c) => new SessionService(c.get(ExecutionServiceId), chat));
		container.register(AgentLoopServiceId, (c) => new AgentLoopService(c.get(ModelsServiceId), c.get(ToolServiceId)));
		container.register(
			ExtensionServiceId,
			(c) => new ExtensionService(c.get(AgentLoopServiceId), c.get(ContributionServiceId), c.get(SessionServiceId), c.get(ConfigServiceId), { extensions: this._extensions }),
		);
		await container.initialize();

		const scope: ChatScope = {
			chat,
			container,
			sessions: container.get(SessionServiceId),
			loop: container.get(AgentLoopServiceId),
		};
		this._scopes.set(name, scope);

		const subscriptions = new DisposableStore();
		subscriptions.add(scope.sessions.onEntry((entry) => this._entryEmitter.fire({ chat: name, entry })));
		subscriptions.add(scope.loop.events((event) => this._loopEmitter.fire({ chat: name, event })));
		container.own(subscriptions);
		return scope;
	}

	/** Dispose first so nothing new is written, then drain what was already queued. */
	async close(name: string): Promise<void> {
		const scope = this._scopes.get(name);
		if (!scope) return;
		this._scopes.delete(name);
		scope.container.dispose();
		await scope.sessions.flush();
	}

	/** Every open chat's queue — the second half of a graceful shutdown. */
	async flush(): Promise<void> {
		await Promise.all([...this._scopes.values()].map((scope) => scope.sessions.flush()));
	}

	dispose(): void {
		this._entryEmitter.dispose();
		this._loopEmitter.dispose();
		for (const scope of this._scopes.values()) scope.container.dispose();
	}

	private async _chatNames(): Promise<string[]> {
		const listed = await this._executionService.env(this._partnerRoot).listDir(".");
		if (!listed.ok) return [];
		return listed.value.filter((entry) => entry.kind === "directory").map((entry) => entry.name);
	}

	private async _factsOf(dir: string): Promise<{ startedAt?: number; last: LastVisible | null }> {
		const repo = new JsonlSessionRepo({ fs: this._executionService.env(dir), sessionsRoot: dir });
		const latest = (await repo.list({ cwd: dir }))[0];
		if (!latest) return { last: null };
		const session = await repo.open(latest);
		const entries = (await session.findEntries()).sort((left, right) => left.seq - right.seq);
		return { startedAt: latest.createdAt, last: lastVisible(entries) };
	}
}

export const ChatScopeServiceId = createServiceId<ChatScopeService>("ChatScopeService");
