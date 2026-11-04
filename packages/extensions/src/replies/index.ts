import type { Extension } from "@milu/core";

const repliesExtension: Extension = {
	id: "replies",
	apiVersion: 1,
	widgets: [
		{ id: "replies.bar", type: "slot", entry: "./widget/replies.tsx", export: "RepliesButton" },
		{ id: "replies.pane", type: "slot", entry: "./widget/replies.tsx", export: "RepliesPane" },
		{ id: "replies.state", type: "service", entry: "./widget/service.ts" },
	],

	contributions: {
		"chat.bar": [{ id: "replies", order: 10, component: "replies.bar" }],
		"chat.panes": [{ id: "replies", order: 10, component: "replies.pane" }],
	},
};

export default repliesExtension;
