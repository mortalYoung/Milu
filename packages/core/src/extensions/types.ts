import type { Container, DisposableStore, ServiceId, Service } from "@milu/di";
import { SLOT_POINTS, type SlotItem, type WelcomeItem } from "@milu/protocol";

import type { ActionService } from "../services/actions.ts";
import type { ConfigService } from "../services/config.ts";
import type { ModelsService } from "../services/models.ts";
import type { SettingsService } from "../services/settings.ts";
import type { Session } from "../session/session.ts";

export const SESSION_MENU_POINT = "session.menu";
export const SESSION_HEADER_POINT = "session.header";
export const COMPOSER_LEFT_POINT = "composer.left";
export const COMPOSER_RIGHT_POINT = "composer.right";
export const COMPOSER_TIPS_POINT = "composer.tips";
export const SYSTEM_PROMPT_POINT = "system.prompt";
export const WELCOME_ITEMS_POINT = "welcome.items";
export const CHAT_BAR_POINT = SLOT_POINTS.chatBar;
export const CHAT_PANES_POINT = SLOT_POINTS.chatPanes;

export type { SlotItem, WelcomeItem };

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

export interface ComposerWidgetItem {
	readonly id: string;
	readonly order?: number;
	readonly widget: string;
	readonly data?: SessionValue<unknown>;
}

export interface PromptSection {
	readonly id: string;
	readonly order: number;
	readonly text: SessionValue<string>;
}

export interface ComposerTipItem {
	readonly id: string;
	readonly order?: number;
	readonly keys?: readonly string[];
	readonly label: string;
	readonly when?: "chat" | "shell";
}

export interface ExtensionContributions {
	readonly "session.menu"?: readonly SessionMenuItem[];
	readonly "session.header"?: readonly SessionHeaderItem[];
	readonly "composer.left"?: readonly ComposerWidgetItem[];
	readonly "composer.right"?: readonly ComposerWidgetItem[];
	readonly "composer.tips"?: readonly ComposerTipItem[];
	readonly "system.prompt"?: readonly PromptSection[];
	readonly "welcome.items"?: readonly WelcomeItem[];
	readonly "chat.bar"?: readonly SlotItem[];
	readonly "chat.panes"?: readonly SlotItem[];
}

export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly get: <T extends Service>(id: ServiceId<T>) => T;
	readonly config: ConfigService;
	readonly actions: ActionService;
	readonly models: ModelsService;
	readonly settings: SettingsService;
}

export const EXTENSION_API_VERSION = 1;

export interface ExtensionServiceDeclaration<T extends Service = Service> {
	readonly id: ServiceId<T>;
	readonly create: (container: Container) => T;
}

export interface Extension {
	readonly id: string;
	readonly apiVersion?: number;
	readonly services?: readonly ExtensionServiceDeclaration[];
	readonly contributions?: ExtensionContributions;
	activate?(context: ExtensionContext): void | Promise<void>;
}
