import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ElectrobunRPCSchema } from "electrobun/main";
import type { CustomModel, CustomProvider, ThemeMode, ToastPlacement } from "../bun/lib/settings";
import type { McpConfig, McpLifecycle, McpServerConfig, McpServerStatusState } from "../bun/mcp/types";
import type { SandboxMode } from "../bun/permission/types";
import type { MemoryRunEndReason, MemoryRunStage, MemoryRunTraceEvent, TaskStatus } from "./events";

export type { CustomModel, CustomProvider, McpServerStatusState, SandboxMode, ThemeMode, ToastPlacement };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CommandKind = "execute" | "leadingInput" | "popupSelect";

export type ChatPreviewKind = "user" | "assistant" | "send_message" | "command" | "skill" | "shell";

export type ExplorerRoot = "workspace" | "storage";

export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChangeItem {
	path: string;
	status: GitChangeStatus;
	staged: boolean;
	untracked?: boolean;
	from?: string;
}

export interface GitWorktreeItem {
	path: string;
	branch: string | null;
	head: string | null;
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

export interface ScheduleItem {
	id: string;
	title: string;
	display: string;
	kind: "once" | "interval" | "cron";
	describe: string;
	text: string;
	nextRunAt: number | null;
	retryAt: number | null;
	status: "active" | "paused" | "finished";
	running: boolean;
	runCount: number;
	lastError: string | null;
	createdAt: number;
}

export interface ScheduleRunItem {
	runId: string;
	scheduleId: string;
	scheduledAt: number;
	dispatchedAt: number | null;
	trigger: "schedule" | "manual" | "catchup";
	status: "dispatched" | "done" | "failed" | "skipped" | "missed";
	error?: string;
	attempts: number;
}

export interface QueuedMessageRpc {
	id: string;
	content: string;
	timestamp: number;
	failed?: boolean;
	source?: "user" | "task" | "peer" | "schedule";
	taskId?: string;
	scheduleId?: string;
	peer?: string;
	requestId?: string;
	hop?: number;
}

/** One schedule that is still to fire, with the chat it belongs to — the welcome screen's queue. */
export interface WelcomeSchedule {
	partner: string;
	id: string;
	title: string;
	nextRunAt: number;
	running: boolean;
}

/** A background task still running, with the chat that started it. */
export interface WelcomeTask {
	partner: string;
	id: string;
	command: string;
	startedAt: number;
}

export interface TaskSummary {
	id: string;
	command: string;
	status: TaskStatus;
	pid?: number;
	exitCode?: number;
	signalCode?: string;
	startedAt: number;
	endedAt?: number;
	bytes: number;
}

export interface ViewItem {
	id: string;
	kind: "user" | "assistant" | "escalation" | "error" | "aborted" | "command" | "skill" | "shell";
	text: string;
	time: number;
	skillName?: string;
	from?: string;
	to?: string;
	peerKind?: "ask" | "reply";
	requestId?: string;
	thinking?: {
		text: string;
		redacted?: boolean;
	};
	/** A message the run said along the way, not the answer it ended on: a row in the timeline. */
	say?: true;
	/** How long the step that produced this item took, wall clock (the entry's own timing). */
	stepMs?: number;
	tool?: {
		callId: string;
		name: string;
		summary: string;
		status: "running" | "success" | "error";
		/** The call's own arguments, pretty-printed — what the row's card shows. */
		args?: string;
		result?: string;
		isError?: boolean;
	};
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
	/** Set on a message a schedule sent: the row shows where it came from, not just what it said. */
	schedule?: ScheduleOrigin;
	files?: string[];
}

export type ScheduleTrigger = "schedule" | "manual" | "catchup";

export type ScheduleRunStatus = "dispatched" | "done" | "failed" | "skipped" | "missed";

export interface ScheduleOrigin {
	scheduleId: string;
	title: string;
	runId?: string;
	trigger?: ScheduleTrigger;
	status?: ScheduleRunStatus;
	error?: string;
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

export type RailView = "chat" | "skills" | "dashboard";

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

	metaKey: string;

	run: number;

	turn: number;

	time: number;

	marks?: number;

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

export type EntryPayload =
	| { kind: "user"; content: string; skillName?: string }
	| {
			kind: "assistant";

			blocks: TrajectoryBlock[];
			api: string;
			provider: string;
			model: string;
			responseModel?: string;
			responseId?: string;
			timing?: { turnStartTime: number; firstTokenTime: number | null; completedTime: number };
			usage?: TrajectoryUsage;
			stopReason: string;
			errorMessage?: string;
			rawStopReason?: string;
	  }
	| {
			kind: "toolResult";

			toolCallId: string;
			toolName: string;
			content: string;
			details?: unknown;
			usage?: TrajectoryUsage;
			addedToolNames?: string[];
			isError: boolean;
	  }
	| { kind: "modelChange"; provider: string; modelId: string }
	| { kind: "activeTools"; activeToolNames: string[] }
	| {
			kind: "compaction";
			summary: string;

			retainedTailCount: number;
			tokensBefore: number;
			details?: unknown;
			usage?: TrajectoryUsage;
	  }
	| { kind: "branchSummary"; fromId: string; summary: string; details?: unknown; usage?: TrajectoryUsage }
	| { kind: "custom"; customType: string; data?: unknown };

export type TrajectoryRecord = TrajectoryBase & EntryPayload;

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
		turns: number;
		avgTtftMs: number | null;
		avgTps: number | null;
		lastTtftMs: number | null;
	};
}

export interface RuntimeStatsSnapshot {
	turns: number;
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
	freshTokens: number;
	turns: number;
	tools: number;
}

export interface DashboardMemorySizes {
	memories: number;
	scenes: number;
	persona: number;
	runs: number;
	total: number;
}

export interface DashboardRun {
	partner: string;
	stage: MemoryRunStage;
	reason: MemoryRunEndReason;
	added: number;
	startedAt: number;
	durationMs: number;
}

export interface DashboardPartnerStats {
	name: string;
	turns: number;
	freshTokens: number;
	totalTokens: number;
	tools: number;
	ttftMedianMs: number | null;
	lastTtftMs: number | null;
	ttftSamples: number;
	tps: number | null;
	memory: DashboardMemorySizes;
	days: number[];
}

export interface DashboardTotals {
	chats: number;
	turns: number;
	freshTokens: number;
	cacheTokens: number;
	totalTokens: number;
	tools: number;
	ttftMedianMs: number | null;
	ttftP90Ms: number | null;
	ttftSamples: number;
	tps: number | null;
	memory: DashboardMemorySizes;
	since: number | null;
}

export interface DashboardOverview {
	partners: DashboardPartnerStats[];
	totals: DashboardTotals;
	days: PartnerActivityDay[];
	runs: DashboardRun[];
	windowDays: number;
	activityWeeks: number;
	heatmap: PartnerActivityDay[];
}

export interface PartnerAccessSkill {
	name: string;
	description: string;
	scope: "project" | "global";
	granted: boolean;
}

export interface PartnerAccessServer {
	name: string;
	state: McpServerStatusState;
	toolCount: number;
	granted: boolean;
}

// ——— memory panel ———
export type MemoryKindView = "fact" | "decision" | "issue" | "reference" | "event" | "preference" | "instruction";

export interface MemoryRecordView {
	id: string;
	kind: MemoryKindView;
	createdAt: number;
	summary: string;
	detail?: string;
	scene?: string;
	superseded: boolean;
	overRecallCap: boolean;
	source: { rawCount: number };
}

export interface MemorySceneView {
	sceneId: string;
	name: string;
	summary: string;
	content: string;
	heat: number;
	updatedAt: number;
	sourceCount: number;
}

export interface MemoryProfileView {
	version: number;
	createdAt: number;
	content: string;
	sourceCount: number;
}

export interface MemoryRunUsage {
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface MemoryRunView {
	runId: string;
	stage: MemoryRunStage;
	reason: MemoryRunEndReason;
	startedAt: number;
	durationMs: number;
	added: number;
	bytes: number;
	usage?: MemoryRunUsage;
	error?: string;
}

export interface MemorySizeEntry {
	label: string;
	bytes: number;
}

export interface MemoryOverview {
	totalBytes: number;
	resultsBytes: number;
	traceBytes: number;
	results: MemorySizeEntry[];
	trace: MemorySizeEntry[];
	records: MemoryRecordView[];
	supersededCount: number;
	scenes: MemorySceneView[];
	profile: MemoryProfileView | null;
	runs: MemoryRunView[];
	runsTotal: number;
	pending: { pending: boolean; rounds: number };
	agentDetailLimit: number;
}

export interface MemoryTrajectoryMessageView {
	role: string;
	toolName?: string;
	isError?: boolean;
	stopReason?: string;
	errorMessage?: string;
	text?: string;
	thinking?: string;
	toolCalls?: { name: string; args: string }[];
}

export interface MemoryTrajectoryAttemptView {
	attempt: number;
	messages: MemoryTrajectoryMessageView[];
}

export interface MemoryRunTraceView extends MemoryRunView {
	model: string;
	attempts: number;
	targetRawId: string | null;
	cursorRawId: string | null;
	checkpoints?: string[];
	trace: MemoryRunTraceEvent[];
	attemptsView: MemoryTrajectoryAttemptView[];
}

type __schema<S extends ElectrobunRPCSchema> = S;

export type AppRPCSchema = __schema<{
	bun: {
		requests: {
			chat: {
				params: { text: string };

				response: { accepted: boolean; queued: boolean; messageId?: string };
			};

			follow_up_list: {
				params: { name: string };
				response: { items: QueuedMessageRpc[] };
			};

			welcome_overview: {
				params: {};
				response: { schedules: WelcomeSchedule[]; tasks: WelcomeTask[] };
			};

			task_list: {
				params: { name: string };
				response: { tasks: TaskSummary[] };
			};

			task_read: {
				params: { name: string; id: string; offset?: number; before?: number; lines?: number };
				response: {
					ok: boolean;
					error?: string;
					text?: string;
					nextOffset?: number;
					startOffset?: number;
					hasMore?: boolean;
					eof?: boolean;
					reset?: boolean;
					truncated?: boolean;
					status?: TaskStatus;
					exitCode?: number;
					bytes?: number;
				};
			};

			task_stop: {
				params: { name: string; id: string };
				response: { ok: boolean; error?: string };
			};

			cancel_follow_up: {
				params: { id: string };
				response: { ok: boolean; error?: string };
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

			window_zoom_toggle: {
				params: {};
				response: { zoomed: boolean };
			};

			session_origin: {
				params: { name: string; mode?: "older" | "newer"; cursor?: string };
				response: {
					entries: Entry[];
					total: number;
					hasMore: boolean;
					reset: boolean;
					baseDir: string | null;
				};
			};

			shell_execute: {
				params: { command: string; timeout?: number };
				response: { ok: boolean; error?: string; shellId?: string };
			};

			open_external: {
				params: { url: string };
				response: { ok: boolean };
			};

			open_path: {
				params: { path: string; editorId?: string; via?: "default" | "finder" };
				response: { ok: boolean; error?: string };
			};

			list_editors: {
				params: {};
				response: { editors: { id: string; name: string }[]; finder: boolean };
			};

			explorer_children: {
				params: { name: string; root: ExplorerRoot; path: string };
				response: { ok: boolean; error?: string; entries?: ExplorerEntry[]; realPath?: string };
			};

			explorer_reveal: {
				params: { name: string; path: string };
				response: { ok: boolean; error?: string };
			};

			watch_file: {
				params: { name: string; root: ExplorerRoot; path: string | null };
				response: { ok: boolean; error?: string };
			};

			explorer_read_file: {
				params: { name: string; root: ExplorerRoot; path: string };
				response: {
					ok: boolean;
					error?: string;
					content?: string;
					binary?: boolean;
					truncated?: boolean;
					size?: number;
					frontmatter?: { end: number; raw: string; data: Record<string, unknown> | null };
				};
			};

			explorer_read_image: {
				params: { name: string; root: ExplorerRoot; from: string; path: string };
				response: { ok: boolean; dataUrl?: string; error?: string };
			};

			git_changes: {
				params: { name: string };
				response: { ok: boolean; error?: string; repoRoot?: string; changes?: GitChangeItem[] };
			};

			git_diff: {
				params: { name: string; path: string; staged?: boolean };
				response: { ok: boolean; error?: string; kind?: "diff" | "new"; diff?: string; content?: string };
			};

			git_file_sides: {
				params: { name: string; path: string; staged?: boolean; from?: string };
				response: { ok: boolean; error?: string; original?: string; modified?: string; add?: number; del?: number; binary?: boolean; tooLarge?: boolean };
			};

			git_worktrees: {
				params: { name: string };
				response: { ok: boolean; error?: string; worktrees?: GitWorktreeItem[]; current?: string | null };
			};

			get_status: {
				params: { name: string };
				response: {
					workspace_path: string | null;
					is_git_repo: boolean;
					change_count: number;
					worktree_count: number;

					storage_path: string | null;
					sandbox_mode: SandboxMode;

					model: { provider: string; modelId?: string } | null;
					thinking_level: ThinkingLevel;
					thinking_levels: ThinkingLevel[];

					models: { provider: string; models: { id: string; name: string }[] }[];
				};
			};

			partner_usage: {
				params: { name: string };
				response: { bytes: number; parts: { label: string; bytes: number }[] };
			};

			memory_overview: {
				params: { name: string };
				response: { overview: MemoryOverview | null };
			};

			schedule_list: {
				params: { name: string };
				response: { items: ScheduleItem[]; history: ScheduleRunItem[] };
			};

			schedule_create: {
				params: { name: string; when: string; text: string; title?: string };
				response: { ok: boolean; id?: string; describe?: string; error?: string };
			};

			schedule_update: {
				params: { name: string; id: string; patch: { enabled?: boolean; text?: string; when?: string; title?: string } };
				response: { ok: boolean; describe?: string; error?: string };
			};

			schedule_run: {
				params: { name: string; id: string };
				response: { ok: boolean; error?: string };
			};

			schedule_delete: {
				params: { name: string; id: string };
				response: { ok: boolean };
			};

			dashboard_overview: {
				params: { days?: number };
				response: { overview: DashboardOverview };
			};

			memory_run_trace: {
				params: { name: string; runId: string };
				response: { run: MemoryRunTraceView | null };
			};

			palette_search_files: {
				params: { name: string; query: string };
				response: {
					ok: boolean;
					error?: string;
					items: { path: string; name: string }[];
					truncated: boolean;
				};
			};

			set_sandbox_mode: {
				params: { name: string; mode: SandboxMode };
				response: { ok: boolean; error?: string };
			};

			set_partner_model: {
				params: { name: string; model: { provider: string; modelId?: string } };
				response: { ok: boolean; error?: string };
			};
			set_thinking_level: {
				params: { name: string; level: ThinkingLevel };
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
						shellContinuous?: boolean;
						rememberSession?: boolean;
						memoryEnabled?: boolean;
						memoryIdleMinutes?: number;
						memoryMaxScenes?: number;
						memoryPendingRounds?: number;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
						bash?: { timeoutSec?: number };
						delete?: { strict?: boolean };
						webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
						compaction?: {
							thresholdRatio?: number;
							digestMaxItems?: number;
							maxOverflowRetries?: number;
							prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
						};
						explorer?: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } };
						highlight?: { tokenizeMaxLineLength?: number; tokenizeTimeLimit?: number };
						palette?: { searchIgnoreDirs?: string[] };
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
						shellContinuous?: boolean;
						rememberSession?: boolean;
						memoryEnabled?: boolean;
						memoryIdleMinutes?: number;
						memoryMaxScenes?: number;
						memoryPendingRounds?: number;
						commands_path?: string;
						retry?: { maxRetries?: number; baseDelayMs?: number };
						bash?: { timeoutSec?: number };
						delete?: { strict?: boolean };
						webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
						compaction?: {
							thresholdRatio?: number;
							digestMaxItems?: number;
							maxOverflowRetries?: number;
							prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
						};
						explorer?: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } };
						highlight?: { tokenizeMaxLineLength?: number; tokenizeTimeLimit?: number };
						palette?: { searchIgnoreDirs?: string[] };
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
							builtin: boolean;
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

			mcp_partner_grants: {
				params: { name: string };
				response: { servers: Array<{ name: string; state: McpServerStatusState; toolCount: number }> };
			};

			partner_access: {
				params: { name: string };
				response: { skills: PartnerAccessSkill[]; mcp: PartnerAccessServer[] };
			};

			partner_set_skill: {
				params: { name: string; skill: string; granted: boolean };
				response: { ok: boolean; error?: string };
			};

			partner_set_mcp: {
				params: { name: string; server: string; granted: boolean };
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

						startedAt?: number;

						/** The workspace this chat works in, and what it is: `worktree` (a linked one), `repo`, or a plain `dir`. */
						workspace?: string | null;

						/** Where this chat keeps its files (the agent's own scratch area). */
						storage?: string | null;

						workspaceKind?: "worktree" | "repo" | "dir" | null;

						workspaceRepo?: string | null;

						/** Pinned chats sit above the rest of the list. */
						pinned?: boolean;

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

			last_partner: {
				params: Record<string, never>;
				response: { partner: string | null };
			};

			set_menu_state: {
				params: { partner: boolean; workspace: boolean; git: boolean };
				response: { ok: boolean };
			};

			set_view: {
				params: { view: RailView };
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

			set_partner_pinned: {
				params: { name: string; pinned: boolean };
				response: { ok: boolean; error?: string };
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

			agent_message: { partner: string };

			origin_update: { partner: string };

			inbox_update: { partner: string } & (
				| { kind: "inserted"; item: QueuedMessageRpc }
				| { kind: "claimed"; id: string }
				| { kind: "discarded"; id: string }
				| { kind: "cleared" }
			);

			context_changed: { partner?: string; workspace?: string | null };

			agent_end: { error?: string; partner: string };

			file_changed: { path: string };

			sandbox_mode_update: {};

			schedule_update: { partner: string };

			escalation_update: { partner?: string; escalationId?: string; command?: string; from?: SandboxMode; to?: SandboxMode; resolved?: boolean };

			command_update: {};
			skills_change: {};

			menu_command: { action: string };
			skill_update: {};
			shell_update: {};
			task_update: { taskId: string; kind: "started" | "output" | "ended" };
		};
	};
}>;
