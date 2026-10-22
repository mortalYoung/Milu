import { type Extension, SessionServiceId } from "@milu/core";

import { RuntimeStatsService, RuntimeStatsServiceId } from "./service/index.ts";

export { RuntimeStatsServiceId } from "./service/index.ts";

export type { RuntimeStatsSnapshot, RuntimeSummary } from "./service/index.ts";

export const runtimeExtension: Extension = {
	id: "runtime",
	apiVersion: 1,

	services: [{ id: RuntimeStatsServiceId, create: (container) => new RuntimeStatsService(container.get(SessionServiceId)) }],
};
