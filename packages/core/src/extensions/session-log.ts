import type { Extension, ExtensionContext } from "./types.ts";

export const sessionLogExtension: Extension = {
	id: "session-log",

	async activate(context: ExtensionContext): Promise<void> {
		const resumed = await context.sessions.transcript();
		if (resumed.length > 0) context.loop.restore(resumed);

		const started = new Map<string, number>();

		context.disposables.add(
			context.loop.events((event) => {
				if (event.type === "message_update") return;
				const progress = { run: event.run, turn: event.turn };

				switch (event.type) {
					case "message_end":
						void context.sessions.append(event.message);
						return;

					case "run_start":
						void context.sessions.record("milu/run", { ...progress, phase: "start", at: Date.now() });
						return;

					case "run_end":
						void context.sessions.record("milu/run", { ...progress, phase: "end", at: Date.now(), ...(event.error ? { error: event.error } : {}) });
						return;

					case "turn_start":
						void context.sessions.record("milu/turn", { ...progress, phase: "start", at: Date.now() });
						return;

					case "turn_end":
						void context.sessions.record("milu/turn", { ...progress, phase: "end", at: Date.now() });
						return;

					case "tool_start":
						started.set(event.toolCallId, Date.now());
						void context.sessions.record("milu/tool", { ...progress, phase: "start", id: event.toolCallId, name: event.toolName });
						return;

					case "tool_end": {
						const at = started.get(event.toolCallId);
						started.delete(event.toolCallId);
						const ms = at === undefined ? undefined : Date.now() - at;
						void context.sessions.record("milu/tool", {
							...progress,
							phase: "end",
							id: event.toolCallId,
							name: event.toolName,
							isError: event.isError,
							...(ms === undefined ? {} : { ms }),
						});
						return;
					}
				}
			}),
		);
	},
};
