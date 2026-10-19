import type { Entry } from "@earendil-works/pi-agent-core";

export interface WireError {
	readonly code: string;
	readonly message: string;
}

export interface SeqEntry {
	readonly seq: number;
	readonly entry: Entry;
}

/** What kind of thing ended a session's log — it decides the preview's prefix in the row. */
export type PreviewKind = "user" | "assistant" | "send_message" | "command" | "skill" | "shell";

/**
 * One session = one partner directory. The field names mirror what v1 writes into the partner's own
 * files (`profile.json`, `read.json`, `workspace.json`), so both versions read one shape.
 */
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
	/** This session's own run state — sessions run independently. */
	readonly running: boolean;
	readonly lastMessage?: string;
	readonly lastMessageAt?: number;
	readonly lastMessageKind?: PreviewKind;
	readonly workspace?: string | null;
	readonly workspaceKind?: "worktree" | "repo" | "dir" | null;
	readonly workspaceRepo?: string | null;
}

/** What the page can hold: declared in the core, rendered by whatever shell is connected. */
export interface SurfaceDeclaration {
	readonly id: string;
	readonly slot: string;
	readonly order?: number;
}

/** slot → surface ids, in the order the shell renders them. */
export type Layout = Readonly<Record<string, readonly string[]>>;

export interface LayoutState {
	readonly surfaces: readonly SurfaceDeclaration[];
	readonly layout: Layout;
}

export type LiveEvent = { readonly type: "status"; readonly session: string; readonly running: boolean; readonly error?: string } | ({ readonly type: "layout" } & LayoutState);

/** `seq` is per session, so every entry frame names the session it belongs to. */
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
	/** Pinned sessions sit above the rest of the list; the flag lives in the partner's own profile. */
	pin: { params: { session: string; pinned: boolean }; result: Record<string, never> };
	/** Which apps this machine actually has — the menu only offers what exists. */
	editors: { params: Record<string, never>; result: { editors: readonly { id: string; name: string }[]; finder: boolean } };
	openPath: { params: { path: string; editorId?: string; via?: "default" | "finder" }; result: { ok: boolean; error?: string } };
	layout: { params: Record<string, never>; result: LayoutState };
	layoutSet: { params: { layout: Layout }; result: LayoutState };
}

export type MethodName = keyof Methods;
export type Params<K extends MethodName> = Methods[K]["params"];
export type Result<K extends MethodName> = Methods[K]["result"];

export const METHOD_NAMES: readonly MethodName[] = ["transcript", "prompt", "abort", "sessions", "markRead", "pin", "editors", "openPath", "layout", "layoutSet"];

export function isFrame(value: unknown): value is Frame {
	return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}
