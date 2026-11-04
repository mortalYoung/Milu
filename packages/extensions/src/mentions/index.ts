import type { Extension } from "@milu/core";

const mentionsExtension: Extension = {
	id: "mentions",
	apiVersion: 1,

	widgets: [
		{ id: "mentions.files", type: "markdown", entry: "./widget/plugin.ts", export: "mentionsPlugin" },
		{ id: "mentions.mount", type: "slot", entry: "./widget/mount.tsx", export: "MentionsMount" },
	],

	contributions: {
		"chat.panes": [{ id: "mentions", order: 40, component: "mentions.mount" }],
	},
};

export default mentionsExtension;
