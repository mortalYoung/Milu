import type { Extension } from "@milu/core";

import { bashExtension } from "./bash/index.ts";
import { chatExtension } from "./chat/index.ts";
import { copyExtension } from "./copy/index.ts";
import { createExtension } from "./create/index.ts";
import { detailsExtension } from "./details/index.ts";
import { fetchExtension } from "./fetch/index.ts";
import { filesExtension } from "./files/index.ts";
import { mcpExtension } from "./mcp/index.ts";
import { meterExtension } from "./meter/index.ts";
import { modelsExtension } from "./models/index.ts";
import { openExtension } from "./open/index.ts";
import { peerExtension } from "./peer/index.ts";
import { permissionExtension } from "./permission/index.ts";
import { pinExtension } from "./pin/index.ts";
import { promptExtension } from "./prompt/index.ts";
import { remindersExtension } from "./reminders/index.ts";
import { repliesExtension } from "./replies/index.ts";
import { rmExtension } from "./rm/index.ts";
import { runtimeExtension } from "./runtime/index.ts";
import { scheduleExtension } from "./schedule/index.ts";
import { shellExtension } from "./shell/index.ts";
import { skillsExtension } from "./skills/index.ts";
import { tasksExtension } from "./tasks/index.ts";
import { tipsExtension } from "./tips/index.ts";
import { trajectoryExtension } from "./trajectory/index.ts";
import { trashExtension } from "./trash/index.ts";

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
	runtimeExtension,
	modelsExtension,
	meterExtension,
	shellExtension,
	tipsExtension,
	trajectoryExtension,
	promptExtension,
];
