import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ElectrobunRPCSchema } from "electrobun/main";
import type { CustomModel, CustomProvider, ThemeMode, ToastPlacement } from "../bun/lib/settings";
import type { McpConfig, McpLifecycle, McpServerConfig } from "../bun/mcp/types";
import type { SandboxMode } from "../bun/permission/types";

export type { CustomModel, CustomProvider, SandboxMode, ThemeMode, ToastPlacement };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CommandKind = "execute" | "leadingInput" | "popupSelect";

export type ChatPreviewKind = "user" | "send_message" | "command" | "skill" | "shell";

export type ExplorerRoot = "workspace" | "storage";

export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChangeItem {
	path: string;
	status: GitChangeStatus;
	staged: boolean;
	untracked?: boolean;
}

export interface ExplorerEntry {
	name: string;
	path: string;
	kind: "dir" | "file" | "link" | "other";
	size?: number;
	mtime?: number;
	ignored?: boolean;
	realPath?: string;
	linkKind?: "dir" | "file" | "other";
	linkTarget?: string;
}

export interface CommandDescriptor {
	name: string;
	description: string;
	kind: CommandKind;
	category?: "command" | "skill";

	hint?: string;
}

export interface CommandResult {
	kind: "success" | "error";
	text?: string;
}

export interface CommandExecution {
	ok: boolean;
	error?: string;
	commandId?: string;
	result?: CommandResult;
}

export interface CommandHistoryItem {
	commandId: string;
	name: string;
	args?: string;

	status: "running" | "success" | "error" | "interrupted";
	text?: string;
}

/** One row of the user-facing chat view (the View projection of Origin). */
export interface ViewItem {
	id: string;
	kind: "user" | "send_message" | "escalation" | "error" | "aborted" | "command" | "skill" | "shell";
	text: string;
	time: number;
	skillName?: string;
	escalation?: {
		id: string;
		command: string;
		from: SandboxMode;
		to: SandboxMode;
		justification: string;
		status: EscalationStatus;
	};
	command?: CommandHistoryItem;
	skill?: CommandHistoryItem;
}

export interface SkillDescriptor {
	name: string;
	description: string;
	whenToUse?: string;
	scope: "project" | "global";
	userInvocable: boolean;
}

export interface GlobalSkillDescriptor {
	name: string;
	description: string;
	path?: string;
	grantedPartners: string[];
}

export type EscalationStatus = "pending" | "approved" | "rejected" | "dropped";

export interface RequestTool {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
}

export interface BtwMessageRpc {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
}

export interface BtwThreadRpc {
	id: string;
	anchorEntryId: string;
	createdAt: number;
	updatedAt: number;
	messages: BtwMessageRpc[];
}

export interface TrajectoryBase {
	seq: number;

	entryId: string;

	time: number;

	sliceMessage?: AgentMessage;
}

export interface TrajectoryUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	reasoning?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface TrajectoryBlock {
	type: string;

	thinking?: unknown;

	text?: unknown;

	id?: unknown;
	name?: unknown;
	arguments?: unknown;

	redacted?: unknown;
	thoughtSignature?: unknown;
	[key: string]: unknown;
}

export type TrajectoryRecord =
	| (TrajectoryBase & { kind: "user"; content: string; skillName?: string })
	| (TrajectoryBase & {
			kind: "assistant";

			turn: number;

			blocks: TrajectoryBlock[];
			api: string;
			provider: string;
			model: string;
			responseModel?: string;
			responseId?: string;
			timing?: { stepStartTime: number; firstTokenTime: number | null; completedTime: number };
			usage?: TrajectoryUsage;
			stopReason: string;
			errorMessage?: string;
			rawStopReason?: string;
	  })
	| (TrajectoryBase & {
			kind: "toolResult";

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
	| (TrajectoryBase & { kind: "activeTools"; activeToolNames: string[] })
	| (TrajectoryBase & {
			kind: "compaction";
			summary: string;

			retainedTailCount: number;
			tokensBefore: number;
			details?: unknown;
			usage?: TrajectoryUsage;
	  })
	| (TrajectoryBase & { kind: "branchSummary"; fromId: string; summary: string; details?: unknown; usage?: TrajectoryUsage })
	| (TrajectoryBase & { kind: "custom"; customType: string; data?: unknown });

export interface UsageTotals {
	messages: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface SessionStats {
	usage: UsageTotals | null;
	runtime: {
		runs: number;
		avgTtftMs: number | null;
		avgTps: number | null;
		lastTtftMs: number | null;
	};
}

export interface RuntimeStatsSnapshot {
	runs: number;
	ttfts: number[];
	speedOutputs: number[];
	speedDurationsMs: number[];
	lastTtft: number | null;
	savedAt: number;
	sampling: "paired";
}

export interface ContextUsage {
	used: number;
	projectedTokens?: number;

	window: number;

	percent: number;

	breakdown: { systemTokens: number; toolsTokens: number; messageTokens: number } | null;

	lastTurn?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
}

export interface ContextSnapshot {
	used: number;
	projectedTokens?: number;
	window: number;
	percent: number;
	breakdown: { systemTokens: number; toolsTokens: number; messageTokens: number } | null;
	lastTurn?: TrajectoryUsage;
	workspace: string | null;
	storage: string | null;
	model: string | null;
	sandboxMode: SandboxMode;
}

export interface PartnerActivityDay {
	ts: number;
	tokens: number;
	turns: number;
	tools: number;
}

type __schema<S extends ElectrobunRPCSchema> = S;

export type AppRPCSchema = __schema<{
	bun: {
		requests: {
			chat: {
				params: { text: string };

				response: { accepted: boolean };
			};

			edit_last_user: {
				params: { text: string };
				response: { ok: boolean; error?: string };
			};

			commands_list: {
				params: {};
				response: { commands: CommandDescriptor[] };
			};

			commands_execute: {
				params: { line: string };
				response: CommandExecution;
			};

			skill_list: {
				params: { partner?: string };
				response: { skills: SkillDescriptor[] };
			};

			skill_list_global: {
				params: {};
				response: { skills: GlobalSkillDescriptor[] };
			};

			skill_execute: {
				params: { name: string; hint?: string };
				response: { ok: boolean; error?: string };
			};

			skill_get: {
				params: { name: string };
				response: { ok: boolean; content?: string; error?: string };
			};

			skill_create: {
				params: { name: string; description: string };
				response: { ok: boolean; error?: string; path?: string };
			};

			skill_delete: {
				params: { name: string };
				response: { ok: boolean; error?: string };
			};

			skill_reveal: {
				params: { name: string };
				response: { ok: boolean; error?: string };
			};

			skill_set_partners: {
				params: { name: string; partners: string[] };
				response: { ok: boolean; error?: string };
			};

			stop: {
				params: {};
				response: { accepted: boolean };
			};

			reset: {
				params: {};
				response: { accepted: boolean };
			};

			session_origin: {
				params: { name: string; mode?: "older" | "newer"; cursor?: string; limit?: number };
				response: {
					entries: Entry[];
					total: number;
					hasMore: boolean;
					reset: boolean;
				};
			};

			history: {
				params: {};
				response: {
					items: ViewItem[];
				};
			};

			shell_execute: {
				params: { command: string; timeout?: number };
				response: { ok: boolean; error?: string; shellId?: string };
			};

			open_path: {
				params: { path: string; editorId?: string };
				response: { ok: boolean; error?: string };
			};

			list_editors: {
				params: {};
				response: { editors: { id: string; name: string }[] };
			};

			explorer_children: {
				params: { name: string; root: ExplorerRoot; path: string };
				response: { ok: boolean; error?: string; entries?: ExplorerEntry[]; realPath?: string };
			};

			explorer_read_file: {
				params: { name: string; root: ExplorerRoot; path: string };
				response: { ok: boolean; error?: string; content?: string; binary?: boolean; truncated?: boolean; size?: number };
			};

			git_changes: {
				params: { name: string };
				response: { ok: boolean; error?: string; repoRoot?: string; changes?: GitChangeItem[] };
			};

			git_diff: {
				params: { name: string; path: string; staged?: boolean };
				response: { ok: boolean; error?: string; kind?: "diff" | "new"; diff?: string; content?: string };
			};

			get_status: {
				params: { name: string };
				response: {
					workspace_path: string | null;

					storage_path: string | null;
					sandbox_mode: SandboxMode;

					model: { provider: string; modelId?: string } | null;
					thinking_level: ThinkingLevel;
					thinking_levels: ThinkingLevel[];

					models: { provider: string; models: { id: string; name: string }[] }[];
				};
			};

			set_sandbox_mode: {
				params: { mode: SandboxMode };
				response: { ok: boolean; error?: string };
			};

			set_partner_model: {
				params: { model: { provider: string; modelId?: string } };
				response: { ok: boolean; error?: string };
			};
			set_thinking_level: {
				params: { level: ThinkingLevel };
				response: { ok: boolean; error?: string };
			};

			sandbox_respond: {
				params: { id: string; approved: boolean };
				response: { ok: boolean };
			};

			context_usage: {
				params: { name: string };
				response: ContextSnapshot;
			};

			stats: {
				params: { name: string };
				response: SessionStats;
			};

			btw_threads: {
				params: { name: string; anchorEntryId: string };
				response: { threads: BtwThreadRpc[] };
			};
			btw_create: {
				params: { name: string; anchorEntryId: string; question: string };
				response: { thread: BtwThreadRpc };
			};
			btw_ask: {
				params: { name: string; threadId: string; question: string };
				response: { thread: BtwThreadRpc };
			};

			trajectory: {
				params: { name: string; before?: number; limit?: number };
				response: { records: TrajectoryRecord[]; hasMore: boolean; total: number };
			};
			partner_activity: {
				params: { name: string; weeks: number };
				response: { days: PartnerActivityDay[] };
			};

			pick_directory: {
				params: { startingFolder?: string };
				response: { path: string | null };
			};

			compact: {
				params: {};
				response: { ok: boolean; error?: string; compacted?: number };
			};

			get_settings: {
				params: {};
				response: {
					settings: {
						partner_profile_path: string;
						detect_instructions_file: string;

						defaultSandboxMode?: SandboxMode;
						providers?: string[];
						customProviders?: CustomProvider[];

						theme?: ThemeMode;
						toastPlacement?: ToastPlacement;
						toastDurationMs?: number;
						skills_dirs?: string[];
						skills_watch?: boolean;
						skills_watch_delay_ms?: number;
						sendMessageIntervalSec?: number | null;
						shellContinuous?: boolean;
						memoryEnabled?: boolean;
						memoryCronEnabled?: boolean;
						memoryDailyTime?: string;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
						webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
						compaction?: {
							thresholdRatio?: number;
							eventDigestCount?: number;
							summaryCapChars?: number;
							maxOverflowRetries?: number;
							summarizer?: "local" | "llm";
							summarizationModel?: string;
							prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
						};
						explorer?: { lineGap?: number };
						dockSide?: "left" | "right";
					};
					runtime: {
						providers: { id: string; configured: boolean; baseUrl?: string; modelCount: number }[];

						allProviders: string[];
					};
				};
			};
			update_settings: {
				params: {
					settings: {
						partner_profile_path: string;
						detect_instructions_file: string;

						defaultSandboxMode?: SandboxMode;
						providers?: string[];
						customProviders?: CustomProvider[];

						theme?: ThemeMode;
						toastPlacement?: ToastPlacement;
						toastDurationMs?: number;
						skills_dirs?: string[];
						skills_watch?: boolean;
						skills_watch_delay_ms?: number;
						sendMessageIntervalSec?: number | null;
						shellContinuous?: boolean;
						memoryEnabled?: boolean;
						memoryCronEnabled?: boolean;
						memoryDailyTime?: string;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
						webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
						compaction?: {
							thresholdRatio?: number;
							eventDigestCount?: number;
							summaryCapChars?: number;
							maxOverflowRetries?: number;
							summarizer?: "local" | "llm";
							summarizationModel?: string;
							prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
						};
						explorer?: { lineGap?: number };
						dockSide?: "left" | "right";
					};

					credentials?: Record<string, string>;
				};
				response: { ok: boolean; error?: string };
			};

			mcp_get_config: {
				params: {};
				response: { config: McpConfig; configFile: string };
			};

			mcp_save_options: {
				params: {
					options: {
						configFile?: string;
						idleTimeoutSec?: number;
						defaultLifecycle?: McpLifecycle;
						maxBufferSize?: number;
					};
				};
				response: { ok: boolean; error?: string };
			};

			mcp_save_servers: {
				params: { servers: McpServerConfig[] };
				response: { ok: boolean; error?: string };
			};

			mcp_test: {
				params: { name: string };
				response: { ok: boolean; toolCount?: number; error?: string };
			};

			mcp_list: {
				params: {};
				response: {
					servers: Array<
						McpServerConfig & {
							state: "stopped" | "connecting" | "connected" | "error";
							toolCount: number;
							error?: string;
							grantedPartners: string[];
						}
					>;
				};
			};

			mcp_set_partners: {
				params: { name: string; partners: string[] };
				response: { ok: boolean; error?: string };
			};

			list_partners: {
				params: {};
				response: {
					partners: {
						name: string;
						persona?: string;
						createdAt: number;
						path: string;

						forkedFrom?: string;

						lastMessage?: string;

						lastMessageAt?: number;

						lastMessageKind?: ChatPreviewKind;

						readAt?: number;
						writing: boolean;
					}[];
				};
			};

			create_partner: {
				params: {
					name: string;
					persona?: string;
					workspace?: string;
				};
				response: {
					ok: boolean;
					error?: string;

					profile?: {
						name: string;
						persona?: string;
						createdAt: number;
						path: string;
					};
				};
			};

			set_partner: {
				params: {
					profile: { name: string; persona?: string } | null;
				};
				response: { ok: boolean };
			};

			duplicate_partner: {
				params: { name: string };
				response: {
					ok: boolean;
					error?: string;

					profile?: {
						name: string;
						persona?: string;
						createdAt: number;
						path: string;

						forkedFrom?: string;
					};
				};
			};

			fork_partner: {
				params: { name: string };
				response: {
					ok: boolean;
					error?: string;

					profile?: {
						name: string;
						persona?: string;
						createdAt: number;
						path: string;

						forkedFrom?: string;
					};
				};
			};

			promote_partner: {
				params: { name: string };
				response: {
					ok: boolean;
					error?: string;

					profile?: {
						name: string;
						persona?: string;
						createdAt: number;
						path: string;

						forkedFrom?: string;
					};
				};
			};

			delete_partner: {
				params: { name: string };
				response: { ok: boolean; error?: string };
			};

			set_read_at: {
				params: { name: string; readAt: number };
				response: { ok: boolean };
			};
		};
		messages: {
			history_timing: {
				partner: string;

				rpcMs: number;

				buildMs: number;

				renderMs: number;

				items: number;
			};
		};
	};
	webview: {
		requests: {};
		messages: {
			agent_turn: { turn: number; partner: string };

			agent_message: {};

			origin_update: { partner: string };

			context_changed: { partner?: string };

			agent_end: { error?: string; partner: string };

			sandbox_mode_update: {};

			escalation_update: {};

			command_update: {};
			skills_change: {};
			skill_update: {};
			shell_update: {};
		};
	};
}>;
