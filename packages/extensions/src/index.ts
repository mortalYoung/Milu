import type { Extension } from "@milu/core";

import { chatExtension } from "./chat/chat.ts";
import { copyExtension } from "./copy/copy.ts";
import { createExtension } from "./create/create.ts";
import { detailsExtension } from "./details/details.ts";
import { meterExtension } from "./meter/meter.ts";
import { modelsExtension } from "./models/models.ts";
import { openExtension } from "./open/open.ts";
import { pinExtension } from "./pin/pin.ts";
import { promptExtension } from "./prompt/prompt.ts";
import { repliesExtension } from "./replies/replies.ts";
import { shellExtension } from "./shell/shell.ts";
import { tipsExtension } from "./tips/tips.ts";
import { trashExtension } from "./trash/trash.ts";

export const extensions: readonly Extension[] = [
	createExtension,
	detailsExtension,
	pinExtension,
	copyExtension,
	openExtension,
	trashExtension,
	chatExtension,
	repliesExtension,
	modelsExtension,
	meterExtension,
	shellExtension,
	tipsExtension,
	promptExtension,
];
