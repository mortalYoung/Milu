import type { FrontEndService } from "@milu/window/api";
import { IConnection, ISelectionService } from "@milu/window/api";

import { TrajectoryService, ITrajectoryService } from "../service/index.ts";

export default { id: ITrajectoryService, create: (container) => new TrajectoryService(container.get(IConnection), container.get(ISelectionService)) } satisfies FrontEndService;
