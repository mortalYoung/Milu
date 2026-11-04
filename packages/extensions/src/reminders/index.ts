import { createHash } from "node:crypto";
import { join } from "node:path";

import { type AgentHookContext, type AgentReminder, EVENTS, type Extension, expandHome, IHookService, reminderText } from "@milu/core";

import { IPermissionService } from "../permission/index.ts";
import { type SkillsService, ISkillsService } from "../skills/service/index.ts";

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

async function contextChanged(context: AgentHookContext, skills: SkillsService, sandbox: string): Promise<void> {
	const workspace = await context.session.workspace();
	injectUnlessCarried(context, {
		type: EVENTS.contextChanged,
		data: {
			workspace: workspace ? expandHome(workspace.path) : null,
			storage: join(context.session.root, "storage"),
			sandbox,
			skills: (await skills.list(context.session)).map((skill) => ({ name: skill.name, description: skill.description, digest: digestOf(skill.name, skill.description) })),
		},
	});
}

const remindersExtension: Extension = {
	id: "reminders",
	apiVersion: 1,

	activate(context) {
		const hooks = context.get(IHookService);
		const skills = context.get(ISkillsService);
		const permission = context.get(IPermissionService);
		const refresh = async (each: AgentHookContext): Promise<void> => contextChanged(each, skills, await permission.mode(each.session));
		context.disposables.add(hooks.on("beforeRun", timeGap));
		context.disposables.add(hooks.on("beforeRequest", refresh));
		context.disposables.add(hooks.on("afterCompact", refresh));
	},
};

export default remindersExtension;
