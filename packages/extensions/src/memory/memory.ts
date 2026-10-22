import {
	CompactionServiceId,
	EVENTS,
	type ExecutionEnv,
	type Extension,
	HookServiceId,
	ModelsServiceId,
	SessionServiceId,
	SettingsServiceId,
	type ToolCall,
	ToolServiceId,
	type ToolResult,
} from "@milu/core";

import { lastMemoryDigest } from "./context.ts";
import { memoryQuerySchema } from "./extract.ts";
import { MemoryService, MemoryServiceId } from "./service.ts";
import { formatMemoryRecord, type MemoryKind, RECALL_MAX_DETAIL_CHARS, RECALL_MAX_TOTAL_CHARS } from "./store.ts";

interface MemoryParams {
	readonly query?: string;
	readonly kinds?: readonly MemoryKind[];
	readonly limit?: number;
	readonly includeSuperseded?: boolean;
}

export { MemoryServiceId };

export const memoryExtension: Extension = {
	id: "memory",
	apiVersion: 1,

	services: [
		{
			id: MemoryServiceId,
			create: (container) => new MemoryService(container.get(ModelsServiceId), container.get(SessionServiceId), container.get(SettingsServiceId)),
		},
	],

	contributions: {
		"composer.commands": [
			{
				id: "memory",
				name: "memory",
				description: "Incrementally organize the partner's long-term memory",
				kind: "leadingInput",
				hint: "[status|organize|scenes|persona|consolidate]",
				action: "memory.run",
			},
		],
	},

	activate(context) {
		const memory = context.get(MemoryServiceId);

		context.disposables.add(context.get(CompactionServiceId).register(({ session, entries }) => memory.planCompact(session, entries)));

		context.disposables.add(
			context.get(ToolServiceId).register({
				name: "memory",
				label: "Memory",
				description:
					"Read durable memories for this partner. Use it when a task depends on prior project facts, decisions, issues, references, preferences, instructions, or objective user-driven events. Matches are ranked by relevance when a query is given (newest first otherwise); superseded entries are hidden unless includeSuperseded is true. Long detail is truncated and large result sets are capped by an output budget.",
				parameters: memoryQuerySchema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const params = (call.params ?? {}) as MemoryParams;
					const memories = await memory.read(call.session, params);
					if (memories.length === 0) return say("No memories found.");
					const parts: string[] = [];
					let used = 0;
					let dropped = 0;
					for (const record of memories) {
						const text = formatMemoryRecord(record, { withDetail: true, maxDetailChars: RECALL_MAX_DETAIL_CHARS });
						if (parts.length > 0 && used + text.length > RECALL_MAX_TOTAL_CHARS) {
							dropped = memories.length - parts.length;
							break;
						}
						parts.push(text);
						used += text.length;
					}
					let text = parts.join("\n\n");
					if (dropped > 0) text += `\n\n(${memories.length} memories matched; ${dropped} hidden by the output budget — narrow the query or use a smaller limit.)`;
					return say(text, { ok: true });
				},
			}),
		);

		context.actions.register({
			id: "memory.run",
			run: async ({ session, args }) => {
				if (!session) throw new Error("memory.run needs a session");
				const raw = typeof args === "string" ? args : (args as { args?: unknown } | undefined)?.args;
				const [op] = (typeof raw === "string" ? raw : "").trim().split(/\s+/);
				if (!op || op === "organize") {
					if (session.running) throw new Error("the chat is busy");
					await memory.organize(session);
					return;
				}
				if (op === "status") {
					const text = await memory.status(session);
					await session.record(EVENTS.sendMessage, { text, via: "command", timestamp: Date.now() });
					return;
				}
				if (op === "scenes") {
					if (session.running) throw new Error("the chat is busy");
					await memory.scenes(session, true);
					await memory.persona(session);
					return;
				}
				if (op === "persona") {
					if (session.running) throw new Error("the chat is busy");
					await memory.persona(session, true);
					return;
				}
				if (op === "consolidate") {
					if (session.running) throw new Error("the chat is busy");
					await memory.consolidate(session);
					return;
				}
				throw new Error(`unknown /memory argument "${op}"`);
			},
		});

		context.disposables.add(
			context.get(HookServiceId).on("beforeRequest", async (hook) => {
				const next = await memory.context(hook.session);
				if (!next) return;
				if (lastMemoryDigest(hook.messages) === next.digest) return;
				hook.inject({ type: EVENTS.memoryContext, data: { text: next.text, digest: next.digest } });
			}),
		);

		context.disposables.add(
			context.get(SessionServiceId).onLoopEvent(({ session, event }) => {
				if (event.type === "run_end") memory.afterRun(session);
			}),
		);
	},
};

function say(text: string, details: Record<string, unknown> = { ok: true }): ToolResult {
	return { content: [{ type: "text", text }], details };
}
