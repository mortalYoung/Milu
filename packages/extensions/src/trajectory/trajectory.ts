import type { Extension } from "@milu/core";

export const trajectoryExtension: Extension = {
	id: "trajectory",
	apiVersion: 1,

	contributions: {
		"chat.bar": [{ id: "trajectory", order: 30, component: "trajectory.bar" }],
		"chat.panes": [{ id: "trajectory", order: 5, component: "trajectory.pane" }],
	},
};
