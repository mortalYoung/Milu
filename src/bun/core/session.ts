/**
 * Conversation persistence: based on pi's JSONL session layer (JsonlSessionRepo + Session).
 *
 * - Single continuous session: open the newest session in the repo, create one if none exists; keep appending to the same session
 * - Full ingestion: user / assistant (thinking, tool_use blocks verbatim) / toolResult /
 *   send_message custom entries; the frontend only sees user and send_message
 * - Restore: buildSessionContext + entryProjectors reconstruct the AgentMessage chain
 *   (pi's JSONL backend has built-in append-only writes and torn-write repair)
 */
import { cp } from "node:fs/promises";
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type { Surface, SurfaceOpRecord } from "../../shared/surface";
import { createExecutionEnv } from "../tools/execution-env";
import { DATABASE_ROOT, PROJECT_ROOT } from "./config";
import { deriveMessages as deriveSurfaceMessages, dropDanglingTurn, foldSurface } from "./surface";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * send_message visible messages: enter the agent context as custom messages,
 * projected by convertToLlm into visible text; display:false ones are dropped.
 */
declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		sendMessage: {
			role: "custom";
			customType: "send_message";
			content: string;
			display: boolean;
			timestamp: number;
		};
	}
}

export interface AssistantMeta {
	blocks: AssistantMessage["content"];
	toolResults?: ToolResultMessage[];
	usage?: Usage;
}

export interface VisibleItem {
	/** pi entry id; the view dedupes incremental renders by it. */
	id: string;
	kind: "user" | "send_message";
	text: string;
	time: number;
}

export interface SessionStore {
	/** Open/restore complete (can be awaited before the first operation). */
	ready(): Promise<void>;
	/** Switch the session root (isolated per Partner): rebuild repo/session and replay the new root's history. */
	setRoot(root: string): Promise<void>;
	appendUser(content: string, timestamp: number): Promise<void>;
	appendAssistant(meta: AssistantMeta, timestamp: number): Promise<void>;
	appendSendMessage(content: string, details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** Persist the current system prompt (custom entry; the trajectory view shows it). */
	appendSystemPrompt(text: string, timestamp: number): Promise<void>;
	/** Persist a system reminder (custom entry; part of the trajectory timeline). */
	appendReminder(text: string, timestamp: number): Promise<void>;
	/** Records visible to the frontend (user + send_message), in session order; active root unless a dir is given. */
	visibleHistory(dir?: string): Promise<VisibleItem[]>;
	/** The last visible message (user or send_message), or null for an empty session; active root unless a dir is given. */
	lastMessage(dir?: string): Promise<VisibleItem | null>;
	/** The full conversation chain (for agent context restore); active root unless a dir is given. */
	restoreMessages(dir?: string): Promise<AgentMessage[]>;
	/** Fold the session log into the model-visible surface (active root unless a dir is given). */
	surface(dir?: string): Promise<Surface>;
	/** Project the surface into the pi message chain the model sees (active root unless a dir is given). */
	deriveMessages(dir?: string): Promise<AgentMessage[]>;
	/** Record a surface replace (compaction checkpoint) as an append-only `surface_op` log entry. */
	appendSurfaceOp(op: SurfaceOpRecord, timestamp: number): Promise<void>;
	/** Persist a compaction summary (custom entry; becomes the replacement checkpoint node). Returns its pi entry id. */
	appendCompactionSummary(text: string, timestamp: number): Promise<string>;
	/** Persist a compaction transaction marker (compaction/start | compaction/end; log-only). */
	appendCompactionRecord(type: "compaction/start" | "compaction/end", details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** Persist a request header (system prompt + resolved tool names) so every model request is reconstructable (invariant 1). */
	appendRequestHeader(systemPrompt: string, toolNames: string[], timestamp: number): Promise<void>;
	/** Fork the log into a new root (raw JSONL copy); the surface re-folds there (fork/restore). */
	forkTo(sourceDir: string, targetDir: string): Promise<void>;
	/** Drop a cached root state (partner deletion: a recreated same-name partner must start empty, not replay the old in-memory session). */
	evictRoot(dir: string): void;
	/** Raw pi entries (for trajectory folding; thinking/tool content still never enters visibleHistory); active root unless a dir is given. */
	rawEntries(dir?: string): Promise<Entry[]>;
}

const SEND_MESSAGE_PROJECTOR = (entry: CustomEntry): AgentMessage[] | undefined => {
	const data = entry.data as { text: string; timestamp: number } | undefined;
	if (!data) return undefined;
	return [
		{
			role: "custom",
			customType: "send_message",
			content: data.text,
			display: true,
			timestamp: data.timestamp,
		},
	];
};

/** One open session repo per root directory (sessions isolated per Partner). */
interface RootState {
	repo: JsonlSessionRepo;
	session: Session;
	entries: Entry[];
}

export function createSessionStore(root: string = DATABASE_ROOT): SessionStore {
	// pi's JSONL backend needs a FileSystem adapter; reuse the execution environment directly (pure fs part)
	// Multiple roots stay open at once: while a partner's run is in flight the active (append) root is
	// pinned to that partner, but the view still reads other partners' sessions by dir.
	const roots = new Map<string, RootState>();
	let activeRoot = root;
	let opened = false;

	async function openRoot(newRoot: string): Promise<RootState> {
		const cached = roots.get(newRoot);
		if (cached) return cached;
		const repo = new JsonlSessionRepo({ fs: createExecutionEnv(newRoot), sessionsRoot: newRoot });
		const sessions = await repo.list();
		// Single continuous session: take the newest
		const session = sessions.length > 0 ? await repo.open(sessions[sessions.length - 1]) : await repo.create({ cwd: PROJECT_ROOT });
		const state: RootState = { repo, session, entries: [] };
		roots.set(newRoot, state);
		await refreshEntries(state);
		return state;
	}

	async function ensureOpen() {
		if (opened) return;
		await openRoot(activeRoot);
		opened = true;
	}

	async function active(): Promise<RootState> {
		await ensureOpen();
		return roots.get(activeRoot)!;
	}

	async function stateFor(dir?: string): Promise<RootState> {
		return dir && dir !== activeRoot ? openRoot(dir) : active();
	}

	async function refreshEntries(state: RootState) {
		const leafId = await state.session.getLeafId();
		// findEntriesOnBranch returns leaves first; reverse so the root comes first (session order)
		const walked = leafId ? await state.session.findEntriesOnBranch({ start: leafId }) : [];
		state.entries = walked.reverse();
	}

	async function appendMessage(message: AgentMessage) {
		const state = await active();
		await state.session.appendMessage(message);
		await refreshEntries(state);
	}

	return {
		async ready() {
			await ensureOpen();
		},
		async setRoot(newRoot: string) {
			activeRoot = newRoot;
			await openRoot(newRoot);
		},
		async appendUser(content, timestamp) {
			await appendMessage({ role: "user", content, timestamp });
		},
		async appendAssistant(meta, timestamp) {
			const state = await active();
			// Messages built by the pi loop may carry undefined fields (e.g. toolResult.details/usage),
			// which assertJsonSerializable would reject → recursively strip them before appending
			const assistant: AssistantMessage = {
				role: "assistant",
				content: stripUndefined(meta.blocks) as AssistantMessage["content"],
				timestamp,
				api: "",
				provider: "",
				model: "",
				usage: meta.usage ?? EMPTY_USAGE,
				stopReason: "stop",
			};
			await state.session.appendMessage(assistant);
			for (const result of meta.toolResults ?? []) {
				await state.session.appendMessage(stripUndefined(result) as ToolResultMessage);
			}
			await refreshEntries(state);
		},
		async appendSendMessage(content, details, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("send_message", { text: content, timestamp, ...details });
			await refreshEntries(state);
		},
		async appendSystemPrompt(text, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("system_prompt", { text, timestamp });
			await refreshEntries(state);
		},
		async appendReminder(text, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("system_reminder", { text, timestamp });
			await refreshEntries(state);
		},
		async visibleHistory(dir) {
			const state = await stateFor(dir);
			return state.entries.flatMap((entry): VisibleItem[] => {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					return [{ id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 }];
				}
				if (entry.type === "custom" && entry.customType === "send_message") {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) return [];
					return [{ id: entry.id, kind: "send_message", text: data.text, time: data.timestamp }];
				}
				return [];
			});
		},
		async lastMessage(dir) {
			const state = await stateFor(dir);
			// Entries are in session order; take the last visible one without materializing the whole history
			let last: VisibleItem | null = null;
			for (const entry of state.entries) {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					last = { id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 };
				} else if (entry.type === "custom" && entry.customType === "send_message") {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) continue;
					last = { id: entry.id, kind: "send_message", text: data.text, time: data.timestamp };
				}
			}
			return last;
		},
		async restoreMessages(dir) {
			const state = await stateFor(dir);
			const context = buildSessionContext(state.entries, {
				entryProjectors: { send_message: SEND_MESSAGE_PROJECTOR },
			});
			return dropDanglingTurn(context.messages);
		},
		async surface(dir) {
			const state = await stateFor(dir);
			return foldSurface(state.entries);
		},
		async deriveMessages(dir) {
			const state = await stateFor(dir);
			return deriveSurfaceMessages(state.entries, foldSurface(state.entries));
		},
		async appendSurfaceOp(op, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("surface_op", { ...op, timestamp });
			await refreshEntries(state);
		},
		async appendCompactionSummary(text, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("compaction_summary", { text, timestamp });
			await refreshEntries(state);
			const entry = state.entries.filter((e) => e.type === "custom" && e.customType === "compaction_summary").at(-1);
			if (!entry) throw new Error("compaction_summary append failed");
			return entry.id;
		},
		async appendCompactionRecord(type, details, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry(type, { ...details, timestamp });
			await refreshEntries(state);
		},
		async appendRequestHeader(systemPrompt, toolNames, timestamp) {
			const state = await active();
			await state.session.appendCustomEntry("request/header", { systemPrompt, toolNames, timestamp });
			await refreshEntries(state);
		},
		async forkTo(sourceDir, targetDir) {
			// Load the source first (validates it is a readable session root), then copy the whole log
			// tree (pi nests session files under a cwd-derived directory) and re-open the target so its
			// surface re-folds deterministically (fork/restore: log prefix boundary = the copied log).
			await openRoot(sourceDir);
			await cp(sourceDir, targetDir, { recursive: true, force: true, filter: (src) => !src.endsWith(".tmp") });
			await openRoot(targetDir);
		},
		evictRoot(dir) {
			roots.delete(dir);
			// Evicting the active root: the next operation re-opens it fresh (the dir may be gone;
			// re-creating the same-name partner re-creates it before any chat can start).
			if (dir === activeRoot) opened = false;
		},
		async rawEntries(dir) {
			const state = await stateFor(dir);
			return state.entries;
		},
	};
}

/** Recursively strip undefined (pi's assertJsonSerializable rejects undefined values). */
function stripUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripUndefined);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			if (child !== undefined) out[key] = stripUndefined(child);
		}
		return out;
	}
	return value;
}
