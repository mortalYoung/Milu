import type { DialogComponent } from "@milu/client";

import { CreateSessionDialog } from "./create.tsx";

export const dialogs: readonly DialogComponent[] = [{ id: "create-session", component: CreateSessionDialog }];
