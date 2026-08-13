/**
 * 工具装配:标准 pi 工具(read/write/edit/bash,绑定执行环境)+ send_message。
 * send_message 是 agent 触达用户的唯一通道(持久化 + 上下文 + RPC 信号)。
 */
import type { AgentHarnessTool, AgentTool, ExecutionEnv, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import { PROJECT_ROOT } from "../core/config";
import type { SessionStore } from "../core/session";
import { createExecutionEnv } from "./execution-env";

// 工具的工作目录 = 项目根(与会话 cwd 一致;prompt 的 Context 由此成立)
const env = createExecutionEnv(PROJECT_ROOT);

export interface ToolDeps {
	/** 对话持久化存储。 */
	store: SessionStore;
	/** send_message 时:把可见消息写入 agent 上下文(display:true 自定义消息)。 */
	onVisibleMessage: (text: string, timestamp: number) => void;
}

const sendMessageSchema = Type.Object({ message: Type.String() });

const sendMessageTool = (deps: ToolDeps): AgentTool<typeof sendMessageSchema> => ({
	name: "send_message",
	label: "Send Message",
	description: "Send a visible message to the user. The user can only see what you send through this tool — call it to reply, report progress, or ask questions.",
	parameters: sendMessageSchema,
	async execute(_toolCallId, { message }) {
		const timestamp = Date.now();
		await deps.store.appendSendMessage(message, { toolCallId: _toolCallId }, timestamp);
		deps.onVisibleMessage(message, timestamp);
		return { content: [{ type: "text", text: "sent" }], details: { sent: true, text: message } };
	},
});

/** The standard pi toolset (read, write, edit, bash) + send_message. */
export function createTools(deps: ToolDeps): AgentTool[] {
	return [bindEnv(createReadTool(), env), bindEnv(createWriteTool(), env), bindEnv(createEditTool(), env), bindEnv(createBashTool(), env), sendMessageTool(deps)];
}

/**
 * Bind the ExecutionEnv context into a harness tool, turning it into a
 * plain `AgentTool` the double loop can execute.
 */
function bindEnv<TParameters extends TSchema, TDetails>(tool: AgentHarnessTool<ExecutionToolContext, TParameters, TDetails>, env: ExecutionEnv): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute(toolCallId, params, signal, onUpdate) {
			return tool.execute(toolCallId, params, signal, onUpdate, { env });
		},
	};
}
