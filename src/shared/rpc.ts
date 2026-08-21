import type { ElectrobunRPCSchema } from "electrobun";
import type { SurfaceNode } from "./surface";

/** File-effect sandbox mode (per partner; human-owned via the composer select). */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** Lifecycle of a sandbox escalation request as the transcript shows it: awaiting the human,
 * decided by the human, or orphaned (no live run awaits it — not actionable, no buttons). */
export type EscalationStatus = "pending" | "approved" | "rejected" | "dropped";

/**
 * Trajectory records: the complete origin-log timeline, one record per pi log entry.
 * Folded on the bun side from persisted pi entries; the trajectory drawer renders
 * every kind. Nothing is dropped at fold time: message blocks, usage, structural
 * entries (model_change / thinking_level_change / active_tools_change / compaction /
 * branch_summary) and every custom entry travel to the view verbatim.
 */
/** Common fields of every trajectory record (mirrors the pi Entry base). */
export interface TrajectoryBase {
	/** Position in log order. */
	seq: number;
	/** The pi entry id (reconstructable from the log). */
	entryId: string;
	/** Entry timestamp, ms since epoch. */
	time: number;
}

/** Token usage as reported by the provider (all pi usage fields retained). */
export interface TrajectoryUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	reasoning?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/**
 * One assistant content block (thinking / text / toolCall / image …), raw from the log.
 * Known fields are declared for the view; anything else stays reachable via the index signature.
 */
export interface TrajectoryBlock {
	type: string;
	/** thinking block payload. */
	thinking?: unknown;
	/** text block payload. */
	text?: unknown;
	/** toolCall block fields. */
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
	/** thinking block: safety-redaction flag + opaque signature. */
	redacted?: unknown;
	thoughtSignature?: unknown;
	[key: string]: unknown;
}

export type TrajectoryRecord =
	| (TrajectoryBase & { kind: "user"; content: string })
	| (TrajectoryBase & {
			kind: "assistant";
			/** One LLM call (a turn). */
			turn: number;
			/** All content blocks, verbatim: thinking, text, toolCall, image. */
			blocks: TrajectoryBlock[];
			api: string;
			provider: string;
			model: string;
			responseModel?: string;
			responseId?: string;
			usage?: TrajectoryUsage;
			stopReason: string;
			errorMessage?: string;
			rawStopReason?: string;
	  })
	| (TrajectoryBase & {
			kind: "toolResult";
			/** The turn whose assistant called the tool. */
			turn: number;
			toolCallId: string;
			toolName: string;
			content: string;
			details?: unknown;
			usage?: TrajectoryUsage;
			addedToolNames?: string[];
			isError: boolean;
	  })
	| (TrajectoryBase & { kind: "modelChange"; provider: string; modelId: string })
	| (TrajectoryBase & { kind: "thinkingLevel"; thinkingLevel: string })
	| (TrajectoryBase & { kind: "activeTools"; activeToolNames: string[] })
	| (TrajectoryBase & {
			kind: "compaction";
			summary: string;
			/** Count of the retained tail messages (their full text lives in the log's message entries). */
			retainedTailCount: number;
			tokensBefore: number;
			details?: unknown;
			usage?: TrajectoryUsage;
	  })
	| (TrajectoryBase & { kind: "branchSummary"; fromId: string; summary: string; details?: unknown; usage?: TrajectoryUsage })
	| (TrajectoryBase & { kind: "custom"; customType: string; data?: unknown });

/**
 * Whole-conversation usage totals (see stats): summed across every persisted assistant turn.
 * input = cache-miss prompt tokens (DeepSeek splits prompt into hit + miss), so the cache hit
 * rate is cacheRead / (input + cacheRead).
 */
export interface UsageTotals {
	/** Number of assistant turns carrying usage. */
	messages: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Session-wide metrics for the composer line: persisted usage totals + in-memory run timing. */
export interface SessionStats {
	usage: UsageTotals | null;
	runtime: {
		/** LLM calls streamed (cumulative across restarts). */
		runs: number;
		/** Average time to first text token (text-bearing turns only), ms; null before any. */
		avgTtftMs: number | null;
		/** Average output tokens/sec while streaming; null before any. */
		avgTps: number | null;
		/** Last turn's TTFT, ms; null before any. */
		lastTtftMs: number | null;
	};
}

/**
 * Raw runtime timing samples, persisted on disk (see runtime-stats.ts) so TTFT/tok-s metrics
 * survive restarts. The averages shown in SessionStats.runtime are derived from these samples.
 */
export interface RuntimeStatsSnapshot {
	/** LLM calls streamed (cumulative across restarts). */
	runs: number;
	/** Time-to-first-text-token samples (text-bearing turns only), ms. */
	ttfts: number[];
	/** Output tokens/sec samples. */
	speeds: number[];
	/** Last turn's TTFT, ms; null before any. */
	lastTtft: number | null;
	/** When the snapshot was last written to disk. */
	savedAt: number;
}

/**
 * Context occupancy of the current conversation (see context_usage).
 * used = the last assistant turn's provider-reported prompt size (input + cacheRead + cacheWrite, no output),
 * window = the routed model's contextWindow. Both are last-wins independent fields — the percent is a
 * deliberately approximate reference number, not an atomic observation.
 */
export interface ContextUsage {
	/** Provider-reported prompt size of the last turn; 0 before the first turn. */
	used: number;
	/** Model context window in tokens (e.g. 1_000_000 for deepseek-v4-flash). */
	window: number;
	/** min(100, round(used / window * 100)). */
	percent: number;
	/** Heuristic composition (4 chars ≈ 1 token; always labeled `~` in the UI), null when unavailable. */
	breakdown: { systemTokens: number; toolsTokens: number; messageTokens: number } | null;
	/** The last turn's full usage record; absent before the first turn (the meter stays hidden). */
	lastTurn?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
}

/**
 * Single source of truth for the app's RPC surface.
 *
 * Semantics (matching electrobun's defineElectrobunRPC):
 * - `bun.requests`    — methods the webview can call on the Bun process
 * - `bun.messages`    — fire-and-forget messages the webview can send to Bun
 * - `webview.requests`— methods Bun can call on the webview
 * - `webview.messages`— fire-and-forget messages Bun sends to the webview
 */

type __schema<S extends ElectrobunRPCSchema> = S;

export type AppRPCSchema = __schema<{
	bun: {
		requests: {
			/** Send a user prompt. If the agent is busy, it is queued as a follow-up (outer loop). */
			chat: {
				params: { text: string };
				response: { accepted: boolean; queued?: boolean };
			};
			/** Abort the current agent run. */
			stop: {
				params: {};
				response: { accepted: boolean };
			};
			/** Wipe the transcript and start a fresh issue. */
			reset: {
				params: {};
				response: { accepted: boolean };
			};
			/** Startup/refresh history: visible messages only (user, send_message, sandbox escalations). */
			history: {
				params: {};
				response: {
					items: {
						id: string;
						kind: "user" | "send_message" | "escalation";
						text: string;
						time: number;
						escalation?: {
							id: string;
							command: string;
							from: SandboxMode;
							to: SandboxMode;
							justification: string;
							status: EscalationStatus;
						};
					}[];
				};
			};
			/** Fetch agent status (view calibrates idle/working; fallback when a push was lost). */
			get_status: {
				params: {};
				response: { streaming: boolean; workspace_path: string | null; running_partner: string | null; sandbox_mode: SandboxMode };
			};
			/** Set the per-partner sandbox mode (persisted to <partnerDir>/sandbox.json). */
			set_sandbox_mode: {
				params: { mode: SandboxMode };
				response: { ok: boolean; error?: string };
			};
			/** Respond to a pending sandbox escalation request (view dialog → bun). */
			sandbox_respond: {
				params: { id: string; approved: boolean };
				response: { ok: boolean };
			};
			/** Context occupancy (used/window/percent + heuristic breakdown) for the composer meter. */
			context_usage: {
				params: {};
				response: ContextUsage;
			};
			/** Session-wide metrics: persisted usage totals + in-memory run timing (TTFT / tok/s). */
			stats: {
				params: {};
				response: SessionStats;
			};
			/** Trajectory: the full process record (thinking/tools/usage), cached by the view; on message click the matching segment is fetched. */
			trajectory: {
				params: {};
				response: { records: TrajectoryRecord[] };
			};
			/** The model-visible surface (nodes + replace generation) — observability for the surface layer. */
			surface: {
				params: {};
				response: { nodes: SurfaceNode[]; replaceGeneration: number };
			};
			/** Manually run compaction: rewrite the model-visible surface (the log stays append-only). */
			compact: {
				params: {};
				response: { ok: boolean; error?: string; compacted?: number };
			};
			/** Settings (partner profile path etc.) + runtime info (model / API key status). */
			get_settings: {
				params: {};
				response: {
					settings: { partner_profile_path: string };
					runtime: { model: string; apiKeyConfigured: boolean };
				};
			};
			update_settings: {
				params: { settings: { partner_profile_path: string } };
				response: { ok: boolean };
			};
			/** Partner list (by creation time), each with the last visible message for its list-row preview. */
			list_partners: {
				params: {};
				response: {
					partners: {
						name: string;
						responsibilities?: string;
						tones?: string;
						createdAt: number;
						/** Last visible message text (null when the chat is empty). */
						lastMessage?: string;
						/** Timestamp of the last visible message (null when the chat is empty). */
						lastMessageAt?: number;
						/** Who sent the last message — "user" (you) or "send_message" (the partner's reply). */
						lastMessageKind?: "user" | "send_message";
					}[];
				};
			};
			/** Create a Partner: validate name → <root>/<name>/profile.json. */
			create_partner: {
				params: {
					name: string;
					responsibilities?: string;
					tones?: string;
				};
				response: { ok: boolean; error?: string };
			};
			/** Switch the current Partner: name selects the session directory, the other fields rebuild the four-section system prompt. */
			set_partner: {
				params: {
					profile: { name: string; responsibilities?: string; tones?: string } | null;
				};
				response: { ok: boolean };
			};
			/** Compose a trial four-section system prompt (identify/tool-guidance shown read-only, for the create dialog preview). */
			preview_system_prompt: {
				params: {
					profile: { responsibilities?: string; tones?: string };
				};
				response: { prompt: string };
			};
			/** Delete a Partner: remove its profile directory. */
			delete_partner: {
				params: { name: string };
				response: { ok: boolean; error?: string };
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			/** A new turn began (one LLM call + tool executions) — typing indicator; partner = the run's owner (null when unknown). */
			agent_turn: { turn: number; partner: string | null };
			/** A visible message was persisted via send_message — view refetches history. */
			agent_message: {};
			/** A turn has been persisted (trajectory has new data); the view invalidates its cache and refetches. */
			trajectory_update: {};
			/** The workspace was set via set_workspace; the view refetches status to show it near the input. */
			workspace_update: {};
			/** The run settled. error is set when the run failed (e.g. missing API key). */
			agent_end: { error?: string };
			/** The sandbox mode changed (composer select / partner switch); the view refetches status. */
			sandbox_mode_update: {};
			/** An escalation record was persisted (request or decision); the view refetches history. */
			escalation_update: {};
		};
	};
}>;
