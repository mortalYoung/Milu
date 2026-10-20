import { bindEnv, createEditTool, createReadTool, createWriteTool, type Extension, ToolServiceId } from "@milu/core";

export const filesExtension: Extension = {
	id: "files",
	apiVersion: 1,

	activate(context) {
		const tools = context.get(ToolServiceId);
		context.disposables.add(tools.register(({ env }) => bindEnv(createReadTool(), { env })));
		context.disposables.add(tools.register(({ env }) => bindEnv(createWriteTool(), { env })));
		context.disposables.add(tools.register(({ env }) => bindEnv(createEditTool(), { env })));
	},
};
