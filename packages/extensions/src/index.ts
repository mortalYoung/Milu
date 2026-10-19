import type { Extension } from "@milu/core";

import { actionsExtension } from "./actions.ts";
import { meterExtension, modelsExtension } from "./composer.ts";
import { promptExtension } from "./prompt.ts";
import { shellExtension, tipsExtension } from "./shell.ts";

export const extensions: readonly Extension[] = [actionsExtension, promptExtension, modelsExtension, meterExtension, shellExtension, tipsExtension];
