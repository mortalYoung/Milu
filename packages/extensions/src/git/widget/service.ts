import type { FrontEndService } from "@milu/window/api";
import { IConnection, ISelectionService } from "@milu/window/api";

import { GitChangesService, IGitChangesService } from "../service/changes.ts";

export default {
	id: IGitChangesService,
	create: (container) => new GitChangesService(container.get(IConnection), container.get(ISelectionService)),
} satisfies FrontEndService;
