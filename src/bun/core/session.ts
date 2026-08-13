/**
 * 对话持久化:基于 pi 的 JSONL 会话层(JsonlSessionRepo + Session)。
 *
 * - 单会话连续:打开 repo 中最新会话,不存在则创建;同一会话持续追加
 * - 全量入库:user / assistant(thinking、tool_use 块原文)/ toolResult /
 *   send_message 自定义条目;前端只可见 user 与 send_message
 * - 恢复:buildSessionContext + entryProjectors 还原 AgentMessage 链
 *   (pi 的 JSONL 后端自带追加式写入与 torn-write 修复)
 */
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { createExecutionEnv } from "../tools/execution-env";
import { DATABASE_ROOT, PROJECT_ROOT } from "./config";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * send_message 可见消息:作为自定义消息进 agent 上下文,
 * convertToLlm 投影为可见文本;display:false 的丢弃。
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
	/** pi entry id,视图按它去重增量渲染。 */
	id: string;
	kind: "user" | "send_message";
	text: string;
	time: number;
}

export interface SessionStore {
	/** 打开/恢复完成(可在首次操作前 await)。 */
	ready(): Promise<void>;
	appendUser(content: string, timestamp: number): Promise<void>;
	appendAssistant(meta: AssistantMeta, timestamp: number): Promise<void>;
	appendSendMessage(content: string, details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** 前端可见记录(user + send_message),按会话顺序。 */
	visibleHistory(): VisibleItem[];
	/** 完整对话链(agent 上下文恢复用)。 */
	restoreMessages(): Promise<AgentMessage[]>;
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

export function createSessionStore(root: string = DATABASE_ROOT): SessionStore {
	// pi 的 JSONL 后端需要 FileSystem 适配器;直接复用执行环境(纯 fs 部分)
	const repo = new JsonlSessionRepo({ fs: createExecutionEnv(root), sessionsRoot: root });
	let session: Session | null = null;
	let entries: Entry[] = [];
	let opened = false;

	async function ensureOpen() {
		if (opened) return;
		const sessions = await repo.list();
		if (sessions.length > 0) {
			// 单会话连续:取最新
			session = await repo.open(sessions[sessions.length - 1]);
		} else {
			// cwd = 项目根:目录名即 pi 标准布局 --Users-xiuneng-Projects-coding-desktop--
			session = await repo.create({ cwd: PROJECT_ROOT });
		}
		await refreshEntries();
		opened = true;
	}

	async function refreshEntries() {
		const leafId = await session!.getLeafId();
		// findEntriesOnBranch 叶子在前;翻转成根在前(会话顺序)
		const walked = leafId ? await session!.findEntriesOnBranch({ start: leafId }) : [];
		entries = walked.reverse();
	}

	async function appendMessage(message: AgentMessage) {
		await ensureOpen();
		await session!.appendMessage(message);
		await refreshEntries();
	}

	return {
		async ready() {
			await ensureOpen();
		},
		async appendUser(content, timestamp) {
			await appendMessage({ role: "user", content, timestamp });
		},
		async appendAssistant(meta, timestamp) {
			await ensureOpen();
			// pi 循环构造的消息可能带 undefined 字段(如 toolResult.details/usage),
			// assertJsonSerializable 会拒绝 → 追加前递归剥离
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
			await session!.appendMessage(assistant);
			for (const result of meta.toolResults ?? []) {
				await session!.appendMessage(stripUndefined(result) as ToolResultMessage);
			}
			await refreshEntries();
		},
		async appendSendMessage(content, details, timestamp) {
			await ensureOpen();
			await session!.appendCustomEntry("send_message", { text: content, timestamp, ...details });
			await refreshEntries();
		},
		visibleHistory(): VisibleItem[] {
			return entries.flatMap((entry): VisibleItem[] => {
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
		async restoreMessages(): Promise<AgentMessage[]> {
			await ensureOpen();
			const context = buildSessionContext(entries, {
				entryProjectors: { send_message: SEND_MESSAGE_PROJECTOR },
			});
			return dropDanglingTurn(context.messages);
		},
	};
}

/** 递归剥离 undefined(pi 的 assertJsonSerializable 会拒绝 undefined 值)。 */
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

/**
 * 末尾未完成回合保护:最后一条 assistant 含 toolCall 块但缺对应 toolResult
 * (重启中断场景) → 丢弃该回合。
 */
function dropDanglingTurn(messages: AgentMessage[]): AgentMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (!hasToolCalls) break;
		const next = messages[i + 1];
		const complete = next != null && next.role === "toolResult" && (next as ToolResultMessage).toolCallId === blocks.find((b) => b.type === "toolCall")?.id;
		if (complete) break;
		messages.splice(i);
		break;
	}
	return messages;
}
