import type { FrontEndService } from "@milu/window/api";
import { IConnection, ISelectionService } from "@milu/window/api";

import { ExplorerTreeService, IExplorerTreeService } from "../service/tree.ts";

export default {
	id: IExplorerTreeService,
	create: (container) => new ExplorerTreeService(container.get(IConnection), container.get(ISelectionService)),
} satisfies FrontEndService;
