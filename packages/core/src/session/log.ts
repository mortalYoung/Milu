import type { AgentMessage, Entry, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { Emitter, type Event } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { ExecutionService } from "../services/execution.ts";
import { originWindow, projectOrigin, type OriginWindow } from "./origin.ts";
import { projectSlice } from "./slice.ts";

function stripUndefined<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

export class SessionLog {
	readonly onEntry: Event<SeqEntry>;

	private _session: Session<JsonlSessionMetadata> | null = null;
	private _opening: Promise<Session<JsonlSessionMetadata>> | null = null;
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
		this._opening ??= this._open();
		try {
			this._session = await this._opening;
		} finally {
			this._opening = null;
		}
	}

	private async _open(): Promise<Session<JsonlSessionMetadata>> {
		const repo = this._repo();
		const latest = (await repo.list({ cwd: this.root }))[0];
		return latest ? repo.open(latest) : repo.create({ cwd: this.root });
	}

	async startedAt(): Promise<number | undefined> {
		await this.open();
		return (await this._sessionOrThrow().getMetadata()).createdAt;
	}

	async reset(): Promise<void> {
		await this.open();
		await this._queue;
		this._session = await this._repo().create({ cwd: this.root });
	}

	async append(message: AgentMessage): Promise<string | undefined> {
		await this.open();
		return this._enqueue(() => this._sessionOrThrow().appendMessage(stripUndefined(message)));
	}

	async record(type: string, data?: unknown): Promise<string | undefined> {
		await this.open();
		return this._enqueue(() => this._sessionOrThrow().appendCustomEntry(type, data === undefined ? undefined : stripUndefined(data)));
	}

	async flush(): Promise<void> {
		await this._queue;
	}

	async records(customType: string): Promise<SeqEntry[]> {
		await this.open();
		const listed = await this._sessionOrThrow().findEntries({ type: "custom", customType });
		return listed.map((entry) => ({ seq: entry.seq, entry })).sort((left, right) => left.seq - right.seq);
	}

	async entries(since = 0): Promise<SeqEntry[]> {
		await this.open();
		const listed = await this._sessionOrThrow().findEntries();
		return listed
			.filter((entry) => entry.seq > since)
			.sort((left, right) => left.seq - right.seq)
			.map((entry) => ({ seq: entry.seq, entry }));
	}

	async rawEntries(): Promise<Entry[]> {
		await this.open();
		const listed = await this._sessionOrThrow().findEntries();
		return [...listed].sort((left, right) => left.seq - right.seq);
	}

	async origin(): Promise<Entry[]> {
		return projectOrigin(await this.rawEntries());
	}

	async transcript(options?: { keepDangling?: boolean }): Promise<AgentMessage[]> {
		return projectSlice(await this.origin(), options);
	}

	async window(options: { mode?: "older" | "newer"; cursor?: string; conversations: number }): Promise<OriginWindow> {
		return originWindow(await this.origin(), options);
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
