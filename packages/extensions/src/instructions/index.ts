import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentHookContext, EVENTS, type Extension, expandHome, IHookService, reminderText } from "@milu/core";

const DEFAULT_FILE = "AGENTS.md";

function carries(context: AgentHookContext, text: string): boolean {
	return context.messages.some((message) => message.role === "user" && message.content === text);
}

const instructionsExtension: Extension = {
	id: "instructions",
	apiVersion: 1,

	activate(context) {
		const file = context.disposables.add(context.settings.declare({ key: "detect_instructions_file", defaults: DEFAULT_FILE }));

		const hooks = context.get(IHookService);
		const inject = async (each: AgentHookContext): Promise<void> => {
			const workspace = await each.session.workspace();
			const agentMd = workspace ? await readFile(join(expandHome(workspace.path), file.get() || DEFAULT_FILE), "utf8").catch(() => null) : null;
			const reminder = { type: EVENTS.instructionsChanged, data: { agentMd } } as const;
			if (!carries(each, reminderText(reminder.type, reminder.data))) each.inject(reminder);
		};
		context.disposables.add(hooks.on("beforeRequest", inject));
		context.disposables.add(hooks.on("afterCompact", inject));
	},
};

export default instructionsExtension;
