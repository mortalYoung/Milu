import { createEditTool, createReadTool, createWriteTool, type Extension, IToolService, withEnv } from "@milu/core";

const filesExtension: Extension = {
	id: "files",
	apiVersion: 1,

	activate(context) {
		const tools = context.get(IToolService);
		context.disposables.add(tools.register(withEnv(createReadTool())));
		context.disposables.add(tools.register(withEnv(createWriteTool())));
		context.disposables.add(tools.register(withEnv(createEditTool())));
	},
};

export default filesExtension;
