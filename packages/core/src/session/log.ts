import type { AgentMessage, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { Emitter, type Event } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { ExecutionService } from "../services/execution.ts";

function stripUndefined<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

export class SessionLog {
	readonly onEntry: Event<SeqEntry>;

	private _session: Session<JsonlSessionMetadata> | null = null;
	private _queue: Promise<void> = Promise.resolve();
	private readonly _emitter = new Emitter<SeqEntry>();

	constructor(
		private readonly _executionService: ExecutionService,
		readonly root: string,
	) {
		this.onEntry = this._emitter.event;
	}

	async open(): Promise<void> {
		if (this._session) return;
		const repo = this._repo();
		const latest = (await repo.list({ cwd: this.root }))[0];
		this._session = latest ? await repo.open(latest) : await repo.create({ cwd: this.root });
	}

	async startedAt(): Promise<number | undefined> {
		await this.open();
		return (await this._sessionOrThrow().getMetadata()).createdAt;
	}

	append(message: AgentMessage): Promise<string | undefined> {
		return this._enqueue(() => this._sessionOrThrow().appendMessage(stripUndefined(message)));
	}

	record(type: string, data?: unknown): Promise<string | undefined> {
		return this._enqueue(() => this._sessionOrThrow().appendCustomEntry(type, data === undefined ? undefined : stripUndefined(data)));
	}

	async flush(): Promise<void> {
		await this._queue;
	}

	async entries(since = 0): Promise<SeqEntry[]> {
		await this.open();
		const listed = await this._sessionOrThrow().findEntries();
		return listed
			.filter((entry) => entry.seq > since)
			.sort((left, right) => left.seq - right.seq)
			.map((entry) => ({ seq: entry.seq, entry }));
	}

	async transcript(): Promise<AgentMessage[]> {
		await this.open();
		const entries = await this._sessionOrThrow().findEntries();
		return entries
			.filter((entry) => entry.type === "message")
			.sort((left, right) => left.seq - right.seq)
			.map((entry) => (entry as Extract<typeof entry, { type: "message" }>).message);
	}

	dispose(): void {
		this._emitter.dispose();
	}

	private _repo(): JsonlSessionRepo {
		return new JsonlSessionRepo({ fs: this._executionService.env(this.root), sessionsRoot: this.root });
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
				console.error(`log ${this.root}: write failed:`, error);
				return undefined;
			});
		this._queue = result.then(() => undefined);
		return result;
	}

	private _sessionOrThrow(): Session<JsonlSessionMetadata> {
		if (!this._session) throw new Error(`log ${this.root} is not open`);
		return this._session;
	}
}
