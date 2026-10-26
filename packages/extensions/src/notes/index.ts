import type { Extension } from "@milu/core";

export type StepDisplay = "flat" | "collapsed";

export const DEFAULT_STEP_DISPLAY: StepDisplay = "flat";

const notesExtension: Extension = {
	id: "notes",
	apiVersion: 1,
	widgets: [
		{ id: "step", type: "row", entry: "./widget/step.tsx", export: "StepRow" },
		{ id: "thinking", type: "row", entry: "./widget/note.tsx", export: "ThinkingRow" },
		{ id: "tool", type: "row", entry: "./widget/note.tsx", export: "ToolRow" },
		{ id: "say", type: "row", entry: "./widget/note.tsx", export: "SayRow" },
	],

	activate(context) {
		const display = context.disposables.add(context.settings.declare({ key: "workStepsDisplay", defaults: DEFAULT_STEP_DISPLAY }));

		context.actions.register({
			id: "notes.display",
			run: () => ({ data: display.get() }),
		});
	},
};

export default notesExtension;
