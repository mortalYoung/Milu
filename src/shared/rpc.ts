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
			/** 拉取 agent 状态(视图校准 idle/working,推送丢失兜底)。 */
			get_status: {
				params: {};
				response: { streaming: boolean };
			};
			/** Settings(partner 档案路径等)+ 运行时信息(模型/API 密钥状态)。 */
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
			/** Partner 列表(按创建时间)。 */
			list_partners: {
				params: {};
				response: {
					partners: { name: string; avatar?: string; role?: string; responsibilities?: string; tones?: string; createdAt: number }[];
				};
			};
			/** 创建 Partner:校验 name + role(必填)→ <root>/<name>/profile.json。 */
			create_partner: {
				params: {
					name: string;
					avatar?: string;
					role: string;
					responsibilities?: string;
					tones?: string;
				};
				response: { ok: boolean; error?: string };
			};
			/** 切换当前 Partner:name 用于会话目录,其余字段重建四段系统提示词。 */
			set_partner: {
				params: {
					profile: { name: string; role?: string; responsibilities?: string; tones?: string } | null;
				};
				response: { ok: boolean };
			};
			/** 试拼四段系统提示词(identify/tool-guidance 只读展示,供新建弹窗预览)。 */
			preview_system_prompt: {
				params: {
					profile: { role?: string; responsibilities?: string; tones?: string };
				};
				response: { prompt: string };
			};
			/** 删除 Partner:移除其档案目录。 */
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
			/** A new turn began (one LLM call + tool executions) — typing indicator. */
			agent_turn: { turn: number };
			/** A visible message was persisted via send_message — view refetches history. */
			agent_message: {};
			/** The run settled. error is set when the run failed (e.g. missing API key). */
			agent_end: { error?: string };
		};
	};
}>;
