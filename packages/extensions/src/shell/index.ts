import { type Extension, EVENTS, expandHome, type Session } from "@milu/core";

import { IPermissionService } from "../permission/index.ts";

const MAX_OUTPUT_CHARS = 50 * 1024;

function tail(text: string): string {
	return text.length <= MAX_OUTPUT_CHARS ? text : `…${text.slice(-MAX_OUTPUT_CHARS)}`;
}

const shellExtension: Extension = {
	id: "shell",
	apiVersion: 1,
	widgets: [
		{ id: "shell", type: "widget", entry: "./widget/shell.tsx" },
		{ id: "shell", type: "row", entry: "./widget/shell-row.tsx", export: "ShellRow" },
	],

	contributions: {
		"composer.left": [{ id: "shell", order: 10, widget: "shell" }],
	},

	activate(context) {
		const continuous = context.disposables.add(context.settings.declare({ key: "shellContinuous", defaults: true }));
		const permission = context.get(IPermissionService);

		const run = async (session: Session, command: string): Promise<void> => {
			const started = Date.now();
			const shellId = `shell-${started.toString(36)}`;
			await session.record(EVENTS.shellRun, { shellId, command, timestamp: started });

			const workspace = await session.workspace();
			const env = await permission.env(session, workspace ? expandHome(workspace.path) : null);
			const result = await env.exec(command, {});
			const exitCode = result.ok ? result.value.exitCode : undefined;
			const output = result.ok
				? [result.value.stdout, result.value.stderr]
						.filter((part) => part !== "")
						.join("\n")
						.trim() || "(no output)"
				: result.error.message;
			const text = `${output}${exitCode === undefined || exitCode === 0 ? "" : `\n\nCommand exited with code ${exitCode}`}`;

			await session.record(EVENTS.shellDone, {
				shellId,
				command,
				kind: result.ok && exitCode === 0 ? "success" : "error",
				text: tail(text),
				...(exitCode === undefined ? {} : { exitCode }),
				timestamp: Date.now(),
			});
			await session.record(EVENTS.sendMessage, { text: `$ ${command}\n\n${tail(text)}`, via: "shell", shellId, timestamp: Date.now() });
		};

		context.actions.register({
			id: "shell.toggle",
			scope: ["composer.focus", "composer.empty"],
			hotkey: "Tab",
			run: ({ session }) => context.composer.toggle(session),
		});

		context.actions.register({
			id: "shell.exit",
			scope: "composer.shell",
			hotkey: "Escape",
			run: ({ session }) => context.composer.setMode(session, "chat"),
		});

		context.actions.register({
			id: "shell.run",
			run: ({ session, args }) => {
				if (!session) throw new Error("shell.run needs a session");
				const command = String((args as { command?: unknown } | undefined)?.command ?? "").trim();
				if (command === "") throw new Error("shell.run needs a command");
				if (session.running) throw new Error(`"${session.name}" is running — stop it before running a shell command`);

				if (continuous.get() !== true) context.composer.setMode(session, "chat");
				void run(session, command).catch((error: unknown) => console.error(`shell: "${command}" did not finish:`, error));
			},
		});
	},
};

export default shellExtension;
