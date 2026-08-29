import type { ElectrobunRPCSchema } from "electrobun/main";
import type { CustomModel, CustomProvider, ThemeMode, ToastPlacement } from "../bun/lib/settings";
import type { SandboxMode } from "../bun/permission/types";
import type { SurfaceNode } from "./surface";

export type { CustomModel, CustomProvider, SandboxMode, ThemeMode, ToastPlacement };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CommandKind = "execute" | "leadingInput" | "popupSelect";

export interface CommandDescriptor {
	name: string;
	description: string;
	kind: CommandKind;

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

export type EscalationStatus = "pending" | "approved" | "rejected" | "dropped";

export interface RequestTool {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
}

export interface TrajectoryBase {
	seq: number;

	entryId: string;

	time: number;
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
	| (TrajectoryBase & { kind: "user"; content: string })
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
	| (TrajectoryBase & { kind: "thinkingLevel"; thinkingLevel: string })
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

			commands_list: {
				params: {};
				response: { commands: CommandDescriptor[] };
			};

			commands_execute: {
				params: { line: string };
				response: CommandExecution;
			};

			stop: {
				params: {};
				response: { accepted: boolean };
			};

			reset: {
				params: {};
				response: { accepted: boolean };
			};

			history: {
				params: {};
				response: {
					items: {
						id: string;
						kind: "user" | "send_message" | "escalation" | "error" | "aborted" | "command";
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
						command?: CommandHistoryItem;
					}[];
				};
			};

			get_status: {
				params: {};
				response: {
					workspace_path: string | null;

					storage_path: string | null;
					sandbox_mode: SandboxMode;

					model: { provider: string; modelId?: string } | null;
					thinking_level: ThinkingLevel;
					thinking_levels: ThinkingLevel[];

					models: { provider: string; models: { id: string; name: string }[] }[];

					partners: { name: string; streaming: boolean; writing: boolean }[];
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
				params: {};
				response: ContextSnapshot;
			};

			stats: {
				params: {};
				response: SessionStats;
			};

			trajectory: {
				params: { name: string };
				response: { records: TrajectoryRecord[] };
			};
			partner_activity: {
				params: { name: string; weeks: number };
				response: { days: PartnerActivityDay[] };
			};

			surface: {
				params: {};
				response: { nodes: SurfaceNode[]; replaceGeneration: number };
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
						sendMessageIntervalSec?: number | null;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
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
						sendMessageIntervalSec?: number | null;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
					};

					credentials?: Record<string, string>;
				};
				response: { ok: boolean; error?: string };
			};

			list_partners: {
				params: {};
				response: {
					partners: {
						name: string;
						responsibilities?: string;
						tones?: string;
						createdAt: number;

						lastMessage?: string;

						lastMessageAt?: number;

						lastMessageKind?: "user" | "send_message";

						readAt?: number;
					}[];
				};
			};

			create_partner: {
				params: {
					name: string;
					responsibilities?: string;
					tones?: string;
				};
				response: {
					ok: boolean;
					error?: string;

					profile?: {
						name: string;
						responsibilities?: string;
						tones?: string;
						createdAt: number;
					};
				};
			};

			set_partner: {
				params: {
					profile: { name: string; responsibilities?: string; tones?: string } | null;
				};
				response: { ok: boolean };
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

			trajectory_update: {};

			workspace_update: {};

			agent_end: { error?: string; partner: string };

			sandbox_mode_update: {};
			thinking_level_update: {};

			escalation_update: {};

			command_update: {};
		};
	};
}>;
