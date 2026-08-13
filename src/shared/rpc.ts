import type { ElectrobunRPCSchema } from "electrobun";

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
			/** Startup/refresh history: visible messages only (user + send_message). */
			history: {
				params: {};
				response: { items: { id: string; kind: "user" | "send_message"; text: string; time: number }[] };
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			/** A new turn began (one LLM call + tool executions) — typing indicator. */
			agent_turn: { turn: number };
			/** A visible message was persisted via send_message — view refetches history. */
			agent_message: {};
			/** The run settled. error is set when the run failed (e.g. missing API key). */
			agent_end: { error?: string };
		};
	};
}>;
