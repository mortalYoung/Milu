import type { FrontEndService } from "@milu/window/api";
import { ISelectionService } from "@milu/window/api";

import { RepliesService, IRepliesService } from "../service/index.ts";

export default { id: IRepliesService, create: (container) => new RepliesService(container.get(ISelectionService)) } satisfies FrontEndService;
