/**
 * Tool assembly: the standard pi tools (read/write/edit/bash, bound to the execution environment) + send_message.
 * send_message is the agent's only channel to reach the user (persistence + context + RPC signal).
 */
import type { AgentHarnessTool, AgentTool, ExecutionEnv, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import { PROJECT_ROOT } from "../core/config";
import type { SessionStore } from "../core/session";
import { createExecutionEnv, type EnvGuard } from "./execution-env";

export interface ToolDeps {
	/** Conversation persistence store. */
	store: SessionStore;
	/** On send_message: write the visible message into the agent context (a display:true custom message). */
	onVisibleMessage: (text: string, timestamp: number) => void;
	/** Path guard: workspace/storage roots for the file tools (null = unset). */
	guard?: EnvGuard;
	/** set_workspace: validate + apply; returns an error message or null on success. */
	onSetWorkspace?: (workspace: string) => string | null;
}

const sendMessageSchema = Type.Object({
	message: Type.String({ description: "The message supports Markdown" }),
});

const sendMessageTool = (deps: ToolDeps): AgentTool<typeof sendMessageSchema> => ({
	name: "send_message",
	label: "Send Message",
	description:
		"Send a visible message to the user. The user can only see what you send through this tool. Do not call it on your own initiative — call it only when the harness explicitly instructs you to (a <system_reminder> asking you to send a message). Markdown is supported: **bold**, `code`, lists, links.",
	parameters: sendMessageSchema,
	async execute(_toolCallId, { message }) {
		const timestamp = Date.now();
		await deps.store.appendSendMessage(message, { toolCallId: _toolCallId }, timestamp);
		deps.onVisibleMessage(message, timestamp);
		return {
			content: [{ type: "text", text: "sent" }],
			details: { sent: true, text: message },
		};
	},
});

/**
 * Tool usage guidance table: one "how to use this tool correctly" entry per tool,
 * dynamically inserted into the TOOL-GUIDANCE section by the prompt builder. Tools not in this
 * table fall back to a name — description list in the prompt.
 */
export const TOOL_GUIDANCE: Record<string, string> = {
	read: "Use the read tool — not shell commands like cat — to inspect text files; it reads the exact path you give, line-numbered for precision.",
	write: "Use the write tool to create or overwrite whole files; prefer edit for targeted changes to existing files.",
	edit: "Use the edit tool for targeted changes inside existing files — smaller diffs than rewriting the whole file and harder to corrupt. Never rewrite a file wholesale when an edit suffices.",
	bash: "Check the [exit code: N] marker on every bash result; investigate failures before moving on. Prefer read/write/edit over shell for file inspection and changes.",
	send_message:
		"The user only sees what you deliver through send_message — plain text replies are never shown. Do not call it on your own initiative: call it only when the harness instructs you to via a system reminder. You can use Markdown (**bold**, `code`, lists, links) to format your message.",
};

const workspaceSchema = Type.Object({
	workspace: Type.String({ description: "Absolute path of the working directory — usually the project root of the code or project the user is asking about" }),
});

/** set_workspace: establish the task's working directory (once per conversation). */
function setWorkspaceTool(deps: ToolDeps): AgentTool<typeof workspaceSchema> {
	return {
		name: "set_workspace",
		label: "Set Workspace",
		description:
			"Set the working directory of this conversation to an absolute path — the project root of the current task. Only needed when the task actually touches files or paths (read/write/edit, or shell commands that reference the project); conversation-only turns can skip it. When needed, call it first, before other tools. Can only be called once per conversation; afterwards, relative paths resolve against it.",
		parameters: workspaceSchema,
		// Sequential: the workspace switch must apply to sibling tool calls of the same batch, so the model
		// listing set_workspace first makes it run before the tools that use it (parallel would race them)
		executionMode: "sequential",
		async execute(_toolCallId, { workspace }) {
			if (!deps.onSetWorkspace) {
				return { content: [{ type: "text", text: "set_workspace is not available" }], details: { ok: false } };
			}
			const error = deps.onSetWorkspace(workspace);
			if (error) {
				return { content: [{ type: "text", text: `Error: ${error}` }], details: { ok: false, error } };
			}
			return { content: [{ type: "text", text: `Workspace set to ${workspace}` }], details: { ok: true, workspace } };
		},
	};
}

/** The standard pi toolset (read, write, edit, bash) + send_message + set_workspace, bound to the path-guarded env. */
export function createTools(deps: ToolDeps): AgentTool[] {
	// The env is created per toolset so it can carry the path guard (workspace/storage roots, read dynamically)
	const env = createExecutionEnv(PROJECT_ROOT, deps.guard);
	return [
		bindEnv(createReadTool(), env),
		bindEnv(createWriteTool(), env),
		bindEnv(createEditTool(), env),
		bindEnv(createBashTool(), env),
		sendMessageTool(deps),
		setWorkspaceTool(deps),
	];
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
