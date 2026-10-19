import type { DisposableStore } from "@milu/di";
import type { ConfirmCopy } from "@milu/protocol";

import type { ActionRegistry } from "../services/actions.ts";
import type { ConfigService } from "../services/config.ts";
import type { Session } from "../session/session.ts";

export const SESSION_MENU_POINT = "session.menu";

export type SessionValue<T> = T | ((session: Session) => T | null | Promise<T | null>);

export interface SessionMenuItemBase {
	readonly id: string;
	readonly order?: number;
	readonly group?: string;
	readonly danger?: boolean;
	readonly confirm?: SessionValue<ConfirmCopy>;
	readonly title: SessionValue<string>;
	readonly icon?: SessionValue<string>;
}

export type SessionMenuItem = SessionMenuItemBase & ({ readonly action: string; readonly args?: unknown } | { readonly items: SessionValue<readonly SessionMenuItem[]> });

export interface ExtensionContributions {
	readonly "session.menu"?: readonly SessionMenuItem[];
}

export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly config: ConfigService;
	readonly actions: ActionRegistry;
}

export const EXTENSION_API_VERSION = 1;

export interface Extension {
	readonly id: string;
	readonly apiVersion?: number;
	readonly contributions?: ExtensionContributions;
	activate?(context: ExtensionContext): void | Promise<void>;
}
