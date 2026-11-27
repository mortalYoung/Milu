import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import type { AgentLoopEvent, Backend, EscalationRequest, Session } from "@milu/core";
import { clearDriver, EVENTS, pendingEscalations, SessionLockedError, settleEscalation, writeDriver } from "@milu/core";
import type { ImageMediaType, PromptImage, SeqEntry } from "@milu/protocol";

import { ERROR, RpcError, type RpcServer } from "./rpc.ts";

const PROTOCOL_VERSION = 1;
const AGENT = { name: "milu", title: "Milu", version: "0.4.0" } as const;

type Mode = "read-only" | "workspace-write" | "danger-full-access";

const MODE_NAMES: Readonly<Record<Mode, string>> = {
	"read-only": "只读",
	"workspace-write": "工作区可写",
	"danger-full-access": "完全放开",
};

const MODES: readonly Mode[] = ["read-only", "workspace-write", "danger-full-access"];

const TOOL_KINDS: Readonly<Record<string, string>> = {
	read: "read",
	write: "edit",
	edit: "edit",
	bash: "execute",
	grep: "search",
	glob: "search",
	search: "search",
	fetch: "fetch",
	webfetch: "fetch",
};

interface LodyModelUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens?: number;
	costUSD?: number;
}

const LODY_SCHEDULE_TOOLS: Readonly<Record<string, string>> = {
	create: "CronCreate",
	list: "CronList",
	delete: "CronDelete",
	run: "ScheduleWakeup",
};

function lodyToolName(name: string, args: unknown): string | null {
	if (name !== "schedule" || !isRecord(args)) return null;
	const op = args["op"];
	return typeof op === "string" ? (LODY_SCHEDULE_TOOLS[op] ?? null) : null;
}

function lodyMeta(name: string, args: unknown): Record<string, unknown> | null {
	const toolName = lodyToolName(name, args);
	return toolName === null ? null : { toolName };
}

function usageOf(message: unknown): LodyModelUsage | null {
	if (!isRecord(message) || !isRecord(message["usage"])) return null;
	const usage = message["usage"];
	const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
	const cost = isRecord(usage["cost"]) ? usage["cost"]["total"] : undefined;
	return {
		inputTokens: count(usage["input"]),
		outputTokens: count(usage["output"]),
		cacheReadInputTokens: count(usage["cacheRead"]),
		cacheCreationInputTokens: count(usage["cacheWrite"]),
		...(typeof cost === "number" ? { costUSD: cost } : {}),
	};
}

function addUsage(into: LodyModelUsage, from: LodyModelUsage): void {
	into.inputTokens += from.inputTokens;
	into.outputTokens += from.outputTokens;
	into.cacheReadInputTokens += from.cacheReadInputTokens;
	into.cacheCreationInputTokens = (into.cacheCreationInputTokens ?? 0) + (from.cacheCreationInputTokens ?? 0);
	if (from.costUSD !== undefined) into.costUSD = (into.costUSD ?? 0) + from.costUSD;
}

function emptyUsage(): LodyModelUsage {
	return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
}

const START_GRACE_MS = 2000;
const FORK_GRACE_MS = 60_000;
const START_POLL_MS = 100;

interface Pending {
	readonly origin: string | null;
	readonly workspace: string | null;
	readonly scratch: string | null;
	readonly servers: readonly AttachedServer[];
	readonly model: { modelId?: string; reasoning?: string };
}

interface Turn {
	readonly finished: Promise<string>;
	readonly settle: (reason: string) => void;
	cancelled: boolean;
	started: boolean;
	open: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function lodyDataDirs(): readonly string[] {
	const candidates = [process.env["LODY_DATA_DIR"], join(homedir(), ".lody"), join(homedir(), ".lody-oss")];
	return candidates.filter((each): each is string => typeof each === "string" && each !== "").map((each) => each.replace(/\/+$/, ""));
}

function insideTempDir(path: string): boolean {
	const temp = resolve(tmpdir());
	const target = resolve(path);
	return target === temp || target.startsWith(`${temp}${sep}`);
}

// session/new 里没有字段说明 cwd 是用户的项目还是客户端自己的临时目录：Lody 只在 worktree
// 场景下发 _meta.lody.worktreeProject，「空对话」的 cwd 只能靠 <dataDir>/chats/<id> 这个形状认。
// 认错也只是退化成普通 workspace，不丢数据；等客户端愿意在 _meta 里标注 cwd 的性质，这里可以删。
function scratchOf(cwd: string): string | null {
	for (const root of lodyDataDirs()) {
		const prefix = `${root}/chats/`;
		if (!cwd.startsWith(prefix)) continue;
		const rest = cwd.slice(prefix.length);
		if (rest !== "" && !rest.includes("/")) return cwd;
	}
	return null;
}

interface AttachedServer {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

function stdioServersOf(params: unknown): readonly AttachedServer[] {
	const record = isRecord(params) ? params : {};
	const list = record["mcpServers"];
	if (!Array.isArray(list)) return [];
	const out: AttachedServer[] = [];
	for (const raw of list) {
		if (!isRecord(raw)) continue;
		const kind = raw["type"];
		if (kind !== undefined && kind !== "stdio") continue;
		const name = raw["name"];
		const command = raw["command"];
		if (typeof name !== "string" || typeof command !== "string" || name === "") continue;
		const args = Array.isArray(raw["args"]) ? raw["args"].filter((each): each is string => typeof each === "string") : [];
		const env: Record<string, string> = {};
		if (Array.isArray(raw["env"])) {
			for (const entry of raw["env"]) {
				if (!isRecord(entry)) continue;
				const key = entry["name"];
				const value = entry["value"];
				if (typeof key === "string" && key !== "" && typeof value === "string") env[key] = value;
			}
		}
		out.push({ name, command, args, env });
	}
	return out;
}

function clientNameOf(params: unknown): string | null {
	const record = isRecord(params) ? params : {};
	const info = record["clientInfo"];
	const name = isRecord(info) ? info["name"] : undefined;
	if (typeof name === "string" && name !== "") return name;
	const capabilities = record["clientCapabilities"];
	const meta = isRecord(capabilities) ? capabilities["_meta"] : undefined;
	if (isRecord(meta) && isRecord(meta["lody"])) return "lody";
	return null;
}

function sessionConfigOf(params: unknown): { modelId?: string; reasoning?: string } {
	const record = isRecord(params) ? params : {};
	const meta = record["_meta"];
	const lody = isRecord(meta) ? meta["lody"] : undefined;
	const config = isRecord(lody) ? lody["sessionConfig"] : undefined;
	if (!isRecord(config)) return {};
	const modelId = typeof config["modelId"] === "string" && config["modelId"] !== "" ? config["modelId"] : undefined;
	const values = isRecord(config["configOptionValues"]) ? config["configOptionValues"] : {};
	const reasoning = typeof values["reasoning"] === "string" && values["reasoning"] !== "" ? values["reasoning"] : undefined;
	return { ...(modelId === undefined ? {} : { modelId }), ...(reasoning === undefined ? {} : { reasoning }) };
}

function isMode(value: unknown): value is Mode {
	return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

function chunksOf(content: unknown, kind: "text" | "thinking"): string {
	if (typeof content === "string") return kind === "text" ? content : "";
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!isRecord(block) || block["type"] !== kind) continue;
		if (typeof block["text"] === "string") parts.push(block["text"]);
		else if (typeof block["thinking"] === "string") parts.push(block["thinking"]);
	}
	return parts.join("");
}

const MEDIA_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface Prompt {
	readonly text: string;
	readonly images: readonly PromptImage[];
}

function promptOf(prompt: unknown): Prompt {
	if (!Array.isArray(prompt)) return { text: "", images: [] };
	const lines: string[] = [];
	const images: PromptImage[] = [];
	for (const block of prompt) {
		if (!isRecord(block)) continue;
		if (block["type"] === "text" && typeof block["text"] === "string") {
			lines.push(block["text"]);
			continue;
		}
		if (block["type"] === "image" && typeof block["data"] === "string" && typeof block["mimeType"] === "string") {
			const mediaType = block["mimeType"];
			if (!MEDIA_TYPES.includes(mediaType)) throw new RpcError(ERROR.invalidParams, `unsupported image type "${mediaType}"`);
			images.push({
				mediaType: mediaType as ImageMediaType,
				data: new Uint8Array(Buffer.from(block["data"], "base64")),
				...(typeof block["uri"] === "string" ? { name: block["uri"].split("/").pop() } : {}),
			});
			continue;
		}
		if (block["type"] === "resource_link" && typeof block["uri"] === "string") lines.push(`${String(block["name"] ?? "resource")}: ${block["uri"]}`);
		if (block["type"] === "resource") {
			const resource = block["resource"];
			const text = isRecord(resource) && typeof resource["text"] === "string" ? resource["text"] : null;
			const uri = isRecord(resource) && typeof resource["uri"] === "string" ? resource["uri"] : "";
			if (text !== null) lines.push(uri === "" ? text : `${uri}\n\n${text}`);
		}
	}
	return { text: lines.join("\n\n").trim(), images };
}

function titleOf(toolName: string, args: unknown): string {
	const value = isRecord(args) ? args : {};
	const detail = typeof value["command"] === "string" ? value["command"] : typeof value["path"] === "string" ? value["path"] : "";
	const trimmed = detail.trim().replace(/\s+/g, " ");
	return trimmed === "" ? toolName : `${toolName}: ${trimmed.slice(0, 80)}`;
}

function toolUpdate(toolCallId: string, toolName: string, args: unknown, status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		toolCallId,
		title: titleOf(toolName, args),
		kind: TOOL_KINDS[toolName] ?? "other",
		status,
		rawInput: isRecord(args) ? args : {},
		...extra,
	};
}

function escalationOf(data: unknown): EscalationRequest | null {
	if (!isRecord(data)) return null;
	const { escalationId, toolCallId, toolName } = data;
	if (typeof escalationId !== "string" || typeof toolCallId !== "string" || typeof toolName !== "string") return null;
	return {
		escalationId,
		toolCallId,
		toolName,
		params: data["params"],
		command: typeof data["command"] === "string" ? data["command"] : "",
		from: typeof data["from"] === "string" ? data["from"] : "",
		to: typeof data["to"] === "string" ? data["to"] : "",
		justification: typeof data["justification"] === "string" ? data["justification"] : "",
		timestamp: typeof data["timestamp"] === "number" ? data["timestamp"] : 0,
	};
}

export interface AcpAgentDeps {
	readonly boot: () => Promise<Backend>;
	readonly rpc: RpcServer;
}

export class AcpAgent {
	private _backend: Promise<Backend> | null = null;
	private _watched = false;
	private readonly _turns = new Map<string, Turn>();
	private readonly _asked = new Set<string>();
	private readonly _live = new Set<string>();
	private readonly _pending = new Map<string, Pending>();
	private _client: string | null = null;
	private readonly _compacting = new Map<string, string>();
	private _compactingSeq = 0;
	private readonly _sent = new Map<string, string>();
	private readonly _streamIds = new Map<string, { stamp: number; seq: number }>();
	private readonly _toolMeta = new Map<string, Record<string, unknown>>();
	private readonly _tasks = new Map<string, Set<string>>();
	private readonly _scheduled = new Map<string, Set<string>>();
	private readonly _usageByModel = new Map<string, Map<string, LodyModelUsage>>();
	private readonly _usageDelta = new Map<string, Map<string, LodyModelUsage>>();
	private readonly _usageScope = randomUUID();

	constructor(private readonly _deps: AcpAgentDeps) {}

	handlers() {
		return {
			requests: {
				initialize: (params: unknown) => this._initialize(params),
				"session/new": (params: unknown) => this._newSession(params),
				"session/load": (params: unknown) => this._loadSession(params),
				"session/fork": (params: unknown) => this._forkSession(params),
				"session/list": (params: unknown) => this._listSessions(params),
				"session/delete": (params: unknown) => this._deleteSession(params),
				"session/close": (params: unknown) => this._closeSession(params),
				"session/prompt": (params: unknown) => this._prompt(params),
				"session/set_mode": (params: unknown) => this._setMode(params),
				"session/set_config_option": (params: unknown) => this._setConfigOption(params),
			},
			notifications: {
				"session/cancel": (params: unknown) => this._cancel(params),
				"session/set_model": (params: unknown) => this._setModel(params),
			},
		};
	}

	async dispose(): Promise<void> {
		const backend = await this._backend?.catch(() => null);
		await backend?.close();
	}

	private _initialize(params: unknown): unknown {
		this._client = clientNameOf(params);
		void this._backendOf().catch((error: unknown) => console.error("acp: boot failed:", error));
		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: { image: true, audio: false, embeddedContext: true },
				sessionCapabilities: { list: {}, delete: {}, close: {}, fork: {} },
				_meta: { lody: { tasks: { version: 1 }, compaction: { version: 1 }, sessionActivity: { version: 1 }, usage: { version: 1 } } },
			},
			authMethods: [],
			agentInfo: AGENT,
		};
	}

	private _backendOf(): Promise<Backend> {
		this._backend ??= this._deps.boot().then((backend) => {
			this._watch(backend);
			return backend;
		});
		return this._backend;
	}

	private async _newSession(params: unknown): Promise<unknown> {
		const cwd = isRecord(params) ? params["cwd"] : undefined;
		const workspace = typeof cwd === "string" && cwd.trim() !== "" ? await this._existingDirectory(cwd) : null;

		const backend = await this._backendOf();
		const name = await this._nameFor(backend);
		const session = backend.sessions.get(name);
		this._live.add(name);
		this._pending.set(name, {
			origin: this._client,
			workspace,
			scratch: workspace === null ? null : scratchOf(workspace),
			servers: stdioServersOf(params),
			model: sessionConfigOf(params),
		});
		void backend.extensions
			.settled()
			.then(() => this._commands(session))
			.catch((error: unknown) => console.error("acp: commands failed:", error));
		this._title(name);
		return { sessionId: name, modes: await this._modesOf(session), configOptions: await this._configOptionsOf(session) };
	}

	private async _loadSession(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const session = await this._sessionOf(record["sessionId"]);
		const cwd = record["cwd"];
		const workspace = typeof cwd === "string" && cwd.trim() !== "" ? await this._existingDirectory(cwd).catch(() => null) : null;
		if (workspace !== null) await session.setWorkspace(workspace);
		await writeDriver(session.root, this._client ?? "acp");
		await this._attachServers(session, stdioServersOf(params));
		this._title(session.name);
		await this._replay(session);
		void this._activity(session.name);
		await this._pendingEscalations(session);
		await this._commands(session);
		return { modes: await this._modesOf(session), configOptions: await this._configOptionsOf(session) };
	}

	private async _pendingEscalations(session: Session): Promise<void> {
		for (const request of await pendingEscalations(session)) {
			if (this._asked.has(request.escalationId)) continue;
			this._asked.add(request.escalationId);
			void this._ask(session.name, request).catch((error: unknown) => console.error("acp: escalation failed:", error));
		}
	}

	private async _forkSession(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const source = await this._sessionOf(record["sessionId"]);
		const backend = await this._backendOf();
		let target: string;
		try {
			target = await backend.sessions.copy(source.name, "fork");
		} catch (error) {
			throw new RpcError(ERROR.invalidRequest, error instanceof Error ? error.message : String(error));
		}
		this._live.add(target);
		await this._awaitFork(backend, target);
		const session = backend.sessions.get(target);
		const cwd = record["cwd"];
		if (typeof cwd === "string" && cwd.trim() !== "") {
			const workspace = await this._existingDirectory(cwd).catch(() => null);
			if (workspace !== null) await session.setWorkspace(workspace);
		}
		await writeDriver(session.root, this._client ?? "acp");
		await this._attachServers(session, stdioServersOf(params));
		this._title(target);
		await this._commands(session);
		return { sessionId: target, modes: await this._modesOf(session), configOptions: await this._configOptionsOf(session) };
	}

	private async _awaitFork(backend: Backend, target: string): Promise<void> {
		const deadline = Date.now() + FORK_GRACE_MS;
		while (Date.now() < deadline) {
			const forking = await backend.sessions
				.get(target)
				.forking()
				.catch(() => false);
			if (!forking) return;
			await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
		}
		console.error(`acp: fork "${target}" did not settle within ${FORK_GRACE_MS}ms`);
	}

	private async _listSessions(params: unknown): Promise<unknown> {
		const cwd = isRecord(params) ? params["cwd"] : undefined;
		const backend = await this._backendOf();
		const root = backend.sessions.partnerRoot;
		const sessions: Record<string, unknown>[] = [];
		for (const name of await backend.sessions.names()) {
			const dir = join(root, name);
			const facts = await stat(dir).catch(() => null);
			if (facts === null) continue;
			const workspace = await readFile(join(dir, "workspace.json"), "utf8")
				.then((text) => JSON.parse(text) as { path?: unknown })
				.catch(() => null);
			const profile = await readFile(join(dir, "profile.json"), "utf8")
				.then((text) => JSON.parse(text) as { scratch?: unknown })
				.catch(() => null);
			const stored = typeof workspace?.path === "string" && workspace.path !== "" ? workspace.path : null;
			const scratch = typeof profile?.scratch === "string" && profile.scratch !== "" ? profile.scratch : null;
			const path = stored ?? scratch;
			if (path === null) continue;
			if (typeof cwd === "string" && path !== cwd) continue;
			sessions.push({ sessionId: name, cwd: path, updatedAt: new Date(facts.mtimeMs).toISOString() });
		}
		return { sessions };
	}

	private async _materialize(session: Session): Promise<void> {
		const pending = this._pending.get(session.name);
		if (pending === undefined) return;
		this._pending.delete(session.name);
		const backend = await this._backendOf();
		await session.mark(pending.origin ?? "acp", pending.scratch ?? undefined);
		if (pending.workspace !== null && pending.scratch === null) await session.setWorkspace(pending.workspace);
		await this._attachServers(session, pending.servers);
		await this._adoptClientModel(backend, session, pending.model);
	}

	private async _attachServers(session: Session, servers: readonly AttachedServer[]): Promise<void> {
		try {
			await mkdir(session.root, { recursive: true });
			const payload = { servers: servers.map((server) => ({ name: server.name, command: server.command, args: [...server.args], env: { ...server.env } })) };
			await writeFile(join(session.root, "mcp.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		} catch (error) {
			console.error("acp: failed to record client MCP servers:", error);
		}
	}

	private async _adoptClientModel(backend: Backend, session: Session, wanted: { modelId?: string; reasoning?: string }): Promise<void> {
		if (wanted.modelId === undefined && wanted.reasoning === undefined) return;
		const current = this._chosen(backend, await session.model());
		const candidates = backend.models.available();
		const found =
			wanted.modelId === undefined
				? undefined
				: (candidates.find((model) => model.id === wanted.modelId && model.provider === current?.provider) ?? candidates.find((model) => model.id === wanted.modelId));
		if (found === undefined && wanted.reasoning === undefined) return;
		const provider = found?.provider ?? current?.provider;
		if (provider === undefined) return;
		const modelId = found?.id ?? current?.modelId;
		await session.setModel({
			provider,
			...(modelId === undefined ? {} : { modelId }),
			...(wanted.reasoning !== undefined ? { thinkingLevel: wanted.reasoning } : current?.thinkingLevel === undefined ? {} : { thinkingLevel: current.thinkingLevel }),
		});
	}

	private async _existingDirectory(path: string): Promise<string> {
		if (!isAbsolute(path)) throw new RpcError(ERROR.invalidParams, "cwd must be an absolute path");
		const facts = await stat(path).catch(() => null);
		if (facts === null || !facts.isDirectory()) throw new RpcError(ERROR.invalidParams, `cwd is not a directory: ${path}`);
		return path;
	}

	private async _closeSession(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const sessionId = record["sessionId"];
		if (typeof sessionId !== "string" || sessionId === "") return {};
		this._forget(sessionId);
		this._pending.delete(sessionId);
		this._live.delete(sessionId);
		const backend = await this._backendOf().catch(() => null);
		if (backend === null) return {};
		const known = (await backend.sessions.names()).includes(sessionId);
		const workspace = known
			? await backend.sessions
					.get(sessionId)
					.workspace()
					.catch(() => null)
			: null;
		await backend.sessions.close(sessionId);
		await clearDriver(join(backend.sessions.partnerRoot, sessionId)).catch(() => undefined);
		if (workspace !== null && insideTempDir(workspace.path) && known) {
			await backend.sessions.remove(sessionId).catch((error: unknown) => console.error(`acp: failed to drop "${sessionId}":`, error));
		}
		return {};
	}

	private async _deleteSession(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const session = await this._sessionOf(record["sessionId"]);
		if (this._turns.has(session.name)) throw new RpcError(ERROR.invalidRequest, `"${session.name}" is running; cancel it before deleting`);
		const backend = await this._backendOf();
		this._live.delete(session.name);
		this._pending.delete(session.name);
		this._forget(session.name);
		await clearDriver(join(backend.sessions.partnerRoot, session.name)).catch(() => undefined);
		if (!(await backend.sessions.names()).includes(session.name)) return {};
		try {
			await backend.sessions.remove(session.name);
		} catch (error) {
			if (error instanceof SessionLockedError) throw new RpcError(ERROR.invalidRequest, error.message);
			throw error;
		}
		return {};
	}

	private _forget(session: string): void {
		this._turns.delete(session);
		this._compacting.delete(session);
		for (const key of this._sent.keys()) {
			if (key.startsWith(`${session}:`)) this._sent.delete(key);
		}
	}

	private async _nameFor(backend: Backend): Promise<string> {
		const taken = new Set([...(await backend.sessions.names()), ...this._live].map((name) => name.toLowerCase()));
		const now = new Date();
		const pad = (value: number): string => String(value).padStart(2, "0");
		const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		const base = `acp-${stamp}-${randomUUID().replace(/-/g, "").slice(0, 4)}`;
		if (!taken.has(base.toLowerCase())) return base;
		for (let index = 2; ; index += 1) {
			const candidate = `${base}-${index}`;
			if (!taken.has(candidate.toLowerCase())) return candidate;
		}
	}

	private async _sessionOf(sessionId: unknown): Promise<Session> {
		if (typeof sessionId !== "string" || sessionId === "") throw new RpcError(ERROR.invalidParams, "sessionId is required");
		const backend = await this._backendOf();
		if (!this._live.has(sessionId) && !(await backend.sessions.names()).includes(sessionId)) {
			throw new RpcError(ERROR.resourceNotFound, `no session "${sessionId}"`);
		}
		this._live.add(sessionId);
		return backend.sessions.get(sessionId);
	}

	private async _modesOf(session: Session): Promise<unknown> {
		const sandbox = await session.sandbox();
		const current = isMode(sandbox.mode) ? sandbox.mode : "workspace-write";
		return {
			currentModeId: current,
			availableModes: MODES.map((id) => ({ id, name: MODE_NAMES[id] })),
		};
	}

	private _chosen(
		backend: Backend,
		stored: { provider: string; modelId?: string; thinkingLevel?: string } | null,
	): { provider: string; modelId?: string; thinkingLevel?: string } | null {
		if (stored !== null) return stored;
		const fallback = backend.models.defaultRef();
		if (fallback === null) return null;
		return { provider: fallback.provider, ...(fallback.modelId === undefined ? {} : { modelId: fallback.modelId }) };
	}

	private _resolved(backend: Backend, model: { provider: string; modelId?: string } | null): { provider: string; model: unknown } | null {
		const ref = model ?? backend.models.defaultRef();
		if (ref === null) return null;
		try {
			return { provider: ref.provider, model: backend.models.resolve(ref.modelId === undefined ? { provider: ref.provider } : ref) };
		} catch {
			return null;
		}
	}

	private async _configOptionsOf(session: Session): Promise<Record<string, unknown>[]> {
		const backend = await this._backendOf();
		const chosen = await session.model();
		const all = backend.models.available();
		const credentialed = new Set([...new Set(all.map((model) => model.provider))].filter((provider) => backend.models.credential(provider) !== undefined));
		const models = all.filter((model) => credentialed.has(model.provider));
		const options = models.map((model) => ({
			value: `${model.provider}/${model.id}`,
			name: typeof model.name === "string" && model.name !== "" ? model.name : model.id,
			description: backend.models.name(model.provider) ?? model.provider,
		}));
		const effective = this._chosen(backend, chosen);
		const wanted = effective === null ? undefined : `${effective.provider}/${effective.modelId ?? ""}`;
		const current = options.some((option) => option.value === wanted) ? wanted : options[0]?.value;
		const out: Record<string, unknown>[] = [];
		if (options.length > 0 && current !== undefined) {
			out.push({ id: "model", name: "Model", category: "model", type: "select", currentValue: current, options });
		}
		const resolved = this._resolved(backend, chosen);
		const levels = resolved === null ? [] : backend.models.supportedThinkingLevels(resolved.model as never);
		if (levels.length > 0) {
			out.push({
				id: "reasoning",
				name: "Reasoning",
				category: "thought_level",
				type: "select",
				currentValue: session.thinkingLevel(),
				options: levels.map((level) => ({ value: level, name: level })),
			});
		}
		return out;
	}

	private async _setConfigOption(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const session = await this._sessionOf(record["sessionId"]);
		const configId = record["configId"];
		const value = record["value"];
		if (typeof configId !== "string" || typeof value !== "string") throw new RpcError(ERROR.invalidParams, "configId and value are required");
		const backend = await this._backendOf();
		const chosen = this._chosen(backend, await session.model());
		if (chosen === null) throw new RpcError(ERROR.internal, "no model is configured");
		if (configId === "model") {
			const picked = backend.models.available().find((model) => `${model.provider}/${model.id}` === value);
			if (picked === undefined) throw new RpcError(ERROR.invalidParams, `"${value}" is not an available model`);
			await session.setModel({ provider: picked.provider, modelId: picked.id, ...(chosen.thinkingLevel === undefined ? {} : { thinkingLevel: chosen.thinkingLevel }) });
		} else if (configId === "reasoning") {
			await session.setModel({ ...chosen, thinkingLevel: value });
		} else {
			throw new RpcError(ERROR.invalidParams, `unknown config "${configId}"`);
		}
		const configOptions = await this._configOptionsOf(session);
		this._deps.rpc.notify("session/update", { sessionId: session.name, update: { sessionUpdate: "config_option_update", configOptions } });
		return { configOptions };
	}

	private _setModel(params: unknown): void {
		const record = isRecord(params) ? params : {};
		const sessionId = record["sessionId"];
		const modelId = record["modelId"];
		if (typeof sessionId !== "string" || typeof modelId !== "string") return;
		void (async () => {
			const session = await this._sessionOf(sessionId);
			const chosen = this._chosen(await this._backendOf(), await session.model());
			if (chosen === null) return;
			await session.setModel({ ...chosen, modelId });
			const configOptions = await this._configOptionsOf(session);
			this._deps.rpc.notify("session/update", { sessionId, update: { sessionUpdate: "config_option_update", configOptions } });
		})().catch((error: unknown) => console.error("acp: set_model failed:", error));
	}

	private async _commands(session: Session): Promise<void> {
		const backend = await this._backendOf();
		const commands = await backend.commands.list(session);
		this._deps.rpc.notify("session/update", {
			sessionId: session.name,
			update: {
				sessionUpdate: "available_commands_update",
				availableCommands: commands.map((command) => ({
					name: command.name,
					description: command.description,
					...(typeof command.hint === "string" && command.hint !== "" ? { input: { hint: command.hint } } : {}),
				})),
			},
		});
	}

	private async _replay(session: Session): Promise<void> {
		const messages = await session.transcript();
		for (const message of messages) {
			const item = message as unknown as Record<string, unknown>;
			const role = item["role"];
			const content = item["content"];
			if (role === "user") {
				const text = chunksOf(content, "text").trim();
				if (text !== "") this._chunk(session.name, "user_message_chunk", text);
				continue;
			}
			if (role !== "assistant") continue;
			const text = chunksOf(content, "text");
			if (text !== "") this._chunk(session.name, "agent_message_chunk", text);
			if (!Array.isArray(content)) continue;
			for (const block of content) {
				if (!isRecord(block) || block["type"] !== "toolCall") continue;
				const name = String(block["name"] ?? "");
				this._deps.rpc.notify("session/update", {
					sessionId: session.name,
					update: { sessionUpdate: "tool_call", ...toolUpdate(String(block["id"] ?? ""), name, block["arguments"], "completed") },
				});
			}
		}
	}

	private async _prompt(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const session = await this._sessionOf(record["sessionId"]);
		const backend = await this._backendOf();
		await this._materialize(session);
		await writeDriver(session.root, this._client ?? "acp");
		const prompt = promptOf(record["prompt"]);
		if (prompt.text === "" && prompt.images.length === 0) throw new RpcError(ERROR.invalidParams, "prompt carries no content");
		const command = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(prompt.text);
		if (command !== null) {
			const known = (await backend.commands.list(session)).find((each) => each.name === command[1]);
			if (known !== undefined) {
				const turn = this._begin(session.name);
				await backend.commands.run(session, known.name, command[2] ?? "", { asDriver: true });
				this._turns.delete(session.name);
				turn.settle("end_turn");
				void this._activity(session.name, "idle");
				return { stopReason: "end_turn" };
			}
		}
		const turn = this._begin(session.name);
		try {
			await session.send(prompt.text, prompt.images);
		} catch (error) {
			this._turns.delete(session.name);
			throw new RpcError(ERROR.internal, error instanceof Error ? error.message : String(error));
		}
		const stopReason = await this._await(session, turn);
		this._compacting.delete(session.name);
		this._turns.delete(session.name);
		this._sent.clear();
		void this._activity(session.name, "idle");
		if (stopReason !== null && stopReason.startsWith("error:")) throw new RpcError(ERROR.internal, stopReason.slice("error:".length));
		if (stopReason === null) {
			const row = await session.row();
			throw new RpcError(ERROR.internal, row.error ?? "the run did not start — is a model configured?");
		}
		return { stopReason };
	}

	private async _await(session: Session, turn: Turn): Promise<string | null> {
		const deadline = Date.now() + START_GRACE_MS;
		for (;;) {
			const raced = await Promise.race([turn.finished, new Promise<null>((resolve) => setTimeout(() => resolve(null), START_POLL_MS))]);
			if (raced !== null) return raced;
			if (turn.started || session.running) continue;
			if (Date.now() >= deadline) return null;
		}
	}

	private async _setMode(params: unknown): Promise<unknown> {
		const record = isRecord(params) ? params : {};
		const session = await this._sessionOf(record["sessionId"]);
		const modeId = record["modeId"];
		if (!isMode(modeId)) throw new RpcError(ERROR.invalidParams, `unknown mode "${String(modeId)}"`);
		await session.setSandbox(modeId);
		this._modeChanged(session.name, modeId);
		return {};
	}

	private _cancel(params: unknown): void {
		const sessionId = isRecord(params) ? params["sessionId"] : undefined;
		if (typeof sessionId !== "string") return;
		const turn = this._turns.get(sessionId);
		if (turn === undefined) return;
		turn.cancelled = true;
		void this._backendOf()
			.then((backend) => backend.sessions.get(sessionId).abort())
			.catch((error: unknown) => console.error("acp: cancel failed:", error));
	}

	private _begin(session: string): Turn {
		let settle!: (reason: string) => void;
		const finished = new Promise<string>((resolve) => {
			settle = resolve;
		});
		const turn: Turn = { finished, settle, cancelled: false, started: false, open: 0 };
		this._turns.set(session, turn);
		return turn;
	}

	private _watch(backend: Backend): void {
		if (this._watched) return;
		this._watched = true;
		backend.sessions.onLoopEvent(({ session, event }) => this._relay(session, event));
		backend.sessions.onEntry(({ session, entry }) => this._entry(session, entry));
		backend.sessions.onCompacting(({ session, compacting }) => this._compaction(session, compacting));
	}

	private _entry(session: string, entry: SeqEntry): void {
		if (!this._live.has(session)) return;
		if (entry.entry.type === "message" && entry.entry.message.role === "user" && !this._turns.has(session)) {
			const text = chunksOf(entry.entry.message.content, "text").trim();
			if (text !== "") this._chunk(session, "user_message_chunk", text);
			return;
		}
		if (entry.entry.type !== "custom") return;
		const kind = entry.entry.customType;
		const data = (entry.entry.data ?? {}) as Record<string, unknown>;
		if (kind === EVENTS.taskStart) {
			this._taskStarted(session, data);
			return;
		}
		if (kind === EVENTS.taskEnd) {
			this._taskEnded(session, data);
			return;
		}
		if (kind === EVENTS.scheduleRun) {
			this._scheduleFired(session, data);
			return;
		}
		if (kind === EVENTS.retryScheduled) {
			this._retry(session, "scheduled", data);
			return;
		}
		if (kind === EVENTS.retryStarted) {
			this._retry(session, "started", data);
			return;
		}
		if (kind !== EVENTS.escalationRequest) return;
		const request = escalationOf(entry.entry.data);
		if (request === null) return;
		if (this._asked.has(request.escalationId)) return;
		this._asked.add(request.escalationId);
		const turn = this._turns.get(session);
		if (turn !== undefined) turn.open += 1;
		void this._ask(session, request).catch((error: unknown) => console.error("acp: escalation failed:", error));
	}

	private async _ask(session: string, request: EscalationRequest): Promise<void> {
		const options = [
			{ optionId: "allow_once", name: `允许这一次（升到 ${request.to}）`, kind: "allow_once" },
			{ optionId: "allow_always", name: `本会话放开到 ${request.to}`, kind: "allow_always" },
			{ optionId: "reject_once", name: "拒绝", kind: "reject_once" },
		];
		void this._activity(session);
		const toolCall = {
			...toolUpdate(request.toolCallId, request.toolName, request.params, "pending"),
			...(request.justification === "" ? {} : { content: [{ type: "content", content: { type: "text", text: request.justification } }] }),
		};
		let optionId: string | null = null;
		try {
			const response = await this._deps.rpc.request("session/request_permission", { sessionId: session, toolCall, options });
			const outcome = isRecord(response) ? response["outcome"] : undefined;
			const chosen = isRecord(outcome) && outcome["outcome"] === "selected" ? outcome["optionId"] : undefined;
			if (typeof chosen === "string" && options.some((option) => option.optionId === chosen)) optionId = chosen;
		} catch (error) {
			console.error("acp: permission request failed:", error);
		}

		const backend = await this._backendOf();
		const target = backend.sessions.get(session);
		if (optionId === "allow_always" && isMode(request.to)) {
			await target.setSandbox(request.to);
			this._modeChanged(session, request.to);
		}
		await settleEscalation(target, backend.tools, request, optionId === null || optionId === "reject_once" ? "rejected" : "approved");
		void this._activity(session);
		const turn = this._turns.get(session);
		if (turn === undefined) return;
		turn.open = Math.max(0, turn.open - 1);
		if (turn.open === 0) void this._afterResume(target, turn);
	}

	private async _afterResume(session: Session, turn: Turn): Promise<void> {
		const deadline = Date.now() + START_GRACE_MS;
		while (Date.now() < deadline) {
			if (session.running) return;
			await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
		}
		if (!session.running && !turn.cancelled) turn.settle("end_turn");
	}

	private _compaction(session: string, compacting: boolean): void {
		if (!this._live.has(session)) return;
		const open = this._compacting.get(session);
		if (compacting) {
			if (open !== undefined) return;
			const toolCallId = `compacting-${++this._compactingSeq}`;
			this._compacting.set(session, toolCallId);
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: {
					sessionUpdate: "tool_call",
					toolCallId,
					title: "Compacting context",
					kind: "other",
					status: "in_progress",
					_meta: { lody: { activity: { version: 1, kind: "context_compaction", automatic: true } } },
				},
			});
			this._chunk(session, "agent_thought_chunk", "正在压缩上下文，稍等…");
			return;
		}
		if (open === undefined) return;
		this._compacting.delete(session);
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: open,
				status: "completed",
				_meta: { lody: { activity: { version: 1, kind: "context_compaction", automatic: true } } },
			},
		});
	}

	private _relay(session: string, event: AgentLoopEvent): void {
		if (event.type === "run_start") {
			const turn = this._turns.get(session);
			if (turn !== undefined) turn.started = true;
			void this._activity(session, "running");
			return;
		}
		if (event.type === "run_end") {
			this._closeScheduled(session);
			void this._activity(session, "idle");
			const turn = this._turns.get(session);
			if (turn === undefined) return;
			if (turn.open > 0) return;
			if (event.error !== undefined) {
				turn.settle(`error:${event.error}`);
				return;
			}
			turn.settle(turn.cancelled ? "cancelled" : "end_turn");
			return;
		}
		if (!this._live.has(session)) return;
		if (event.type === "turn_end") {
			void this._usage(session);
			void this._activity(session);
			return;
		}
		if (event.type === "message_end") {
			this._account(session, event.message);
			return;
		}
		if (event.type === "message_update") this._stream(session, event.message);
		if (event.type === "tool_start") {
			const meta = lodyMeta(event.toolName, event.args);
			if (meta !== null) this._toolMeta.set(`${session}:${event.toolCallId}`, meta);
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: { sessionUpdate: "tool_call", ...toolUpdate(event.toolCallId, event.toolName, event.args, "in_progress"), ...(meta === null ? {} : { _meta: { lody: meta } }) },
			});
		}
		if (event.type === "tool_end") {
			const meta = this._toolMeta.get(`${session}:${event.toolCallId}`) ?? null;
			this._toolMeta.delete(`${session}:${event.toolCallId}`);
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: event.toolCallId,
					status: event.isError ? "failed" : "completed",
					...(event.preview === "" ? {} : { content: [{ type: "content", content: { type: "text", text: event.preview } }] }),
					...(meta === null ? {} : { _meta: { lody: meta } }),
				},
			});
		}
	}

	private _title(session: string): void {
		this._deps.rpc.notify("session/update", { sessionId: session, update: { sessionUpdate: "session_info_update", title: session } });
	}

	private async _usage(session: string): Promise<void> {
		const backend = await this._backendOf().catch(() => null);
		if (backend === null) return;
		const context = await backend.sessions
			.get(session)
			.contextUsage()
			.catch(() => null);
		const modelUsage = this._modelUsage(session);
		const spent = Object.values(modelUsage).every((row) => row.costUSD !== undefined) ? Object.values(modelUsage).reduce((sum, row) => sum + (row.costUSD ?? 0), 0) : undefined;
		if (context !== null) {
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: { sessionUpdate: "usage_update", used: context.used, size: context.window, ...(spent === undefined ? {} : { cost: { amount: spent, currency: "USD" } }) },
			});
		}
		const rows = Object.entries(modelUsage);
		if (rows.length === 0) return;
		const latest = rows.reduce((best, [, row]) => (row.inputTokens + row.outputTokens > best.inputTokens + best.outputTokens ? row : best), emptyUsage());
		const delta = this._takeDelta(session);
		this._deps.rpc.notify("_lody/session/usage_update", {
			sessionId: session,
			usage: latest,
			modelUsage,
			...(Object.keys(delta).length === 0 ? {} : { delta: { usage: latest, modelUsage: delta } }),
			_meta: { lody: { usageScopeId: this._usageScope } },
		});
	}

	private _account(session: string, message: unknown): void {
		if (!isRecord(message) || message["role"] !== "assistant") return;
		const usage = usageOf(message);
		if (usage === null) return;
		const model = typeof message["model"] === "string" && message["model"] !== "" ? message["model"] : "unknown";
		const totals = this._usageByModel.get(session) ?? new Map<string, LodyModelUsage>();
		const total = totals.get(model) ?? emptyUsage();
		addUsage(total, usage);
		totals.set(model, total);
		this._usageByModel.set(session, totals);
		const pending = this._usageDelta.get(session) ?? new Map<string, LodyModelUsage>();
		const delta = pending.get(model) ?? emptyUsage();
		addUsage(delta, usage);
		pending.set(model, delta);
		this._usageDelta.set(session, pending);
	}

	private _modelUsage(session: string): Record<string, LodyModelUsage> {
		const totals = this._usageByModel.get(session);
		return totals === undefined ? {} : Object.fromEntries(totals);
	}

	private _takeDelta(session: string): Record<string, LodyModelUsage> {
		const pending = this._usageDelta.get(session);
		if (pending === undefined) return {};
		this._usageDelta.delete(session);
		return Object.fromEntries(pending);
	}

	private async _activity(session: string, known?: "running" | "idle"): Promise<void> {
		if (!this._live.has(session)) return;
		const backend = await this._backendOf().catch(() => null);
		if (backend === null) return;
		const target = backend.sessions.get(session);
		// 事件到达时 loop 的 running 还没翻面（run_end 在 finally 之前发），所以由调用方给出已知状态
		const state = target.hasSuspended() ? "requires_action" : (known ?? (target.running ? "running" : "idle"));
		this._deps.rpc.notify("_lody/session/activity_update", {
			version: 1,
			sessionId: session,
			state,
			backgroundTaskCount: this._tasks.get(session)?.size ?? 0,
		});
	}

	private _taskStarted(session: string, data: Record<string, unknown>): void {
		const taskId = typeof data["taskId"] === "string" ? data["taskId"] : null;
		if (taskId === null) return;
		const live = this._tasks.get(session) ?? new Set<string>();
		live.add(taskId);
		this._tasks.set(session, live);
		const command = typeof data["command"] === "string" ? data["command"] : "";
		const startedAt = typeof data["timestamp"] === "number" ? Math.round(data["timestamp"] / 1000) : Math.round(Date.now() / 1000);
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: `task-${taskId}`,
				title: command === "" ? taskId : command.length > 80 ? `${command.slice(0, 80)}…` : command,
				kind: "execute",
				status: "in_progress",
				_meta: {
					lody: { task: { version: 1, taskId, kind: "background", status: "in_progress", ...(command === "" ? {} : { description: command }), startedAtEpochSeconds: startedAt } },
				},
			},
		});
		void this._activity(session);
	}

	private _taskEnded(session: string, data: Record<string, unknown>): void {
		const taskId = typeof data["taskId"] === "string" ? data["taskId"] : null;
		if (taskId === null) return;
		const live = this._tasks.get(session);
		live?.delete(taskId);
		const exitCode = typeof data["exitCode"] === "number" ? data["exitCode"] : null;
		const status = exitCode === null || exitCode === 0 ? "completed" : "failed";
		const endedAt = typeof data["timestamp"] === "number" ? Math.round(data["timestamp"] / 1000) : Math.round(Date.now() / 1000);
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: `task-${taskId}`,
				status,
				_meta: {
					lody: {
						task: {
							version: 1,
							taskId,
							kind: "background",
							status,
							endedAtEpochSeconds: endedAt,
							...(status === "failed" && exitCode !== null ? { error: `exit ${exitCode}` } : {}),
						},
					},
				},
			},
		});
		void this._activity(session);
	}

	private _scheduleFired(session: string, data: Record<string, unknown>): void {
		const runId = typeof data["runId"] === "string" ? data["runId"] : null;
		if (runId === null) return;
		const dispatched = data["status"] === "dispatched";
		const startedAt = typeof data["dispatchedAt"] === "number" ? Math.round(data["dispatchedAt"] / 1000) : Math.round(Date.now() / 1000);
		if (!dispatched) {
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: `schedule-${runId}`,
					title: "Scheduled run",
					kind: "other",
					status: "failed",
					_meta: { lody: { task: { version: 1, taskId: runId, kind: "scheduled", status: "failed", ...(typeof data["error"] === "string" ? { error: data["error"] } : {}) } } },
				},
			});
			return;
		}
		const pending = this._scheduled.get(session) ?? new Set<string>();
		pending.add(runId);
		this._scheduled.set(session, pending);
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: `schedule-${runId}`,
				title: "Scheduled run",
				kind: "other",
				status: "in_progress",
				_meta: { lody: { task: { version: 1, taskId: runId, kind: "scheduled", status: "in_progress", startedAtEpochSeconds: startedAt } } },
			},
		});
		void this._activity(session);
	}

	private _closeScheduled(session: string): void {
		const pending = this._scheduled.get(session);
		if (pending === undefined || pending.size === 0) return;
		this._scheduled.delete(session);
		const endedAt = Math.round(Date.now() / 1000);
		for (const runId of pending) {
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: `schedule-${runId}`,
					status: "completed",
					_meta: { lody: { task: { version: 1, taskId: runId, kind: "scheduled", status: "completed", endedAtEpochSeconds: endedAt } } },
				},
			});
		}
	}

	private _modeChanged(session: string, modeId: string): void {
		this._deps.rpc.notify("session/update", { sessionId: session, update: { sessionUpdate: "current_mode_update", currentModeId: modeId } });
	}

	private _retry(session: string, phase: "scheduled" | "started", data: Record<string, unknown>): void {
		const retryId = typeof data["retryId"] === "string" ? data["retryId"] : null;
		if (retryId === null) return;
		const toolCallId = `retry-${retryId}`;
		const activity = { version: 1, kind: "retry", automatic: true };
		if (phase === "scheduled") {
			const reason = typeof data["error"] === "string" ? data["error"] : undefined;
			this._deps.rpc.notify("session/update", {
				sessionId: session,
				update: {
					sessionUpdate: "tool_call",
					toolCallId,
					title: typeof data["retry"] === "number" ? `Retrying (${data["retry"]})` : "Retrying",
					kind: "other",
					status: "in_progress",
					_meta: { lody: { activity: { ...activity, ...(reason === undefined ? {} : { failureReason: reason.slice(0, 300) }) } } },
				},
			});
			return;
		}
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed", _meta: { lody: { activity } } },
		});
	}

	private _stream(session: string, message: unknown): void {
		if (!isRecord(message) || message["role"] !== "assistant") return;
		const id = `${session}:${this._streamKey(session, message)}`;
		this._flush(session, `${id}:text`, "agent_message_chunk", chunksOf(message["content"], "text"));
		this._flush(session, `${id}:thinking`, "agent_thought_chunk", chunksOf(message["content"], "thinking"));
	}

	private _streamKey(session: string, message: Record<string, unknown>): string {
		if (typeof message["id"] === "string") return message["id"];
		const stamp = typeof message["timestamp"] === "number" ? message["timestamp"] : 0;
		const last = this._streamIds.get(session);
		const seq = last !== undefined && last.stamp === stamp ? last.seq : (last?.seq ?? 0) + 1;
		this._streamIds.set(session, { stamp, seq });
		return `anonymous-${seq}`;
	}

	private _chunk(session: string, kind: string, text: string): void {
		this._deps.rpc.notify("session/update", {
			sessionId: session,
			update: { sessionUpdate: kind, content: { type: "text", text } },
		});
	}

	private _flush(session: string, key: string, kind: string, whole: string): void {
		const sent = this._sent.get(key) ?? "";
		if (whole.length <= sent.length) {
			if (whole !== sent) this._sent.set(key, whole);
			return;
		}
		const delta = whole.slice(sent.length);
		this._sent.set(key, whole);
		this._chunk(session, kind, delta);
	}
}
