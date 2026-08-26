import type { ElectrobunRPCSchema } from "electrobun";
import type { ThemeMode } from "../bun/lib/settings";
import type { SandboxMode } from "../bun/permission/types";
import type { SurfaceNode } from "./surface";

export type { SandboxMode, ThemeMode };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Lifecycle of a sandbox escalation request as the transcript shows it: awaiting the human,
 * decided by the human, or orphaned (no live run awaits it — not actionable, no buttons). */
export type EscalationStatus = "pending" | "approved" | "rejected" | "dropped";

/** A tool definition as sent to the provider (persisted with request/header for observability). */
export interface RequestTool {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
}

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
				// accepted=false when no partner is selected; a busy agent queues the message as its own follow-up
				response: { accepted: boolean };
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
						kind: "user" | "send_message" | "escalation" | "error" | "aborted";
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
				response: {
					/** The selected chat's workspace / sandbox (each partner runs its own agent). */
					workspace_path: string | null;
					/** The selected chat's storage dir (the agent's own directory; full access, sensitive files allowed). */
					storage_path: string | null;
					sandbox_mode: SandboxMode;
					/** The selected partner's model selection (null → deepseek default). */
					model: { provider: string; modelId?: string } | null;
					thinking_level: ThinkingLevel;
					thinking_levels: ThinkingLevel[];
					/** Catalog models of every added provider (the composer's grouped select). */
					models: { provider: string; models: { id: string; name: string }[] }[];
					/** Per-partner view-facing streaming (escalation-paused runs read idle) — drives the list dots. */
					partners: { name: string; streaming: boolean }[];
				};
			};
			/** Set the per-partner sandbox mode (persisted to <partnerDir>/sandbox.json). */
			set_sandbox_mode: {
				params: { mode: SandboxMode };
				response: { ok: boolean; error?: string };
			};
			/** Set the per-partner model selection (persisted to <partnerDir>/model.json). */
			set_partner_model: {
				params: { model: { provider: string; modelId?: string } };
				response: { ok: boolean; error?: string };
			};
			set_thinking_level: {
				params: { level: ThinkingLevel };
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
				params: { name: string };
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
			/** Settings (partner profile path, detected instructions file, default sandbox mode) + runtime info (model / API key status). */
			get_settings: {
				params: {};
				response: {
					settings: {
						partner_profile_path: string;
						detect_instructions_file: string;
						/** The Permission setting: default sandbox mode for newly created partners. */
						defaultSandboxMode?: SandboxMode;
						providers?: string[];
						/** UI theme (system/light/dark) — the view applies it to color-scheme. */
						theme?: ThemeMode;
					};
					runtime: {
						/** Every added provider with its key-configured state (keys never leave bun). */
						providers: { id: string; configured: boolean }[];
						/** Every built-in provider id (the add-provider dropdown). */
						allProviders: string[];
					};
				};
			};
			update_settings: {
				params: {
					settings: {
						partner_profile_path: string;
						detect_instructions_file: string;
						/** The Permission setting: default sandbox mode for newly created partners. */
						defaultSandboxMode?: SandboxMode;
						providers?: string[];
						/** UI theme (system/light/dark) — the view applies it to color-scheme. */
						theme?: ThemeMode;
					};
					/** Provider → api key for any provider the user edited this save (non-empty values only). */
					credentials?: Record<string, string>;
				};
				response: { ok: boolean; error?: string };
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
				response: {
					ok: boolean;
					error?: string;
					/** The created profile (present when ok) — returned so the view can select it without re-listing. */
					profile?: {
						name: string;
						responsibilities?: string;
						tones?: string;
						createdAt: number;
					};
				};
			};
			/** Switch the current Partner: name selects the session directory, the other fields rebuild the four-section system prompt. */
			set_partner: {
				params: {
					profile: { name: string; responsibilities?: string; tones?: string } | null;
				};
				response: { ok: boolean };
			};
			/** Delete a Partner: remove its profile directory. */
			delete_partner: {
				params: { name: string };
				response: { ok: boolean; error?: string };
			};
		};
		messages: {
			/** The view's per-load timing report for history (RPC round-trip + render loop) — logged by bun to the terminal. */
			history_timing: {
				/** Partner whose history was loaded. */
				partner: string;
				/** View-side wall time of the history RPC round-trip, ms. */
				rpcMs: number;
				/** View-side wall time of the batch-build loop (no signal writes), ms. */
				buildMs: number;
				/** View-side wall time of the single commit render (setEntries + bump), ms. */
				renderMs: number;
				/** Number of visible items returned. */
				items: number;
			};
		};
	};
	webview: {
		requests: {};
		messages: {
			/** A new turn began (one LLM call + tool executions) — typing indicator; partner = the run's owner. */
			agent_turn: { turn: number; partner: string };
			/** A visible message was persisted via send_message — view refetches history. */
			agent_message: {};
			/** A turn has been persisted (trajectory has new data); the view invalidates its cache and refetches. */
			trajectory_update: {};
			/** The workspace was set via set_workspace; the view refetches status to show it near the input. */
			workspace_update: {};
			/** The run settled. error is set when the run failed (e.g. missing API key); partner = the run's owner. */
			agent_end: { error?: string; partner: string };
			/** The sandbox mode changed (composer select / partner switch); the view refetches status. */
			sandbox_mode_update: {};
			thinking_level_update: {};
			/** An escalation record was persisted (request or decision); the view refetches history. */
			escalation_update: {};
		};
	};
}>;
