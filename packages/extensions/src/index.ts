import type { Extension } from "@milu/core";

import { bashExtension } from "./bash/bash.ts";
import { chatExtension } from "./chat/chat.ts";
import { copyExtension } from "./copy/copy.ts";
import { createExtension } from "./create/create.ts";
import { detailsExtension } from "./details/details.ts";
import { fetchExtension } from "./fetch/fetch.ts";
import { filesExtension } from "./files/files.ts";
import { mcpExtension } from "./mcp/mcp.ts";
import { meterExtension } from "./meter/meter.ts";
import { modelsExtension } from "./models/models.ts";
import { openExtension } from "./open/open.ts";
import { peerExtension } from "./peer/peer.ts";
import { permissionExtension } from "./permission/permission.ts";
import { pinExtension } from "./pin/pin.ts";
import { promptExtension } from "./prompt/prompt.ts";
import { remindersExtension } from "./reminders/reminders.ts";
import { repliesExtension } from "./replies/replies.ts";
import { rmExtension } from "./rm/rm.ts";
import { scheduleExtension } from "./schedule/schedule.ts";
import { shellExtension } from "./shell/shell.ts";
import { skillsExtension } from "./skills/skills.ts";
import { tasksExtension } from "./tasks/tasks.ts";
import { tipsExtension } from "./tips/tips.ts";
import { trashExtension } from "./trash/trash.ts";

export const extensions: readonly Extension[] = [
	createExtension,
	detailsExtension,
	pinExtension,
	copyExtension,
	openExtension,
	trashExtension,
	permissionExtension,
	chatExtension,
	filesExtension,
	bashExtension,
	tasksExtension,
	rmExtension,
	mcpExtension,
	scheduleExtension,
	peerExtension,
	fetchExtension,
	skillsExtension,
	remindersExtension,
	repliesExtension,
	modelsExtension,
	meterExtension,
	shellExtension,
	tipsExtension,
	promptExtension,
];
