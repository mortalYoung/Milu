import { Type } from "typebox";

import { resolveToolPath } from "./path.ts";
import { getOrThrow } from "./result.ts";
import type { AgentHarnessTool, ExecutionToolContext } from "./types.ts";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export function createWriteTool(): AgentHarnessTool<ExecutionToolContext, typeof writeSchema, undefined> {
	return {
		name: "write",
		label: "write",
		description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: writeSchema,
		async execute(_toolCallId, { path, content }, signal, _onUpdate, { env }) {
			const absolutePath = await resolveToolPath(env, path, signal);
			if (signal?.aborted) throw new Error("Operation aborted");
			getOrThrow(await env.writeFile(absolutePath, content, signal));
			if (signal?.aborted) throw new Error("Operation aborted");
			return {
				content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
				details: undefined,
			};
		},
	};
}
