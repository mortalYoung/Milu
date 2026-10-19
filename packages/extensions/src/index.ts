import type { Extension } from "@milu/core";

import { actionsExtension } from "./actions.ts";

export const extensions: readonly Extension[] = [actionsExtension];
