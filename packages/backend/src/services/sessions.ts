import type { AgentMessage, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { ExecutionService } from "./execution.ts";

/** The identity of one chat: its name in the partner root, and the directory it lives in. */
export interface ChatContext {
	readonly name: string;
	readonly root: string;
}

/** pi's durable store rejects `undefined` anywhere in a payload; the round trip is its own shape. */
function stripUndefined<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

/** One chat's session log — the only state this service owns is the chat it was built for. */
export class SessionService implements Service {
	/** Fires for every entry that reached the disk, in write order. */
	readonly onEntry: Event<SeqEntry>;

	private _session: Session<JsonlSessionMetadata> | null = null;
	private _queue: Promise<void> = Promise.resolve();
	private readonly _emitter = new Emitter<SeqEntry>();

	constructor(
		private readonly _executionService: ExecutionService,
		readonly chat: ChatContext,
	) {
		this.onEntry = this._emitter.event;
	}

	async initialize(): Promise<void> {
		const repo = this._repo();
		const latest = (await repo.list({ cwd: this.chat.root }))[0];
		this._session = latest ? await repo.open(latest) : await repo.create({ cwd: this.chat.root });
	}

	append(message: AgentMessage): Promise<string | undefined> {
		return this._enqueue(() => this._sessionOrThrow().appendMessage(stripUndefined(message)));
	}

	record(type: string, data?: unknown): Promise<string | undefined> {
		return this._enqueue(() => this._sessionOrThrow().appendCustomEntry(type, data === undefined ? undefined : stripUndefined(data)));
	}

	/** Writes are queued; a caller that cares (shutdown, a probe) waits here. */
	async flush(): Promise<void> {
		await this._queue;
	}

	async entries(since = 0): Promise<SeqEntry[]> {
		const listed = await this._sessionOrThrow().findEntries();
		return listed
			.filter((entry) => entry.seq > since)
			.sort((left, right) => left.seq - right.seq)
			.map((entry) => ({ seq: entry.seq, entry }));
	}

	async transcript(): Promise<AgentMessage[]> {
		const entries = await this._sessionOrThrow().findEntries();
		return entries
			.filter((entry) => entry.type === "message")
			.sort((left, right) => left.seq - right.seq)
			.map((entry) => (entry as Extract<typeof entry, { type: "message" }>).message);
	}

	dispose(): void {
		// Pending writes keep draining against the session; flush() is how a caller waits for them.
		this._emitter.dispose();
	}

	private _repo(): JsonlSessionRepo {
		return new JsonlSessionRepo({ fs: this._executionService.env(this.chat.root), sessionsRoot: this.chat.root });
	}

	private _enqueue(run: () => Promise<string>): Promise<string | undefined> {
		const result = this._queue
			.then(run)
			.then(async (id) => {
				const entry = await this._sessionOrThrow()
					.getEntry(id)
					.catch(() => undefined);
				if (entry) this._emitter.fire({ seq: entry.seq, entry });
				return id;
			})
			.catch((error: unknown) => {
				console.error(`session ${this.chat.name}: write failed:`, error);
				return undefined;
			});
		this._queue = result.then(() => undefined);
		return result;
	}

	private _sessionOrThrow(): Session<JsonlSessionMetadata> {
		if (!this._session) throw new Error(`session for "${this.chat.name}" is not initialized`);
		return this._session;
	}
}

export const SessionServiceId = createServiceId<SessionService>("SessionService");
