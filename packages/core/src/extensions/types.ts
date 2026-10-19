import type { DisposableStore } from "@milu/di";

import type { ActionRegistry } from "../services/actions.ts";
import type { ConfigService } from "../services/config.ts";
import type { Session } from "../session/session.ts";

/** The row menu of a session. The host declares it; extensions list their entries in it. */
export const SESSION_MENU_POINT = "session.menu";

export interface SessionMenuItem {
	readonly id: string;
	/** A string, or a function the core resolves for the session that row is about. */
	readonly title: string | ((session: Session) => string | Promise<string>);
	/** The action this entry fires. Registered by the extension's own `activate`. */
	readonly action: string;
	readonly order?: number;
}

/** Every point an extension may contribute to, by name. Declared data, read once at startup. */
export interface ExtensionContributions {
	readonly "session.menu"?: readonly SessionMenuItem[];
}

/**
 * What an extension is given at activation. Contributions are not here: they are declared on the
 * extension itself and installed before `activate` runs, so a reader never waits for anyone.
 */
export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly config: ConfigService;
	readonly actions: ActionRegistry;
}

/** Version of the context above. A runtime-loaded extension is checked against it, not typed by it. */
export const EXTENSION_API_VERSION = 1;

export interface Extension {
	readonly id: string;
	readonly apiVersion?: number;
	/** Installed into the named points at startup — no call, no ordering, no request later. */
	readonly contributions?: ExtensionContributions;
	activate?(context: ExtensionContext): void | Promise<void>;
}
