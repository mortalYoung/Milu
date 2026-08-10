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
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			/** Streaming text delta of the assistant reply. */
			agent_delta: { text: string };
			/** A tool started/stopped executing (inner loop). */
			agent_tool: { name: string; status: "start" | "end" };
			/** A new turn began (one LLM call + tool executions). */
			agent_turn: { turn: number };
			/** The run settled. error is set when the run failed (e.g. missing API key). */
			agent_end: { error?: string };
		};
	};
}>;
