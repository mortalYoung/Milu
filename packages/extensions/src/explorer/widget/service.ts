import type { FrontEndService } from "@milu/window/api";
import { IConnection, ISelectionService, ISessionListService } from "@milu/window/api";

import { ExplorerTreeService, IExplorerTreeService } from "../service/tree.ts";

export default {
	id: IExplorerTreeService,
	create: (container) => new ExplorerTreeService(container.get(IConnection), container.get(ISelectionService), container.get(ISessionListService)),
} satisfies FrontEndService;
