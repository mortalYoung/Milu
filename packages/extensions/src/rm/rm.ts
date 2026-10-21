import { type ExecutionEnv, type Extension, type ToolCall, ToolServiceId, Type } from "@milu/core";

import { PermissionServiceId } from "../permission/service.ts";

const schema = Type.Object({
	paths: Type.Array(Type.String(), { description: "Files or directories to delete. Absolute, or relative to the working directory." }),
	dir: Type.Boolean({ description: "True when these paths are directories. A mismatch with the filesystem is refused." }),
});

interface RmDetails {
	ok: boolean;
	code?: string;
	deleted: string[];
	failed: { path: string; error: string }[];
}

interface RmParams {
	paths: string[];
	dir: boolean;
}

async function remove(path: string, dir: boolean, env: ExecutionEnv): Promise<string | null> {
	const info = await env.fileInfo(path);
	if (!info.ok) return info.error.message;
	if ((info.value.kind === "directory") !== dir) return dir ? "declared dir=true but this is not a directory" : "declared dir=false but this is a directory";
	const removed = await env.remove(path, { recursive: dir });
	return removed.ok ? null : removed.error.message;
}

export const rmExtension: Extension = {
	id: "rm",
	apiVersion: 1,

	activate(context) {
		const trash = context.get(PermissionServiceId).trash();

		context.disposables.add(
			context.get(ToolServiceId).register({
				name: "rm",
				label: "rm",
				description: `Irreversibly delete files and directories — no trash, no undo. This is the fallback for when moving a path to the trash did not work (disk full, file too large, permissions). It only runs after a bash call has failed while moving those paths into the trash, and refuses otherwise. For a recoverable delete, use bash instead: \`mv <path> ${trash}/\`.`,
				parameters: schema,
				async run(call: ToolCall, env: ExecutionEnv) {
					const { paths, dir } = call.params as RmParams;
					const deleted: string[] = [];
					const failed: { path: string; error: string }[] = [];
					for (const path of paths) {
						const error = await remove(path, dir, env);
						if (error === null) deleted.push(path);
						else failed.push({ path, error });
					}

					const text = [
						`force-deleted ${deleted.length} of ${paths.length} after the failed trash move`,
						...deleted.map((path) => `  - ${path}`),
						...failed.map((entry) => `  ! ${entry.path}: ${entry.error}`),
					].join("\n");
					return { content: [{ type: "text", text }], details: { ok: failed.length === 0, deleted, failed } satisfies RmDetails };
				},
			}),
		);
	},
};
