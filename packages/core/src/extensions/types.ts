import type { DisposableStore } from "@milu/di";

import type { ActionService } from "../services/actions.ts";
import type { ConfigService } from "../services/config.ts";
import type { Session } from "../session/session.ts";

export const SESSION_MENU_POINT = "session.menu";
export const SESSION_HEADER_POINT = "session.header";

export type SessionValue<T> = T | ((session: Session) => T | null | Promise<T | null>);

export interface SessionHeaderItem {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly order?: number;
	readonly action: string;
}

export interface SessionMenuItemBase {
	readonly id: string;
	readonly order?: number;
	readonly group?: string;
	readonly danger?: boolean;
	readonly title: SessionValue<string>;
	readonly icon?: SessionValue<string>;
}

export type SessionMenuItem = SessionMenuItemBase & ({ readonly action: string; readonly args?: unknown } | { readonly items: SessionValue<readonly SessionMenuItem[]> });

export interface ExtensionContributions {
	readonly "session.menu"?: readonly SessionMenuItem[];
	readonly "session.header"?: readonly SessionHeaderItem[];
}

export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly config: ConfigService;
	readonly actions: ActionService;
}

export const EXTENSION_API_VERSION = 1;

export interface Extension {
	readonly id: string;
	readonly apiVersion?: number;
	readonly contributions?: ExtensionContributions;
	activate?(context: ExtensionContext): void | Promise<void>;
}
