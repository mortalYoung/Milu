/**
 * Tool assembly: the standard pi tools (read/write/edit/bash, bound to the execution environment) + send_message.
 * send_message is the agent's only channel to reach the user (persistence + context + RPC signal).
 */
import type { AgentHarnessTool, AgentTool, ExecutionEnv, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import { PROJECT_ROOT } from "../core/config";
import type { SessionScope } from "../persist";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "../sandbox/types";
import { createExecutionEnv, type EnvGuard, type SandboxedExecOptions, type SandboxRuntime } from "./execution-env";

export interface ToolDeps {
	/** Conversation persistence, scoped to the owning agent's session root. */
	store: SessionScope;
	/** On send_message: write the visible message into the agent context (a display:true custom message). */
	onVisibleMessage: (text: string, timestamp: number) => void;
	/** Path guard: workspace/storage roots for the file tools (null = unset). */
	guard?: EnvGuard;
	/** Sandbox runtime (mounted on macOS); absent ⇒ bash + fs run unconfined. */
	sandbox?: SandboxRuntime;
	/** Human approval gate for escalation retries (wired to escalation records + the inline transcript bubble). */
	confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
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

/** Strictly-wider ordering for escalation: read-only < workspace-write < danger-full-access. */
const MODE_RANK: Record<SandboxMode, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
function isStrictlyWider(from: SandboxMode, to: SandboxMode): boolean {
	return MODE_RANK[to] > MODE_RANK[from];
}

/** Tail-truncate output the way pi's bash tool does (last ~50KB). */
const MAX_OUTPUT_CHARS = 50 * 1024;
function tail(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
	return { text: `…${text.slice(-MAX_OUTPUT_CHARS)}`, truncated: true };
}

/** Run a bash command through the sandboxed env; surfaces sandbox denials in stderr via exec's marker. */
async function runBash(
	env: ExecutionEnv,
	command: string,
	options: { timeout?: number; abortSignal?: AbortSignal; sandboxMode?: SandboxMode },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const opts: SandboxedExecOptions = { timeout: options.timeout, abortSignal: options.abortSignal, sandboxMode: options.sandboxMode };
	const result = await env.exec(command, opts);
	if (!result.ok) {
		if (result.error.code === "aborted") throw new Error("Command aborted");
		if (result.error.code === "timeout") throw new Error(`Command timed out after ${options.timeout} seconds`);
		throw new Error(result.error.message); // spawn_error / sandbox unavailable
	}
	return result.value;
}

type BashDetails = {
	exitCode?: number;
	truncated?: boolean;
	sandbox?: { mode?: SandboxMode; rejected?: boolean; from?: SandboxMode; to?: SandboxMode; escalation?: boolean };
};

/**
 * Bash tool (custom, replaces pi's): same contract, plus capability-gated escalation.
 * When a sandbox runtime is mounted, the schema gains `sandbox_mode` + `justification`;
 * a retry with a strictly wider mode pauses on the human approval gate before executing.
 */
function bashTool(deps: ToolDeps): AgentHarnessTool<ExecutionToolContext, TSchema, BashDetails> {
	const baseProps = {
		command: Type.String({ description: "Bash command to execute" }),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	};
	const schema = deps.sandbox
		? Type.Object({
				...baseProps,
				sandbox_mode: Type.Optional(
					Type.Union([Type.Literal("read-only"), Type.Literal("workspace-write"), Type.Literal("danger-full-access")], {
						description: "Request a strictly wider sandbox mode for THIS call only (one retry per turn; human approval required).",
					}),
				),
				justification: Type.Optional(Type.String({ description: "Required when sandbox_mode is set: why the wider permission is needed." })),
			})
		: Type.Object(baseProps);
	return {
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr (last ~50KB, truncated)." +
			(deps.sandbox
				? " Sandboxed: writes outside the workspace/storage are denied by the kernel and return `[sandbox: file access denied under <mode> mode]`. On a denial you may retry ONCE in the same turn with a strictly wider `sandbox_mode` plus a `justification` — a human must approve."
				: ""),
		parameters: schema,
		async execute(toolCallId, params, signal, _onUpdate, context) {
			const { command, timeout, sandbox_mode, justification } = params as { command: string; timeout?: number; sandbox_mode?: SandboxMode; justification?: string };
			// escalation: validate wider + justification, then wait for the human gate
			let grantedMode: SandboxMode | undefined;
			if (sandbox_mode) {
				if (!deps.sandbox || !deps.confirmEscalation) {
					return { content: [{ type: "text", text: "[sandbox: escalation unavailable — no confining backend mounted]" }], details: { sandbox: { escalation: false } } };
				}
				const from = deps.sandbox.getMode();
				if (!isStrictlyWider(from, sandbox_mode)) {
					return {
						content: [{ type: "text", text: `[sandbox: escalation rejected — ${sandbox_mode} is not strictly wider than ${from}]` }],
						details: { sandbox: { rejected: true, from, to: sandbox_mode } },
					};
				}
				if (!justification) {
					return {
						content: [{ type: "text", text: "[sandbox: escalation rejected — justification is required]" }],
						details: { sandbox: { rejected: true, from, to: sandbox_mode } },
					};
				}
				const decision = await deps.confirmEscalation({ command, from, to: sandbox_mode, justification, toolCallId });
				if (!decision.approved) {
					return { content: [{ type: "text", text: `[sandbox: escalation rejected — ${decision.reason}]` }], details: { sandbox: { rejected: true, from, to: sandbox_mode } } };
				}
				grantedMode = decision.mode;
			}
			// execute through the sandboxed env
			const { env } = context;
			try {
				const { stdout, stderr, exitCode } = await runBash(env, command, { timeout, abortSignal: signal, sandboxMode: grantedMode });
				const out = tail([stdout, stderr].filter((s) => s).join("\n"));
				let text = out.text || "(no output)";
				if (exitCode !== 0 && exitCode !== undefined) text += `\n\nCommand exited with code ${exitCode}`;
				return {
					content: [{ type: "text", text }],
					details: {
						exitCode,
						truncated: out.truncated,
						sandbox: deps.sandbox ? { mode: grantedMode ?? deps.sandbox.getMode() } : undefined,
					},
				};
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return { content: [{ type: "text", text: message }], details: { sandbox: deps.sandbox ? { mode: grantedMode ?? deps.sandbox.getMode() } : undefined } };
			}
		},
	};
}

/**
 * Execute an approved escalation command outside a live agent run (restart-resume path):
 * a fresh env confined under the granted mode, output shaped exactly like the bash tool's.
 */
export async function runEscalatedBash(
	command: string,
	mode: SandboxMode,
	deps: { guard: EnvGuard; sandbox: SandboxRuntime },
): Promise<{ text: string; exitCode?: number; truncated: boolean }> {
	const env = createExecutionEnv(PROJECT_ROOT, deps.guard, deps.sandbox);
	const { stdout, stderr, exitCode } = await runBash(env, command, { sandboxMode: mode });
	const out = tail([stdout, stderr].filter((s) => s).join("\n"));
	let text = out.text || "(no output)";
	if (exitCode !== 0 && exitCode !== undefined) text += `\n\nCommand exited with code ${exitCode}`;
	return { text, exitCode, truncated: out.truncated };
}

/** The standard pi toolset (read, write, edit, bash) + send_message + set_workspace, bound to the path-guarded, sandboxed env. */
export function createTools(deps: ToolDeps): AgentTool[] {
	// The env is created per toolset so it can carry the path guard (workspace/storage roots, read dynamically)
	const env = createExecutionEnv(PROJECT_ROOT, deps.guard, deps.sandbox);
	return [
		bindEnv(createReadTool(), env),
		bindEnv(createWriteTool(), env),
		bindEnv(createEditTool(), env),
		bindEnv(bashTool(deps), env),
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
