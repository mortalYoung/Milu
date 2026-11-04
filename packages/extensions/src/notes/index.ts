import type { Extension } from "@milu/core";

const notesExtension: Extension = {
	id: "notes",
	apiVersion: 1,
	widgets: [{ id: "step", type: "row", entry: "./widget/step.tsx", export: "StepRow" }],
};

export default notesExtension;
