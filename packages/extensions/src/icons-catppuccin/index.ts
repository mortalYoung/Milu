import type { Extension } from "@milu/core";

const iconsCatppuccin: Extension = {
	id: "icons-catppuccin",
	apiVersion: 1,

	widgets: [{ id: "icons.catppuccin", type: "service", entry: "./widget/service.ts" }],
};

export default iconsCatppuccin;
