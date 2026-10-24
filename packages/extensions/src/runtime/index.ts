import { type Extension, ISessionService } from "@milu/core";

import { RuntimeStatsService, IRuntimeStatsService } from "./service/index.ts";

export { IRuntimeStatsService } from "./service/index.ts";

export type { RuntimeStatsSnapshot, RuntimeSummary } from "./service/index.ts";

const runtimeExtension: Extension = {
	id: "runtime",
	apiVersion: 1,

	services: [{ id: IRuntimeStatsService, create: (container) => new RuntimeStatsService(container.get(ISessionService)) }],
};

export default runtimeExtension;
