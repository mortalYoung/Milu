import { open, type FileHandle } from "node:fs/promises";

import type { AgentMessage, Entry, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { Emitter, type Event } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { ExecutionService } from "../services/execution.ts";
import { originWindow, projectOrigin, tailWindow, type OriginWindow } from "./origin.ts";
import { projectSlice, projectSliceItems, type SliceItem } from "./slice.ts";
import { textOf } from "./text.ts";

function stripUndefined<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

function toRecord(message: AgentMessage): AgentMessage {
	if (message.role !== "user") return message;
	return { ...message, content: textOf(message.content) } as AgentMessage;
}

const TAIL_BYTES = 256 * 1024;
const WINDOW_TAIL_BYTES = 2 * 1024 * 1024;

export class SessionLog {
	readonly onEntry: Event<SeqEntry>;

	private _session: Session<JsonlSessionMetadata> | null = null;
	private _opening: Promise<Session<JsonlSessionMetadata>> | null = null;
	private _queue: Promise<void> = Promise.resolve();
	private _disposed = false;
	private readonly _emitter = new Emitter<SeqEntry>();

	constructor(
		private readonly _executionService: ExecutionService,
		readonly root: string,
	) {
		this.onEntry = this._emitter.event;
	}

	async open(): Promise<void> {
		if (this._disposed || this._session) return;
		this._opening ??= this._open();
		try {
			const opened = await this._opening;
			if (!this._disposed) this._session = opened;
		} finally {
			this._opening = null;
		}
	}

	private async _open(): Promise<Session<JsonlSessionMetadata>> {
		const repo = this._repo();
		const latest = await this._latest();
		return latest ? repo.open(latest) : repo.create({ cwd: this.root });
	}

	private async _latest(): Promise<JsonlSessionMetadata | null> {
		return (await this._repo().list({ cwd: this.root }))[0] ?? null;
	}

	/** The newest log's header and its last bytes — a preview without opening (and parsing) the whole file. */
	async peek(bytes = TAIL_BYTES): Promise<{ createdAt?: number; tail: Entry[] }> {
		const latest = await this._latest();
		if (latest === null) return { tail: [] };
		const tail = await this._readTail(latest.path, bytes);
		return { ...(latest.createdAt ? { createdAt: latest.createdAt } : {}), tail: tail?.entries ?? [] };
	}

	private async _readTail(path: string, bytes: number): Promise<{ entries: Entry[]; whole: boolean } | null> {
		let handle: FileHandle;
		try {
			handle = await open(path, "r");
		} catch {
			return null;
		}
		try {
			const { size } = await handle.stat();
			const length = Math.min(size, bytes);
			const whole = length === size;
			if (length === 0) return { entries: [], whole: true };
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, size - length);
			const lines = buffer.toString("utf8").split("\n");
			if (!whole) lines.shift();
			const entries: Entry[] = [];
			for (const line of lines) {
				if (line === "") continue;
				try {
					const record = JSON.parse(line) as { kind?: unknown };
					if (record.kind === "entry") entries.push(record as Entry);
				} catch {}
			}
			return { entries, whole };
		} finally {
			await handle.close();
		}
	}

	async reset(): Promise<void> {
		if (this._disposed) return;
		await this.open();
		await this._queue;
		if (this._disposed) return;
		this._session = await this._repo().create({ cwd: this.root });
	}

	async append(message: AgentMessage): Promise<string | undefined> {
		if (this._disposed) return undefined;
		return this._enqueue(async () => {
			await this.open();
			if (this._disposed) return undefined;
			return this._sessionOrThrow().appendMessage(stripUndefined(toRecord(message)));
		});
	}

	async record(type: string, data?: unknown): Promise<string | undefined> {
		if (this._disposed) return undefined;
		return this._enqueue(async () => {
			await this.open();
			if (this._disposed) return undefined;
			return this._sessionOrThrow().appendCustomEntry(type, data === undefined ? undefined : stripUndefined(data));
		});
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

	async sliceItems(options?: { keepDangling?: boolean }): Promise<SliceItem[]> {
		return projectSliceItems(await this.origin(), options);
	}

	async window(options: { mode?: "older" | "newer"; cursor?: string; conversations: number }): Promise<OriginWindow> {
		if (options.mode === undefined && options.cursor === undefined) {
			const fast = await this._tailWindow(options.conversations);
			if (fast !== null) return fast;
		}
		return originWindow(await this.origin(), options);
	}

	/** The first window is the newest conversations: read only the end of the log and grow until they fit. */
	private async _tailWindow(conversations: number): Promise<OriginWindow | null> {
		const latest = await this._latest();
		if (latest === null) return null;
		for (let bytes = WINDOW_TAIL_BYTES; ; bytes *= 2) {
			const tail = await this._readTail(latest.path, bytes);
			if (tail === null) return null;
			const window = tailWindow(tail.entries, conversations, tail.whole);
			if (window !== null) return window;
			if (tail.whole) return null;
		}
	}

	dispose(): void {
		this._disposed = true;
		this._session = null;
		this._opening = null;
		this._emitter.dispose();
	}

	private _repo(): JsonlSessionRepo {
		return new JsonlSessionRepo({ fs: this._executionService.env(this.root), sessionsRoot: this.root });
	}

	private _enqueue(run: () => Promise<string | undefined>): Promise<string | undefined> {
		const result = this._queue
			.then(async () => (this._disposed ? undefined : run()))
			.then(async (id) => {
				if (id === undefined || this._disposed) return id;
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
