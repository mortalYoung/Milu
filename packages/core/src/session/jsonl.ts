import { randomUUID } from "node:crypto";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry } from "@milu/protocol";

import type { FileSystem } from "../execution/types.ts";
import { getOrThrow } from "../tools/result.ts";

export interface JsonlSessionMetadata {
	readonly id: string;
	readonly createdAt: number;
	readonly cwd: string;
	readonly path: string;
	readonly modifiedAt: number;
	readonly sourceFormat: 4;
	readonly parentSessionId?: string;
}

export interface JsonlSessionRepoOptions {
	readonly fs: FileSystem;
	readonly sessionsRoot: string;
}

export interface JsonlSessionCreateOptions {
	readonly cwd: string;
	readonly id?: string;
	readonly parentSessionId?: string;
}

export interface JsonlSessionForkOptions {
	readonly scope: "tree";
	readonly cwd: string;
}

export interface JsonlSessionQuery {
	readonly type?: string;
	readonly customType?: string;
}

export interface LanePointer {
	readonly lane: string;
	readonly leafId: string | null;
}

interface SessionHeader {
	readonly kind: "header";
	readonly version: 4;
	readonly id: string;
	readonly createdAt: number;
	readonly cwd: string;
	readonly parentSessionId?: string;
}

interface LoadedSession {
	readonly header: SessionHeader;
	readonly entries: Entry[];
	readonly lanes: Map<string, string | null>;
}

function sessionDirectoryName(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function sessionFileName(createdAt: number, id: string): string {
	return `${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`;
}

function headerOf(fields: { readonly id: string; readonly createdAt: number; readonly cwd: string; readonly parentSessionId?: string }): SessionHeader {
	return {
		kind: "header",
		version: 4,
		id: fields.id,
		createdAt: fields.createdAt,
		cwd: fields.cwd,
		...(fields.parentSessionId === undefined ? {} : { parentSessionId: fields.parentSessionId }),
	};
}

function parseSession(content: string, path: string): LoadedSession {
	const lines = content.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	if (lines.length === 0 || lines[0] === "") throw new Error(`session ${path} is missing a header`);
	const header = JSON.parse(lines[0]) as SessionHeader;
	if (header.kind !== "header" || header.version !== 4) throw new Error(`session ${path} has an unsupported header`);
	const entries: Entry[] = [];
	const lanes = new Map<string, string | null>([["main", null]]);
	for (let index = 1; index < lines.length; index++) {
		const line = lines[index];
		if (line === "") continue;
		const record = JSON.parse(line) as Record<string, unknown>;
		if (record["kind"] === "entry") {
			const entry = { ...record };
			delete entry["kind"];
			const lane = entry["lane"];
			delete entry["lane"];
			entries.push(entry as unknown as Entry);
			if (typeof lane === "string") lanes.set(lane, String(entry["id"]));
			continue;
		}
		if (record["kind"] === "lane" && typeof record["lane"] === "string") lanes.set(record["lane"], typeof record["leafId"] === "string" ? record["leafId"] : null);
	}
	return { header, entries, lanes };
}

function metadataOf(header: SessionHeader, path: string, modifiedAt: number, parentSessionId?: string): JsonlSessionMetadata {
	return {
		id: header.id,
		createdAt: header.createdAt,
		cwd: header.cwd,
		path,
		modifiedAt,
		sourceFormat: 4,
		...(parentSessionId === undefined ? {} : { parentSessionId }),
	};
}

function matches(entry: Entry, query: JsonlSessionQuery): boolean {
	if (query.type !== undefined && entry.type !== query.type) return false;
	if (query.customType !== undefined && (entry.type !== "custom" || entry.customType !== query.customType)) return false;
	return true;
}

export class JsonlSession {
	private _seq: number;
	private _tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly _fs: FileSystem,
		readonly metadata: JsonlSessionMetadata,
		private readonly _entries: Entry[],
		private readonly _lanes: Map<string, string | null>,
	) {
		this._seq = _entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
	}

	async getMetadata(): Promise<JsonlSessionMetadata> {
		return this.metadata;
	}

	async getLanes(): Promise<LanePointer[]> {
		return [...this._lanes].map(([lane, leafId]) => ({ lane, leafId }));
	}

	async getEntry(id: string): Promise<Entry | undefined> {
		const entry = this._entries.find((candidate) => candidate.id === id);
		return entry === undefined ? undefined : structuredClone(entry);
	}

	async findEntries(query: JsonlSessionQuery = {}): Promise<Entry[]> {
		return this._entries.filter((entry) => matches(entry, query)).map((entry) => structuredClone(entry));
	}

	appendMessage(message: AgentMessage): Promise<string> {
		return this._append({ type: "message", id: randomUUID(), message: structuredClone(message) });
	}

	appendCustomEntry(customType: string, data?: unknown): Promise<string> {
		return this._append({ type: "custom", id: randomUUID(), customType, ...(data === undefined ? {} : { data }) });
	}

	private _append(payload: Record<string, unknown>): Promise<string> {
		const result = this._tail.then(async () => {
			const entry: Record<string, unknown> = { ...payload, parentId: this._lanes.get("main") ?? null, seq: this._seq + 1, timestamp: Date.now() };
			getOrThrow(await this._fs.appendFile(this.metadata.path, `${JSON.stringify({ kind: "entry", lane: "main", ...entry })}\n`));
			this._seq = this._seq + 1;
			this._entries.push(entry as unknown as Entry);
			this._lanes.set("main", String(entry["id"]));
			return String(entry["id"]);
		});
		this._tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

export class JsonlSessionRepo {
	constructor(private readonly _options: JsonlSessionRepoOptions) {}

	async create(options: JsonlSessionCreateOptions): Promise<JsonlSession> {
		const cwd = getOrThrow(await this._options.fs.absolutePath(options.cwd));
		const id = options.id ?? randomUUID();
		const createdAt = Date.now();
		const path = await this._pathFor(cwd, createdAt, id);
		const header = headerOf({ id, createdAt, cwd, ...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }) });
		getOrThrow(await this._options.fs.writeFile(path, `${JSON.stringify(header)}\n`));
		const info = getOrThrow(await this._options.fs.fileInfo(path));
		return new JsonlSession(this._options.fs, metadataOf(header, path, info.mtimeMs, options.parentSessionId), [], new Map([["main", null]]));
	}

	async open(metadata: JsonlSessionMetadata): Promise<JsonlSession> {
		const loaded = parseSession(getOrThrow(await this._options.fs.readTextFile(metadata.path)), metadata.path);
		if (loaded.header.id !== metadata.id) throw new Error(`session id does not match header: ${metadata.id}`);
		return new JsonlSession(this._options.fs, metadata, loaded.entries, loaded.lanes);
	}

	async list(options: { readonly cwd?: string } = {}): Promise<JsonlSessionMetadata[]> {
		const sessions: JsonlSessionMetadata[] = [];
		for (const directory of await this._directories(options.cwd)) {
			for (const file of getOrThrow(await this._options.fs.listDir(directory))) {
				if (file.kind === "directory" || !file.name.endsWith(".jsonl")) continue;
				const firstLine = getOrThrow(await this._options.fs.readTextFile(file.path)).split("\n", 1)[0] ?? "";
				if (firstLine === "") continue;
				const header = JSON.parse(firstLine) as SessionHeader;
				if (header.kind !== "header" || header.version !== 4) continue;
				sessions.push(metadataOf(header, file.path, file.mtimeMs, header.parentSessionId));
			}
		}
		return sessions.sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	async fork(source: JsonlSessionMetadata, options: JsonlSessionForkOptions): Promise<JsonlSession> {
		const from = await this.open(source);
		const cwd = getOrThrow(await this._options.fs.absolutePath(options.cwd));
		const id = randomUUID();
		const createdAt = Date.now();
		const path = await this._pathFor(cwd, createdAt, id);
		const header = headerOf({ id, createdAt, cwd, parentSessionId: source.id });
		const entries = await from.findEntries();
		let content = `${JSON.stringify(header)}\n`;
		for (let index = 0; index < entries.length; index++) content += `${JSON.stringify({ kind: "entry", ...entries[index], seq: index + 1 })}\n`;
		for (const pointer of await from.getLanes()) content += `${JSON.stringify({ kind: "lane", seq: entries.length + 1, lane: pointer.lane, leafId: pointer.leafId })}\n`;
		getOrThrow(await this._options.fs.writeFile(path, content));
		const info = getOrThrow(await this._options.fs.fileInfo(path));
		const loaded = parseSession(content, path);
		return new JsonlSession(this._options.fs, metadataOf(header, path, info.mtimeMs, source.id), loaded.entries, loaded.lanes);
	}

	private async _pathFor(cwd: string, createdAt: number, id: string): Promise<string> {
		const root = getOrThrow(await this._options.fs.absolutePath(this._options.sessionsRoot));
		const directory = getOrThrow(await this._options.fs.joinPath([root, sessionDirectoryName(cwd)]));
		getOrThrow(await this._options.fs.createDir(directory, { recursive: true }));
		return getOrThrow(await this._options.fs.joinPath([directory, sessionFileName(createdAt, id)]));
	}

	private async _directories(cwd?: string): Promise<string[]> {
		const root = getOrThrow(await this._options.fs.absolutePath(this._options.sessionsRoot));
		if (cwd !== undefined) {
			const resolved = getOrThrow(await this._options.fs.absolutePath(cwd));
			const directory = getOrThrow(await this._options.fs.joinPath([root, sessionDirectoryName(resolved)]));
			return getOrThrow(await this._options.fs.exists(directory)) ? [directory] : [];
		}
		if (!getOrThrow(await this._options.fs.exists(root))) return [];
		return getOrThrow(await this._options.fs.listDir(root))
			.filter((entry) => entry.kind === "directory" || entry.kind === "symlink")
			.map((entry) => entry.path);
	}
}
