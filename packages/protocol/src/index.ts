import type { Entry } from "@earendil-works/pi-agent-core";

export interface WireError {
	readonly code: string;
	readonly message: string;
}

export interface SeqEntry {
	readonly seq: number;
	readonly entry: Entry;
}

export type PreviewKind = "user" | "assistant" | "send_message" | "command" | "skill" | "shell";

export const LOG_EVENTS = {
	agentStart: "agent/start",
	agentEnd: "agent/end",
	turnStart: "turn/start",
	turnEnd: "turn/end",
	toolCall: "tool/call",
	toolResult: "tool/result",
	requestHeader: "request/header",
	sendMessage: "send_message",
	systemPrompt: "system_prompt",
	timeGapReminder: "time_gap_reminder",
	escalationRequest: "escalation/request",
	escalationDecision: "escalation/decision",
	compaction: "compaction",
	modelChange: "model_change",
	contextChanged: "context/changed",
	instructionsChanged: "instructions/changed",
	mcpChanged: "mcp/changed",
	rewind: "rewind",
	memoryRunStart: "memory/run/start",
	memoryRunEnd: "memory/run/end",
	memoryContext: "memory/context",
	taskStart: "task/start",
	taskEnd: "task/end",
	scheduleRun: "schedule/run",
} as const;

export interface SessionRow {
	readonly name: string;
	readonly path: string;
	readonly storage: string;
	readonly persona?: string;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly forkedFrom?: string;
	readonly pinned?: boolean;
	readonly readAt?: number;
	readonly running: boolean;
	readonly error?: string;
	readonly lastMessage?: string;
	readonly lastMessageAt?: number;
	readonly lastMessageKind?: PreviewKind;
	readonly workspace?: string | null;
	readonly workspaceKind?: "worktree" | "repo" | "dir" | null;
	readonly workspaceRepo?: string | null;
	readonly menu?: readonly ContributionItem[];
}

export interface ConfirmCopy {
	readonly title: string;
	readonly description?: string;
	readonly confirmLabel?: string;
	readonly danger?: boolean;
}

export type DialogDescriptor =
	| { readonly kind: "confirm"; readonly copy: ConfirmCopy }
	| { readonly kind: "custom"; readonly id: string; readonly title?: string; readonly data?: unknown };

export interface ContributionItem {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly order?: number;
	readonly group?: string;
	readonly danger?: boolean;
	readonly action?: string;
	readonly args?: unknown;
	readonly items?: readonly ContributionItem[];
}

export const SLOT_POINTS = { chatBar: "chat.bar", chatName: "chat.name", chatPanes: "chat.panes", welcomeTimeline: "welcome.timeline" } as const;

export interface SlotItem {
	readonly id: string;
	readonly component: string;
	readonly order?: number;
	readonly data?: unknown;
}

export interface WelcomeItem {
	readonly id: string;
	readonly title: string;
	readonly variant: "primary" | "outline" | "key";
	readonly icon?: string;
	readonly keys?: readonly string[];
	readonly order?: number;
	readonly action: string;
	readonly args?: unknown;
}

export type Platform = "web" | "desktop";

export type Hotkey = string | Readonly<Record<Platform, string>>;

export interface ActionBinding {
	readonly id: string;
	readonly hotkey: Hotkey;
	readonly scopes: readonly string[];
}

export interface ComposerWidget {
	readonly id: string;
	readonly widget: string;
	readonly data?: unknown;
	readonly order?: number;
}

export interface ComposerCommand {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly kind: "execute" | "leadingInput";
	readonly action: string;
	readonly hint?: string;
	readonly category?: "command" | "skill";
}

export interface ComposerTip {
	readonly id: string;
	readonly label: string;
	readonly keys?: readonly string[];
	readonly when?: "chat" | "shell";
	readonly order?: number;
}

export interface ComposerLayout {
	readonly left: readonly ComposerWidget[];
	readonly right: readonly ComposerWidget[];
	readonly tips: readonly ComposerTip[];
}

export type BrowserCommand = { readonly kind: "copy"; readonly text: string } | { readonly kind: "shell"; readonly on: boolean | "toggle" };

export interface SurfaceDeclaration {
	readonly id: string;
	readonly slot: string;
	readonly order?: number;
}

export type Layout = Readonly<Record<string, readonly string[]>>;

export interface LayoutState {
	readonly surfaces: readonly SurfaceDeclaration[];
	readonly layout: Layout;
}

export type LiveEvent =
	| { readonly type: "status"; readonly session: string; readonly running: boolean; readonly error?: string }
	| { readonly type: "selection"; readonly selected: string | null }
	| ({ readonly type: "layout" } & LayoutState)
	| { readonly type: "dialog"; readonly id: string; readonly dialog: DialogDescriptor };

export interface Methods {
	transcript: {
		params: { session: string; mode?: "older" | "newer"; cursor?: string; conversations?: number };
		result: { entries: SeqEntry[]; total: number; hasMore: boolean; reset: boolean };
	};
	prompt: { params: { text: string }; result: { accepted: boolean } };
	abort: { params: Record<string, never>; result: Record<string, never> };
	composer: { params: { session: string }; result: ComposerLayout };
	hotkeys: { params: Record<string, never>; result: { bindings: readonly ActionBinding[] } };
	sessions: { params: Record<string, never>; result: { sessions: SessionRow[]; selected: string | null } };
	select: { params: { session: string | null }; result: { selected: string | null } };
	invoke: {
		params: { action: string; session?: string; args?: unknown; confirmed?: boolean };
		result: { ok: boolean; error?: string; command?: BrowserCommand; confirm?: ConfirmCopy; data?: unknown };
	};
	answer: { params: { id: string; value: unknown }; result: Record<string, never> };
	contributions: { params: { point: string }; result: { items: readonly ContributionItem[] } };
	slots: { params: { point: string; session?: string }; result: { items: readonly SlotItem[] } };
	welcome: { params: Record<string, never>; result: { items: readonly WelcomeItem[] } };
	pickDirectory: { params: { startingFolder?: string }; result: { path?: string } };
	layout: { params: Record<string, never>; result: LayoutState };
	layoutSet: { params: { layout: Layout }; result: LayoutState };
}

export type MethodName = keyof Methods;
export type Params<K extends MethodName> = Methods[K]["params"];
export type Result<K extends MethodName> = Methods[K]["result"];

export type RpcResponse = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: WireError };

export interface Snapshot {
	readonly layout: LayoutState;
	readonly commands: readonly ComposerCommand[];
	readonly sessions: readonly SessionRow[];
	readonly selected: string | null;
	readonly header: readonly ContributionItem[];
	readonly hotkeys: readonly ActionBinding[];
	readonly welcome: readonly WelcomeItem[];
	readonly slots: Readonly<Record<string, readonly SlotItem[]>>;
}
