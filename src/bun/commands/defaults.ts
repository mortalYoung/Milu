import { command as clear } from "./builtin/clear";
import { command as compact } from "./builtin/compact";
import { command as memory } from "./builtin/memory";
import { command as workspace } from "./builtin/workspace";
import type { CommandDefinition } from "./types";

export function defaultCommands(): CommandDefinition[] {
	return [compact, clear, memory, workspace];
}
