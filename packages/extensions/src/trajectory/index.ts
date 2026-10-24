import type { Extension } from "@milu/core";

const trajectoryExtension: Extension = {
	id: "trajectory",
	apiVersion: 1,
	widgets: [
		{ id: "trajectory.bar", type: "slot", entry: "./widget/trajectory.tsx", export: "TrajectoryButton" },
		{ id: "trajectory.pane", type: "slot", entry: "./widget/trajectory.tsx", export: "TrajectoryPane" },
		{ id: "trajectory.state", type: "service", entry: "./widget/service.ts" },
	],

	contributions: {
		"chat.bar": [{ id: "trajectory", order: 30, component: "trajectory.bar" }],
		"chat.panes": [{ id: "trajectory", order: 5, component: "trajectory.pane" }],
	},
};

export default trajectoryExtension;
