/**
 * Session surface — the model-visible projection of the session log
 * (see docs/2026-08-19-session-surface-refactor.md and the deepseek-harness
 * session-surface design it adapts).
 *
 * The pi JSONL is the single source of truth (SSOT); the surface is a pure
 * function of it: foldSurface(entries) replays the log and applies logged
 * surface ops. Only message-shaped event kinds join the surface; everything
 * else (thinking, tool calls, usage, prompts, reminders, compaction records)
 * stays log-only.
 */

/** How a logged event joined the model-visible surface. */
export type SurfaceOp = { kind: "append" } | { kind: "replace"; start: number; end: number; sourceEventSeqs: string[] };

/** A node of the folded surface — a reference into the session log (pi entry id). */
export type SurfaceNode =
	| { kind: "user"; seq: number; id: string; time: number }
	| { kind: "assistant"; seq: number; id: string; time: number }
	| { kind: "send_message"; seq: number; id: string; time: number }
	| { kind: "tool_result"; seq: number; id: string; time: number };

/** The folded surface: ordered model-visible nodes + the replace generation (cache key). */
export interface Surface {
	nodes: SurfaceNode[];
	replaceGeneration: number;
}

/** Custom-entry data of a logged `surface_op` record (a replace applied to the surface). */
export interface SurfaceOpRecord {
	op: "replace";
	/** Surface positions (inclusive) at the time the op was logged. */
	start: number;
	end: number;
	/** Every shadowed node's pi entry id — provenance, validated at fold time. */
	sourceEventSeqs: string[];
	/** Monotonic generation: bumped on every replace (invalidates derived caches). */
	replaceGeneration: number;
	/** Optional id of the `compaction_summary` entry that replaces the range (a checkpoint node). */
	checkpointId?: string;
	/** Optional id of a replacement surface entry (e.g. a pruned `tool/result`) inserted at `start` in place of the range. */
	replacementId?: string;
}
