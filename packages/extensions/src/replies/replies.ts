import type { Extension } from "@milu/core";

export const repliesExtension: Extension = {
	id: "replies",
	apiVersion: 1,

	contributions: {
		"chat.bar": [{ id: "replies", order: 10, component: "replies.bar" }],
		"chat.panes": [{ id: "replies", order: 10, component: "replies.pane" }],
	},
};
