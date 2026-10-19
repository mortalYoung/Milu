import type { DialogComponent } from "@milu/client";

import { CreateSessionDialog } from "./create.tsx";
import { SessionDetailsDialog } from "./details.tsx";

export const dialogs: readonly DialogComponent[] = [
	{ id: "create-session", component: CreateSessionDialog },
	{ id: "session-details", component: SessionDetailsDialog },
];
