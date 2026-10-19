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

export type DialogDescriptor = { readonly kind: "confirm"; readonly copy: ConfirmCopy } | { readonly kind: "custom"; readonly id: string };

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

export type BrowserCommand = { readonly kind: "copy"; readonly text: string } | { readonly kind: "select"; readonly session: string };

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
	| ({ readonly type: "layout" } & LayoutState)
	| { readonly type: "dialog"; readonly id: string; readonly dialog: DialogDescriptor };

export type Frame =
	| { kind: "req"; id: number; method: string; params: unknown }
	| { kind: "res"; id: number; ok: true; result: unknown }
	| { kind: "res"; id: number; ok: false; error: WireError }
	| { kind: "entry"; session: string; seq: number; entry: Entry }
	| { kind: "live"; event: LiveEvent };

export interface Methods {
	transcript: { params: { session: string; since?: number }; result: { entries: SeqEntry[]; cursor: number } };
	prompt: { params: { session: string; text: string }; result: { accepted: boolean } };
	abort: { params: { session: string }; result: Record<string, never> };
	sessions: { params: Record<string, never>; result: { sessions: SessionRow[] } };
	markRead: { params: { session: string; readAt: number }; result: Record<string, never> };
	invoke: { params: { action: string; session?: string; args?: unknown }; result: { ok: boolean; error?: string; command?: BrowserCommand } };
	answer: { params: { id: string; value: unknown }; result: Record<string, never> };
	contributions: { params: { point: string }; result: { items: readonly ContributionItem[] } };
	pickDirectory: { params: { startingFolder?: string }; result: { path?: string } };
	layout: { params: Record<string, never>; result: LayoutState };
	layoutSet: { params: { layout: Layout }; result: LayoutState };
}

export type MethodName = keyof Methods;
export type Params<K extends MethodName> = Methods[K]["params"];
export type Result<K extends MethodName> = Methods[K]["result"];

export const METHOD_NAMES: readonly MethodName[] = [
	"transcript",
	"prompt",
	"abort",
	"sessions",
	"markRead",
	"invoke",
	"answer",
	"contributions",
	"pickDirectory",
	"layout",
	"layoutSet",
];

export function isFrame(value: unknown): value is Frame {
	return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}
