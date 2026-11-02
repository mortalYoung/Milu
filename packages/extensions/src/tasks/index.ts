import {
	COMPOSER_LEFT_POINT,
	type ComposerWidgetItem,
	IContributionService,
	type ExecutionEnv,
	type Extension,
	type Session,
	type ToolCall,
	type ToolMiddleware,
	type ToolNext,
	type SessionSignalItem,
	type ToolResult,
	IToolService,
	SESSION_SIGNAL_POINT,
	Type,
} from "@milu/core";
import type { DialogDescriptor } from "@milu/protocol";

import { TaskService, ITaskService } from "./service/index.ts";

const backgroundField = {
	background: Type.Optional(
		Type.Boolean({
			description:
				"Run it detached and return a task id immediately, without waiting. Use for servers, watchers, or anything that doesn't exit on its own; also for a long job you'd rather not block on. " +
				'Not compatible with timeout. Read its output with the task tool (op: "read"); to be notified when it ends, call the task tool (op: "subscribe").',
		}),
	),
};

const schema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("subscribe"), Type.Literal("stop")], {
		description: 'What to do with the task: "read" its output tail, "subscribe" to be notified when it ends, or "stop" it.',
	}),
	id: Type.String({ description: "Task id returned by bash with background: true." }),
	lines: Type.Optional(Type.Number({ description: "read: how many tail lines to return. Defaults to 200." })),
	remind_after: Type.Optional(Type.Number({ description: "subscribe: seconds until a one-off reminder that the task is still running. Defaults to 180. Does not kill the task." })),
});

interface TaskParams {
	op: "read" | "subscribe" | "stop";
	id: string;
	lines?: number;
	remind_after?: number;
}

function text(value: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text: value }], details };
}

const tasksExtension: Extension = {
	id: "tasks",
	apiVersion: 1,
	widgets: [
		{ id: "tasks", type: "widget", entry: "./widget/tasks.tsx", export: "TasksWidget" },
		{ id: "tasks", type: "dialog", entry: "./widget/tasks.tsx", export: "TasksDialog" },
	],

	services: [{ id: ITaskService, create: () => new TaskService() }],

	activate(context) {
		const tasks = context.get(ITaskService);
		const tools = context.get(IToolService);

		context.disposables.add(
			context
				.get(IContributionService)
				.get<SessionSignalItem>(SESSION_SIGNAL_POINT)
				.contribute({
					id: "tasks",
					order: 20,
					icon: "terminal",
					title: async (session) => {
						const summary = await tasks.summary(session);
						if (summary.running === 0) return null;
						return summary.running === 1 ? "1 running background task" : `${summary.running} running background tasks`;
					},
				}),
		);

		context.disposables.add(
			context
				.get(IContributionService)
				.get<ComposerWidgetItem>(COMPOSER_LEFT_POINT)
				.contribute({
					id: "tasks",
					order: 60,
					widget: "tasks",
					data: async (session: Session) => {
						const summary = await tasks.summary(session);
						return summary.total === 0 ? null : { session: session.name, ...summary };
					},
				}),
		);

		context.actions.register({
			id: "tasks.open",
			run: async ({ session, dialog }) => {
				if (!session || !dialog) throw new Error("tasks.open needs a session");
				await dialog({ kind: "custom", id: "tasks", title: "Tasks", data: await tasks.dialogData(session) } satisfies DialogDescriptor);
			},
		});

		context.actions.register({
			id: "tasks.collect",
			run: async ({ session }) => {
				if (!session) throw new Error("tasks.collect needs a session");
				return { data: await tasks.dialogData(session) };
			},
		});

		context.actions.register({
			id: "tasks.stop",
			run: async ({ args }) => {
				const { id } = (args ?? {}) as { id?: string };
				if (!id) throw new Error("tasks.stop needs an id");
				const outcome = await tasks.stop(id);
				if (!outcome.ok) throw new Error(outcome.error ?? `cannot stop ${id}`);
			},
		});

		context.disposables.add(tools.extend({ tools: ["bash"], properties: backgroundField }));

		const intercept: ToolMiddleware = async (call: ToolCall, env: ExecutionEnv, next: ToolNext) => {
			const { command, background, timeout } = (call.params ?? {}) as { command?: string; background?: boolean; timeout?: number };
			if (!background) return next(call, env);
			if (timeout !== undefined) return text('timeout is not supported with background; end the task with task { op: "stop", id } instead.');
			const started = await tasks.start(call.session, env, String(command ?? ""));
			if (!started.ok) return text(`Failed to start: ${started.error}`);
			return text(
				[
					`Started task ${started.id} in the background.`,
					`Notify me when it ends:  task { op: "subscribe", id: "${started.id}" }`,
					`Read its output now:     task { op: "read", id: "${started.id}" }`,
				].join("\n"),
				{ taskId: started.id },
			);
		};
		context.disposables.add(tools.use(intercept));

		context.disposables.add(
			tools.register({
				name: "task",
				label: "Task",
				description:
					"Inspect or stop a background task started by bash with background: true.\n" +
					"- read: the last lines of its output, plus its status and exit code.\n" +
					"- subscribe: get a follow-up message when the task ends (once). If it is still running after `remind_after` seconds you also get one reminder; the task keeps running.\n" +
					"- stop: kill the task's process group.",
				parameters: schema,
				async run(call: ToolCall) {
					const { op, id, lines, remind_after } = call.params as TaskParams;

					if (op === "read") {
						const result = await tasks.read(call.session, id, lines === undefined ? {} : { lines });
						if (!result.ok) return text(result.error);
						const head = `${result.status}${result.exitCode === undefined ? "" : ` · exit ${result.exitCode}`} · ${result.bytes} bytes`;
						return text(result.text.trim() ? `${head}\n\n${result.text}` : head);
					}

					if (op === "subscribe") {
						const result = await tasks.subscribe(call.session, id, remind_after);
						if (!result.ok) return text(result.error);
						if (result.exited) return text(`Task ${id} already ended${result.exitCode === undefined ? "" : ` with exit code ${result.exitCode}`}.`);
						return text(`Subscribed. I will be messaged when ${id} ends, and reminded after ${result.remindAfter}s if it is still running.`);
					}

					const stopped = await tasks.stop(id);
					return text(stopped.ok ? `Stopped task ${id}.` : (stopped.error ?? "stop failed"), { ok: stopped.ok });
				},
			}),
		);
	},
};

export default tasksExtension;
