import type { Entry } from "@earendil-works/pi-agent-core";

export interface WireError {
	readonly code: string;
	readonly message: string;
}

export interface SeqEntry {
	readonly seq: number;
	readonly entry: Entry;
}

/** What kind of thing ended a chat's log — it decides the preview's prefix in the row. */
export type ChatPreviewKind = "user" | "assistant" | "send_message" | "command" | "skill" | "shell";

/**
 * One chat = one partner directory. The field names mirror what v1 writes into the partner's own
 * files (`profile.json`, `read.json`, `workspace.json`), so both versions read one shape.
 */
export interface ChatRow {
	readonly name: string;
	readonly path: string;
	readonly storage: string;
	readonly persona?: string;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly forkedFrom?: string;
	readonly pinned?: boolean;
	readonly readAt?: number;
	/** This chat's own run state — chats run independently. */
	readonly writing: boolean;
	readonly lastMessage?: string;
	readonly lastMessageAt?: number;
	readonly lastMessageKind?: ChatPreviewKind;
	readonly workspace?: string | null;
	readonly workspaceKind?: "worktree" | "repo" | "dir" | null;
	readonly workspaceRepo?: string | null;
}

export type LiveEvent = { readonly type: "status"; readonly chat: string; readonly running: boolean; readonly error?: string };

/** `seq` is per chat, so every entry frame names the chat it belongs to. */
export type Frame =
	| { kind: "req"; id: number; method: string; params: unknown }
	| { kind: "res"; id: number; ok: true; result: unknown }
	| { kind: "res"; id: number; ok: false; error: WireError }
	| { kind: "entry"; chat: string; seq: number; entry: Entry }
	| { kind: "live"; event: LiveEvent };

export interface Methods {
	transcript: { params: { chat: string; since?: number }; result: { entries: SeqEntry[]; cursor: number } };
	prompt: { params: { chat: string; text: string }; result: { accepted: boolean } };
	abort: { params: { chat: string }; result: Record<string, never> };
	chats: { params: Record<string, never>; result: { chats: ChatRow[] } };
	markRead: { params: { chat: string; readAt: number }; result: Record<string, never> };
}

export type MethodName = keyof Methods;
export type Params<K extends MethodName> = Methods[K]["params"];
export type Result<K extends MethodName> = Methods[K]["result"];

export const METHOD_NAMES: readonly MethodName[] = ["transcript", "prompt", "abort", "chats", "markRead"];

export function isFrame(value: unknown): value is Frame {
	return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}
