import type { Extension } from "@milu/core";

import { copyExtension } from "./copy.ts";
import { openExtension } from "./open.ts";
import { pinExtension } from "./pin.ts";
import { trashExtension } from "./trash.ts";

export const extensions: readonly Extension[] = [pinExtension, copyExtension, openExtension, trashExtension];
