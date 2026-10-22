import { createEditTool, createReadTool, createWriteTool, type Extension, ToolServiceId, withEnv } from "@milu/core";

export const filesExtension: Extension = {
	id: "files",
	apiVersion: 1,

	activate(context) {
		const tools = context.get(ToolServiceId);
		context.disposables.add(tools.register(withEnv(createReadTool())));
		context.disposables.add(tools.register(withEnv(createWriteTool())));
		context.disposables.add(tools.register(withEnv(createEditTool())));
	},
};
