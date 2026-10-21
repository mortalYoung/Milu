import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentHookContext, type AgentReminder, EVENTS, type Extension, expandHome, HookServiceId, reminderText, type SettingsService } from "@milu/core";

import { type SkillsService, SkillsServiceId } from "../skills/service.ts";

const HOUR = 60 * 60 * 1000;

function carries(context: AgentHookContext, text: string): boolean {
	return context.messages.some((message) => message.role === "user" && message.content === text);
}

function lastTime(context: AgentHookContext): number {
	for (let at = context.messages.length - 1; at >= 0; at -= 1) {
		const message = context.messages[at];
		if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
		return message.timestamp ?? 0;
	}
	return 0;
}

function injectUnlessCarried(context: AgentHookContext, reminder: AgentReminder): void {
	if (!carries(context, reminderText(reminder.type, reminder.data))) context.inject(reminder);
}

function timeGap(context: AgentHookContext): void {
	const last = lastTime(context);
	if (last <= 0) return;
	const now = Date.now();
	if (new Date(last).toDateString() === new Date(now).toDateString()) return;
	if (now - last < HOUR) return;
	injectUnlessCarried(context, {
		type: EVENTS.timeGapReminder,
		data: {
			text: `<system_reminder>The last message was on ${new Date(last).toLocaleString()} and it is now ${new Date(now).toLocaleString()}. Time has passed since the previous exchange; take the current date and time into account when responding.</system_reminder>`,
		},
	});
}

function digestOf(name: string, description: string): string {
	return createHash("sha256").update(`${name}\n${description}`).digest("hex");
}

async function contextChanged(context: AgentHookContext, settings: SettingsService, skills: SkillsService): Promise<void> {
	const workspace = await context.session.workspace();
	injectUnlessCarried(context, {
		type: EVENTS.contextChanged,
		data: {
			workspace: workspace ? expandHome(workspace.path) : null,
			storage: join(context.session.root, "storage"),
			sandbox: settings.get().defaultSandboxMode ?? "workspace-write",
			skills: (await skills.list(context.session)).map((skill) => ({ name: skill.name, description: skill.description, digest: digestOf(skill.name, skill.description) })),
		},
	});
}

async function instructionsChanged(context: AgentHookContext, settings: SettingsService): Promise<void> {
	const workspace = await context.session.workspace();
	let agentMd: string | null = null;
	if (workspace) {
		try {
			agentMd = await readFile(join(expandHome(workspace.path), settings.get().detect_instructions_file || "AGENTS.md"), "utf8");
		} catch {
			agentMd = null;
		}
	}
	injectUnlessCarried(context, { type: EVENTS.instructionsChanged, data: { agentMd } });
}

export const remindersExtension: Extension = {
	id: "reminders",
	apiVersion: 1,

	activate(context) {
		const hooks = context.get(HookServiceId);
		const skills = context.get(SkillsServiceId);
		context.disposables.add(hooks.on("beforeRun", timeGap));
		context.disposables.add(hooks.on("beforeRequest", (each) => contextChanged(each, context.settings, skills)));
		context.disposables.add(hooks.on("beforeRequest", (each) => instructionsChanged(each, context.settings)));
	},
};
