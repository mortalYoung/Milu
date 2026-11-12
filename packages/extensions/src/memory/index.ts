import {
	ICompactionService,
	EVENTS,
	type AgentHookContext,
	type ExecutionEnv,
	type Extension,
	IHookService,
	IModelsService,
	ISessionService,
	ISettingsService,
	type ToolCall,
	IToolService,
	type ToolResult,
} from "@milu/core";

import { memoryQuerySchema } from "./extract.ts";
import { MemoryService, IMemoryService } from "./service/index.ts";
import { readSopDocs, readSopOp, sopReadSchema } from "./sop.ts";
import { formatMemoryRecord, type MemoryKind, parseTime, RECALL_MAX_DETAIL_CHARS, RECALL_MAX_TOTAL_CHARS } from "./store.ts";

interface MemoryParams {
	readonly query?: string;
	readonly kinds?: readonly MemoryKind[];
	readonly subject?: string;
	readonly predicate?: string;
	readonly from?: string;
	readonly to?: string;
	readonly limit?: number;
	readonly includeSuperseded?: boolean;
}

interface SopParams {
	readonly op?: "list" | "read" | "read_metadata";
	readonly query?: string;
	readonly id?: string;
	readonly offset?: number;
	readonly limit?: number;
}

export { IMemoryService };

export const memoryExtension: Extension = {
	id: "memory",
	apiVersion: 1,

	services: [
		{
			id: IMemoryService,
			create: (container) => new MemoryService(container.get(IModelsService), container.get(ISessionService), container.get(ISettingsService)),
		},
	],

	contributions: {
		"composer.commands": [
			{
				id: "memory",
				name: "memory",
				description: "Organize this partner's long-term memory",
				kind: "leadingInput",
				hint: "[status|organize|sops|persona]",
				action: "memory.run",
			},
		],
	},

	activate(context) {
		const memory = context.get(IMemoryService);

		context.disposables.add(context.get(ICompactionService).register(({ session, entries }) => memory.planCompact(session, entries)));

		context.disposables.add(
			context.get(IToolService).register({
				name: "memory",
				label: "Memory",
				description:
					"Read this partner's atoms (attribute / event / reference / preference / instruction / update). Matches are ranked by relevance when a query is given, otherwise newest first by event time; records replaced by an update are hidden unless includeSuperseded is true. Conflicts (one subject+predicate with several values) are reported at the end.",
				parameters: memoryQuerySchema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const params = (call.params ?? {}) as MemoryParams;
					const from = parseTime(params.from);
					const to = parseTime(params.to);
					const result = await memory.read(call.session, {
						query: params.query,
						kinds: params.kinds,
						subject: params.subject,
						predicate: params.predicate,
						...(from !== null ? { from } : {}),
						...(to !== null ? { to } : {}),
						limit: params.limit,
						includeSuperseded: params.includeSuperseded,
					});
					if (result.records.length === 0) return say("No atoms found.");
					const parts: string[] = [];
					let used = 0;
					for (const record of result.records) {
						const text = formatMemoryRecord(record, { withDetail: true, maxDetailChars: RECALL_MAX_DETAIL_CHARS });
						if (parts.length > 0 && used + text.length > RECALL_MAX_TOTAL_CHARS) break;
						parts.push(text);
						used += text.length;
					}
					const lines = [parts.join("\n\n")];
					if (result.matched > parts.length) {
						lines.push(`(${result.matched} matched; ${result.matched - parts.length} hidden by the output budget — narrow the query or lower limit.)`);
					}
					if (result.conflicts.length > 0) {
						lines.push(
							`Conflicts (no update chain; treat as unsettled):\n${result.conflicts
								.map((conflict) => `- ${conflict.subject}.${conflict.predicate}: ${conflict.values.map((value) => String(value)).join(" / ")} (${conflict.ids.join(", ")})`)
								.join("\n")}`,
						);
					}
					return say(lines.join("\n\n"), { ok: true, matched: result.matched, returned: parts.length });
				},
			}),
		);

		context.disposables.add(
			context.get(IToolService).register({
				name: "sop",
				label: "SOP",
				description:
					"This partner's SOP documents (distilled procedures for recurring tasks). op list: every SOP as one line; op read: the five-section body, paged by line (offset is 1-indexed, default limit 120); op read_metadata: only the YAML header with sources and evidence.",
				parameters: sopReadSchema,
				async run(call: ToolCall) {
					const params = (call.params ?? {}) as SopParams;
					const docs = await readSopDocs(call.session.root);
					const text = readSopOp(docs, {
						op: params.op ?? "list",
						...(params.query ? { query: params.query } : {}),
						...(params.id ? { id: params.id } : {}),
						...(params.offset !== undefined ? { offset: params.offset } : {}),
						...(params.limit !== undefined ? { limit: params.limit } : {}),
					});
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
				if (op === "sops") {
					if (session.running) throw new Error("the chat is busy");
					await memory.sops(session);
					return;
				}
				if (op === "persona") {
					if (session.running) throw new Error("the chat is busy");
					await memory.persona(session);
					return;
				}
				throw new Error(`unknown /memory argument "${op}"`);
			},
		});

		const hooks = context.get(IHookService);
		const carried = (hook: AgentHookContext, text: string): boolean => hook.messages.some((message) => message.role === "user" && message.content === text);

		const person = async (hook: AgentHookContext): Promise<void> => {
			const { persona } = await memory.context(hook.session);
			if (!persona || carried(hook, persona.text)) return;
			hook.inject({ type: EVENTS.personaReminder, data: { text: persona.text, digest: persona.digest }, priority: -1 });
		};

		const sopIndexFull = async (hook: AgentHookContext): Promise<void> => {
			const index = await memory.sopIndex(hook.session);
			if (!index || carried(hook, index.text)) return;
			hook.inject({ type: EVENTS.sopReminder, data: { text: index.text, digest: index.digest } });
		};

		const beforeRequest = async (hook: AgentHookContext): Promise<void> => {
			await person(hook);
			const updates = memory.takeSopUpdates(hook.session.name);
			if (updates) {
				hook.inject({ type: EVENTS.sopReminder, data: { text: updates.text, digest: updates.digest } });
				return;
			}
			await sopIndexFull(hook);
		};

		const afterCompact = async (hook: AgentHookContext): Promise<void> => {
			await person(hook);
			await sopIndexFull(hook);
		};

		context.disposables.add(hooks.on("beforeRequest", beforeRequest));
		context.disposables.add(hooks.on("afterCompact", afterCompact));

		context.disposables.add(
			context.get(ISessionService).onLoopEvent(({ session, event }) => {
				if (event.type === "run_end") memory.afterRun(session);
			}),
		);
	},
};

function say(text: string, details: Record<string, unknown> = { ok: true }): ToolResult {
	return { content: [{ type: "text", text }], details };
}

export default memoryExtension;
