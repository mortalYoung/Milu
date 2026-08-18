import type { ElectrobunRPCSchema } from "electrobun";

/**
 * Trajectory records: an expanded view of the agent run (thinking / tool calls / results / token usage).
 * Folded on the bun side from persisted pi entries; the chat page only shows user/send_message,
 * the trajectory dialog shows everything. kind:
 * - user / message: visible message (carries the pi entry id, the view locates its trajectory segment by it);
 * - assistant: one LLM call (a turn), with thinking and usage;
 * - tool: one tool call; a missing result = interrupted.
 */
export type TrajectoryRecord =
	| { kind: "user"; seq: number; id: string; text: string; time: number }
	| { kind: "message"; seq: number; id: string; text: string; time: number }
	| {
			kind: "assistant";
			seq: number;
			turn: number;
			text?: string;
			thinking?: string;
			usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
			time: number;
	  }
	| {
			kind: "tool";
			seq: number;
			turn: number;
			callId: string;
			name: string;
			args: string;
			result?: { text: string; isError: boolean };
			time: number;
	  }
	| { kind: "system"; seq: number; text: string; time: number }
	| { kind: "reminder"; seq: number; text: string; time: number };

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
			/** Startup/refresh history: visible messages only (user + send_message). */
			history: {
				params: {};
				response: { items: { id: string; kind: "user" | "send_message"; text: string; time: number }[] };
			};
			/** Fetch agent status (view calibrates idle/working; fallback when a push was lost). */
			get_status: {
				params: {};
				response: { streaming: boolean; workspace_path: string | null; workspace_default: string; running_partner: string | null };
			};
			/** Context occupancy (used/window/percent + heuristic breakdown) for the composer meter. */
			context_usage: {
				params: {};
				response: ContextUsage;
			};
			/** Trajectory: the full process record (thinking/tools/usage), cached by the view; on message click the matching segment is fetched. */
			trajectory: {
				params: {};
				response: { records: TrajectoryRecord[] };
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
			/** Partner list (by creation time). */
			list_partners: {
				params: {};
				response: {
					partners: { name: string; responsibilities?: string; tones?: string; createdAt: number }[];
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
		};
	};
}>;
