import { open, readdir, rm, stat, utimes, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AgentMessage, Entry, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { Emitter, type Event } from "@milu/di";
import type { SeqEntry } from "@milu/protocol";

import type { ExecutionService } from "../services/execution.ts";
import { EVENTS } from "./events.ts";
import { forkingOf } from "./files.ts";
import { originWindow, projectOrigin, projectTail, tailWindow, type OriginWindow } from "./origin.ts";
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
const SCAN_CHUNK = 1024 * 1024;
const SCAN_CAP = 32 * 1024 * 1024;
const HEADER_BYTES = 8 * 1024;
const RESUME_BYTES = 4 * 1024 * 1024;

function parseEntry(line: string): Entry | null {
	if (line === "") return null;
	try {
		const record = JSON.parse(line) as { kind?: unknown };
		return record.kind === "entry" ? (record as Entry) : null;
	} catch {
		return null;
	}
}

async function scanTail(path: string, visit: (fresh: readonly Entry[], whole: boolean) => boolean, cap = SCAN_CAP): Promise<{ whole: boolean }> {
	const handle = await open(path, "r");
	try {
		const { size } = await handle.stat();
		let deferred = Buffer.alloc(0);
		let read = 0;
		while (read < size && read < cap) {
			const length = Math.min(SCAN_CHUNK, size - read, cap - read);
			if (length <= 0) break;
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, size - read - length);
			read += length;
			const combined = Buffer.concat([buffer, deferred]);
			const fresh: Entry[] = [];
			let end = combined.length;
			for (;;) {
				const start = combined.lastIndexOf(0x0a, end - 1);
				if (start < 0) break;
				const entry = parseEntry(combined.subarray(start + 1, end).toString("utf8"));
				if (entry !== null) fresh.push(entry);
				end = start;
			}
			deferred = combined.subarray(0, end);
			if (visit(fresh, read >= size)) return { whole: read >= size };
		}
		const whole = read >= size;
		if (whole) {
			const first = parseEntry(deferred.toString("utf8"));
			if (first !== null) visit([first], true);
		}
		return { whole };
	} finally {
		await handle.close();
	}
}

export async function scanBack(path: string, keep: (newestFirst: readonly Entry[], whole: boolean) => boolean): Promise<{ entries: Entry[]; whole: boolean }> {
	const entries: Entry[] = [];
	const result = await scanTail(path, (fresh, whole) => {
		entries.push(...fresh);
		return keep(entries, whole);
	});
	return { entries, whole: result.whole };
}

export async function readEntries(path: string, keep: (entry: Entry) => boolean = () => true): Promise<Entry[]> {
	const handle = await open(path, "r");
	try {
		const out: Entry[] = [];
		const chunk = Buffer.alloc(SCAN_CHUNK);
		let carry = Buffer.alloc(0);
		for (;;) {
			const { bytesRead } = await handle.read(chunk, 0, SCAN_CHUNK, null);
			if (bytesRead === 0) break;
			const combined = carry.length === 0 ? chunk.subarray(0, bytesRead) : Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
			let start = 0;
			for (;;) {
				const end = combined.indexOf(0x0a, start);
				if (end < 0) break;
				const entry = parseEntry(combined.subarray(start, end).toString("utf8"));
				if (entry !== null && keep(entry)) out.push(entry);
				start = end + 1;
			}
			carry = Buffer.from(combined.subarray(start));
		}
		if (carry.length > 0) {
			const entry = parseEntry(carry.toString("utf8"));
			if (entry !== null && keep(entry)) out.push(entry);
		}
		return out;
	} finally {
		await handle.close();
	}
}

async function readHeader(path: string): Promise<{ kind?: string; version?: number; id?: string; createdAt?: number; cwd?: string } | null> {
	let handle: FileHandle | null = null;
	try {
		handle = await open(path, "r");
		const buffer = Buffer.alloc(HEADER_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
		const line = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
		const parsed = JSON.parse(line) as { kind?: unknown; version?: unknown; id?: unknown; createdAt?: unknown; cwd?: unknown };
		return {
			...(typeof parsed.kind === "string" ? { kind: parsed.kind } : {}),
			...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
			...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
			...(typeof parsed.createdAt === "number" ? { createdAt: parsed.createdAt } : {}),
			...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
		};
	} catch {
		return null;
	} finally {
		await handle?.close();
	}
}

function isSessionHeader(header: Awaited<ReturnType<typeof readHeader>>): header is { kind: "header"; version: number; id: string; createdAt?: number; cwd?: string } {
	return header?.kind === "header" && header.version === 4 && typeof header.id === "string";
}

async function newestLog(root: string): Promise<string | null> {
	const candidates: { path: string; at: number }[] = [];
	const consider = async (path: string): Promise<void> => {
		if (!path.endsWith(".jsonl")) return;
		const info = await stat(path).catch(() => null);
		if (info === null || !info.isFile()) return;
		candidates.push({ path, at: info.mtimeMs });
	};
	for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		const path = join(root, entry.name);
		if (entry.isFile()) {
			await consider(path);
			continue;
		}
		if (!entry.isDirectory()) continue;
		for (const inner of await readdir(path, { withFileTypes: true }).catch(() => [])) {
			if (inner.isFile()) await consider(join(path, inner.name));
		}
	}
	candidates.sort((left, right) => right.at - left.at);
	for (const candidate of candidates) {
		if (isSessionHeader(await readHeader(candidate.path))) return candidate.path;
	}
	return null;
}

export class SessionLog {
	readonly onEntry: Event<SeqEntry>;

	private _session: Session<JsonlSessionMetadata> | null = null;
	private _opening: Promise<Session<JsonlSessionMetadata>> | null = null;
	private _queue: Promise<void> = Promise.resolve();
	private _disposed = false;
	private _latestMeta: JsonlSessionMetadata | null | undefined;
	private _latestPathCache: string | null | undefined;
	private readonly _emitter = new Emitter<SeqEntry>();

	constructor(
		private readonly _executionService: ExecutionService,
		readonly root: string,
	) {
		this.onEntry = this._emitter.event;
	}

	async open(): Promise<void> {
		if (this._disposed || this._session) return;
		if ((await forkingOf(this.root)) !== null) throw new Error("this chat is still being forked");
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
		const path = await this._latestPath();
		const header = path === null ? null : await readHeader(path);
		if (path !== null && isSessionHeader(header)) {
			return repo.open({ id: header.id, path, createdAt: header.createdAt ?? 0, cwd: header.cwd ?? this.root, modifiedAt: 0, sourceFormat: 4 });
		}
		const latest = await this._latest();
		if (latest) return repo.open(latest);
		this._latestMeta = undefined;
		this._latestPathCache = undefined;
		return repo.create({ cwd: this.root });
	}

	private async _latestPath(): Promise<string | null> {
		if (this._latestPathCache !== undefined) return this._latestPathCache;
		this._latestPathCache = (await newestLog(this.root)) ?? (await this._latest())?.path ?? null;
		return this._latestPathCache;
	}

	private async _latest(): Promise<JsonlSessionMetadata | null> {
		if (this._latestMeta !== undefined) return this._latestMeta;
		this._latestMeta = (await this._repo().list({ cwd: this.root }))[0] ?? null;
		return this._latestMeta;
	}

	async peek(bytes = TAIL_BYTES): Promise<{ createdAt?: number; tail: Entry[] }> {
		const path = await this._latestPath();
		if (path === null) return { tail: [] };
		const [tail, header] = await Promise.all([this._readTail(path, bytes), readHeader(path)]);
		return { ...(header?.createdAt ? { createdAt: header.createdAt } : {}), tail: tail?.entries ?? [] };
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

	invalidate(): void {
		this._session = null;
		this._latestMeta = undefined;
		this._latestPathCache = undefined;
	}

	async forkInto(targetRoot: string): Promise<void> {
		await this.open();
		const current = await this._latestPath();
		const sessions = await this._repo().list({ cwd: this.root });
		for (const source of sessions) {
			await rm(join(targetRoot, basename(dirname(source.path))), { recursive: true, force: true });
			await rm(join(targetRoot, basename(source.path)), { force: true });
		}
		const fs = this._executionService.env(dirname(targetRoot));
		const target = new JsonlSessionRepo({ fs, sessionsRoot: targetRoot });
		let forked = "";
		for (const source of sessions) {
			const created = await target.fork(source, { scope: "tree", cwd: targetRoot });
			if (current !== null && source.path === current) forked = ((await created.getMetadata()) as { path?: string }).path ?? "";
		}
		if (forked !== "") await utimes(forked, new Date(), new Date(Date.now() + 1000));
	}

	async reset(): Promise<void> {
		if (this._disposed) return;
		await this.open();
		await this._queue;
		if (this._disposed) return;
		this._latestMeta = undefined;
		this._latestPathCache = undefined;
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
		if (this._session) {
			const listed = await this._sessionOrThrow().findEntries({ type: "custom", customType });
			return listed.map((entry) => ({ seq: entry.seq, entry })).sort((left, right) => left.seq - right.seq);
		}
		await this.flush();
		const path = await this._latestPath();
		if (path === null) return [];
		const entries = await readEntries(path, (entry) => entry.type === "custom" && entry.customType === customType);
		return entries.map((entry) => ({ seq: entry.seq, entry })).sort((left, right) => left.seq - right.seq);
	}

	async rawEntries(): Promise<Entry[]> {
		await this.flush();
		const path = await this._latestPath();
		if (path === null) return [];
		let header = false;
		return readEntries(path, (entry) => {
			if (!(entry.type === "custom" && entry.customType === EVENTS.requestHeader)) return true;
			if (header) return false;
			header = true;
			return true;
		});
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
		const path = await this._latestPath();
		if (path === null) return { entries: [], total: 0, hasMore: false, reset: false };
		const pick = (newestFirst: readonly Entry[], whole: boolean): OriginWindow | null => {
			const entries = [...newestFirst].reverse();
			if (options.mode === undefined && options.cursor === undefined) return tailWindow(entries, options.conversations, whole);
			if (options.cursor !== undefined && !entries.some((entry) => entry.id === options.cursor)) return null;
			return originWindow(whole ? projectOrigin(entries) : projectTail(entries), options);
		};
		const scanned = await scanBack(path, (newestFirst, whole) => pick(newestFirst, whole) !== null);
		const found = pick(scanned.entries, scanned.whole);
		if (found !== null) return found;
		return { ...originWindow(projectTail([...scanned.entries].reverse()), { conversations: options.conversations }), hasMore: false };
	}

	async lastUsageTokens(): Promise<number | null> {
		const path = await this._latestPath();
		if (path === null) return null;
		let found: number | null = null;
		await scanTail(path, (fresh) => {
			for (const entry of fresh) {
				if (entry.type === "message" && entry.message.role === "assistant" && entry.message.usage) {
					const usage = entry.message.usage;
					found = usage.input + usage.cacheRead + usage.cacheWrite;
					return true;
				}
				if (entry.type === "custom" && entry.customType === EVENTS.compaction) return true;
			}
			return false;
		});
		return found;
	}

	async tailTranscript(): Promise<AgentMessage[]> {
		const path = await this._latestPath();
		if (path === null) return [];
		const newestFirst: Entry[] = [];
		await scanTail(
			path,
			(fresh) => {
				for (const entry of fresh) {
					newestFirst.push(entry);
					if (entry.type === "custom" && entry.customType === EVENTS.compaction) return true;
				}
				return false;
			},
			RESUME_BYTES,
		);
		const sliced = projectSlice([...newestFirst].reverse());
		const firstUser = sliced.findIndex((message) => message.role === "user");
		return firstUser < 0 ? [] : sliced.slice(firstUser);
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
