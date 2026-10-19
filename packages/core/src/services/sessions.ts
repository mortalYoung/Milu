import { join } from "node:path";

import { createServiceId, DisposableStore, Emitter, type Event, type Service } from "@milu/di";
import type { SeqEntry, SessionRow } from "@milu/protocol";

import { Session } from "../session/session.ts";
import type { AgentLoopEvent } from "./agent-loop.ts";
import type { ExecutionService } from "./execution.ts";
import type { ModelsService } from "./models.ts";
import { expandHome, type SettingsService } from "./settings.ts";
import type { ToolService } from "./tools.ts";

export interface SessionEntry {
	readonly session: string;
	readonly entry: SeqEntry;
}

export interface SessionLoopEvent {
	readonly session: string;
	readonly event: AgentLoopEvent;
}

/**
 * Every session on disk, and the values this process holds for them. A session is created lazily
 * and cheaply — its log and its loop only come up when something opens it — so `list()` can
 * describe seventeen sessions without running any of them.
 */
export class SessionService implements Service {
	readonly onEntry: Event<SessionEntry>;
	readonly onLoopEvent: Event<SessionLoopEvent>;

	private _partnerRoot = "";
	private readonly _sessions = new Map<string, Session>();
	private readonly _relays = new Map<string, DisposableStore>();
	private readonly _entryEmitter = new Emitter<SessionEntry>();
	private readonly _loopEmitter = new Emitter<SessionLoopEvent>();

	constructor(
		private readonly _executionService: ExecutionService,
		private readonly _settingsService: SettingsService,
		private readonly _modelsService: ModelsService,
		private readonly _toolService: ToolService,
	) {
		this.onEntry = this._entryEmitter.event;
		this.onLoopEvent = this._loopEmitter.event;
	}

	async initialize(): Promise<void> {
		this._partnerRoot = expandHome(this._settingsService.get().partner_profile_path);
	}

	get partnerRoot(): string {
		return this._partnerRoot;
	}

	/** One row per session directory; a row costs the three small files plus its log's head. */
	async list(): Promise<readonly SessionRow[]> {
		const rows: SessionRow[] = [];
		for (const name of await this._names()) rows.push(await this.get(name).row());
		return rows.sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.name.localeCompare(right.name));
	}

	/** The session's value: no loop, no log until something opens it. */
	get(name: string): Session {
		const existing = this._sessions.get(name);
		if (existing) return existing;

		const session = new Session({
			name,
			root: join(this._partnerRoot, name),
			executionService: this._executionService,
			modelsService: this._modelsService,
			toolService: this._toolService,
		});
		this._sessions.set(name, session);

		const relays = new DisposableStore();
		relays.add(session.onEntry((entry) => this._entryEmitter.fire({ session: name, entry })));
		relays.add(session.onLoopEvent((event) => this._loopEmitter.fire({ session: name, event })));
		this._relays.set(name, relays);
		return session;
	}

	/** Same as `get`, but a name that is not on disk is an error rather than a session. */
	async ensure(name: string): Promise<Session> {
		if (!(await this._names()).includes(name)) throw new Error(`no session named "${name}"`);
		return this.get(name);
	}

	running(name: string): boolean {
		return this._sessions.get(name)?.running ?? false;
	}

	async pin(name: string, pinned: boolean): Promise<void> {
		await (await this.ensure(name)).pin(pinned);
	}

	async markRead(name: string, readAt: number): Promise<void> {
		await (await this.ensure(name)).markRead(readAt);
	}

	/** Every session disposes first, then drains — the second half of a graceful shutdown. */
	async shutdown(): Promise<void> {
		for (const session of this._sessions.values()) await session.close();
	}

	/** Closing a session disposes it first, keeps its files, and forgets its value. */
	async close(name: string): Promise<void> {
		const session = this._sessions.get(name);
		if (!session) return;
		this._sessions.delete(name);
		this._relays.get(name)?.dispose();
		this._relays.delete(name);
		await session.close();
	}

	dispose(): void {
		this._entryEmitter.dispose();
		this._loopEmitter.dispose();
		for (const relays of this._relays.values()) relays.dispose();
		for (const session of this._sessions.values()) session.dispose();
		this._sessions.clear();
		this._relays.clear();
	}

	private async _names(): Promise<string[]> {
		const listed = await this._executionService.env(this._partnerRoot).listDir(".");
		if (!listed.ok) return [];
		return listed.value.filter((entry) => entry.kind === "directory").map((entry) => entry.name);
	}
}

export const SessionServiceId = createServiceId<SessionService>("SessionService");
