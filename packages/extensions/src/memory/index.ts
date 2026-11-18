import {
	ICompactionService,
	EVENTS,
	type ActionContext,
	type AgentHookContext,
	type ExecutionEnv,
	type Extension,
	IContributionService,
	IHookService,
	IModelsService,
	ISessionService,
	SESSION_SIGNAL_POINT,
	type SessionSignalItem,
	ISettingsService,
	ITranscriptService,
	type ToolCall,
	IToolService,
	type ToolResult,
	type Session,
} from "@milu/core";

import { memoryQuerySchema } from "./extract.ts";
import { MemoryService, IMemoryService } from "./service/index.ts";
import { readSopDocs, readSopOp, sopReadSchema } from "./sop.ts";
import { formatMemoryRecord, isoDay, type MemoryKind, parseTime, readMemoryTrace, RECALL_MAX_DETAIL_CHARS, RECALL_MAX_TOTAL_CHARS, tooManyMatches } from "./store.ts";

interface MemoryParams {
	readonly query?: string;
	readonly kinds?: readonly MemoryKind[];
	readonly subject?: string;
	readonly predicate?: string;
	readonly from?: string;
	readonly to?: string;
	readonly limit?: number;
	readonly offset?: number;
	readonly includeSuperseded?: boolean;
	readonly rawIds?: readonly string[];
	readonly scope?: "atoms" | "entries";
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

	widgets: [{ id: "memory", type: "dialog", entry: "./widget/dialog.tsx" }],

	services: [
		{
			id: IMemoryService,
			create: (container) => new MemoryService(container.get(IModelsService), container.get(ISessionService), container.get(ISettingsService)),
		},
	],

	contributions: {
		"session.menu": [{ id: "memory", order: 4, group: "view", title: "Memory", icon: "brain", action: "memory.open" }],
		"composer.commands": [
			{
				id: "memory",
				name: "memory",
				description: "Open what this partner remembers, or organize it",
				kind: "leadingInput",
				hint: "[open|status|organize|sops|persona]",
				action: "memory.run",
			},
		],
	},

	activate(context) {
		const memory = context.get(IMemoryService);
		const transcripts = context.get(ITranscriptService);

		context.disposables.add(context.get(ICompactionService).register(({ session, entries, retainTokens }) => memory.planCompact(session, entries, retainTokens)));

		context.disposables.add(
			context.get(IToolService).register({
				name: "memory",
				label: "Memory",
				description:
					"Read this partner's stored atoms — what they own, what happened, what they prefer, the rules they set — and, when a detail is not in an atom, the transcript entries behind it. Atoms are an index: each lists ↳ entries; read those with rawIds, or search the transcript with scope=\"entries\". The transcript records what was said, so for a question about your own past message, recommendation or list it is the authority: quote it, and put any correction after the quote instead of replacing it. Check a question's premise against the record — when the record supports it, answer from the record even if the claim looks doubtful today; when it does not, say so. Separate alternatives with | (soccer|duathlon) to check several things in one call. Matching is literal; more than 30 matches is refused with narrowing hints, and records replaced by an update stay hidden unless includeSuperseded.",
				parameters: memoryQuerySchema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const params = (call.params ?? {}) as MemoryParams;
					if (params.rawIds !== undefined && params.rawIds.length > 0) {
						const found = await transcripts.find(call.session.root, params.rawIds, {
							...(params.offset === undefined ? {} : { offset: params.offset }),
							...(params.query === undefined ? {} : { around: params.query }),
						});
						const missing = params.rawIds.filter((id) => !found.some((entry) => entry.id === id));
						const parts = found.map((entry) => {
							const head = `# said ${isoDay(entry.at)} by ${entry.role} · ${entry.id} · chars ${entry.from + 1}-${entry.from + entry.text.length} of ${entry.total}`;
							const more = entry.from + entry.text.length < entry.total ? `\n(… continues: rawIds: ["${entry.id}"], offset: ${entry.from + entry.text.length})` : "";
							return `${head}\n${entry.text || "(no text)"}${more}`;
						});
						if (found.length === 0) return say(`No transcript entries for ${params.rawIds.slice(0, 3).join(", ")}.`, { ok: false });
						const lines = [parts.join("\n\n")];
						if (missing.length > 0) lines.push(`(not found in this partner's transcripts: ${missing.slice(0, 3).join(", ")})`);
						return say(lines.join("\n\n"), { ok: true, returned: found.length });
					}
					if (params.scope === "entries") {
						const hits = await transcripts.search(call.session.root, params.query ?? "", params.limit ?? 5);
						if (hits.length === 0) return say("No transcript entries match — try fewer or more distinctive words.", { ok: false });
						return say(
							[
								hits.map((hit) => `# ${hit.id} · ${isoDay(hit.at)} · ${hit.role} · ${hit.total} chars\n${hit.snippet}`).join("\n\n"),
								`(pass rawIds: ["${hits[0]!.id}"], offset: ${hits[0]!.from} to read this one on)`,
							].join("\n\n"),
							{ ok: true, returned: hits.length },
						);
					}
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
						offset: params.offset,
						includeSuperseded: params.includeSuperseded,
					});
					const tooMany = tooManyMatches(result);
					if (tooMany && (params.offset ?? 0) === 0) return say(`memory rejected: ${tooMany}`, { ok: false });
					if (result.stored === 0) return say("Memory is empty — nothing stored for this partner yet.");
					if (result.records.length === 0) return say("No atoms found.");
					const parts: string[] = [];
					let used = 0;
					for (const record of result.records) {
						const text = formatMemoryRecord(record, { withDetail: true, maxDetailChars: RECALL_MAX_DETAIL_CHARS, withSources: true });
						if (parts.length > 0 && used + text.length > RECALL_MAX_TOTAL_CHARS) break;
						parts.push(text);
						used += text.length;
					}
					const lines = [parts.join("\n\n")];
					if (result.matched > parts.length) {
						const showing = params.offset ?? 0;
						lines.push(`(showing ${showing + 1}-${showing + parts.length} of ${result.matched}; use offset=${showing + parts.length} for more, or narrow the query.)`);
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

		context.disposables.add(
			context
				.get(IContributionService)
				.get<SessionSignalItem>(SESSION_SIGNAL_POINT)
				.contribute({
					id: "memory",
					order: 6,
					chip: true,
					tone: "link",
					title: (session) => (memory.inFlight(session.name).length === 0 ? null : "memorying"),
				}),
		);

		const openPanel = async (session: Session, dialog: ActionContext["dialog"]): Promise<void> => {
			if (!dialog) throw new Error("opening the memory panel needs a dialog");
			await dialog({ kind: "custom", id: "memory", title: `Memory · ${session.name}`, data: { partner: session.name } });
		};

		context.actions.register({
			id: "memory.open",
			scope: "chat",
			hotkey: "Mod+Shift+M",
			run: async ({ session, dialog }) => {
				if (!session) throw new Error("memory.open needs a session");
				await openPanel(session, dialog);
			},
		});

		context.actions.register({
			id: "memory.transcript",
			run: async ({ session, args }) => {
				if (!session) throw new Error("memory.transcript needs a session");
				const raw = typeof args === "string" ? args : (args as { args?: unknown } | undefined)?.args;
				const runId = typeof raw === "string" ? raw.trim() : "";
				return { data: await readMemoryTrace(session.root, runId) };
			},
		});

		context.actions.register({
			id: "memory.collect",
			run: async ({ session }) => {
				if (!session) throw new Error("memory.collect needs a session");
				return { data: await memory.snapshot(session) };
			},
		});

		context.actions.register({
			id: "memory.run",
			run: async ({ session, args, dialog }) => {
				if (!session) throw new Error("memory.run needs a session");
				const raw = typeof args === "string" ? args : (args as { args?: unknown } | undefined)?.args;
				const [op] = (typeof raw === "string" ? raw : "").trim().split(/\s+/);
				if (op === "open") {
					if (!dialog) throw new Error("opening the memory panel needs a dialog");
					void openPanel(session, dialog).catch((error: unknown) => console.error(`memory ${session.name}: opening the panel failed:`, error));
					return;
				}
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
