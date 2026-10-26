import { createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { ComposerMode } from "@milu/protocol";

import type { Session } from "../session/session.ts";

export interface ComposerModeChange {
	readonly session: string;
	readonly mode: ComposerMode;
}

export class ComposerService implements Service {
	readonly onModeChange: Event<ComposerModeChange>;

	private readonly _modes = new Map<string, ComposerMode>();
	private readonly _changed = new Emitter<ComposerModeChange>();

	constructor() {
		this.onModeChange = this._changed.event;
	}

	mode(session: Session | string | null | undefined): ComposerMode {
		const name = typeof session === "string" ? session : session?.name;
		return name ? (this._modes.get(name) ?? "chat") : "chat";
	}

	setMode(session: Session | string | null | undefined, mode: ComposerMode): void {
		const name = typeof session === "string" ? session : session?.name;
		if (!name || this.mode(name) === mode) return;
		this._modes.set(name, mode);
		this._changed.fire({ session: name, mode });
	}

	toggle(session: Session | string | null | undefined): void {
		this.setMode(session, this.mode(session) === "shell" ? "chat" : "shell");
	}

	dispose(): void {
		this._modes.clear();
		this._changed.dispose();
	}
}

export const IComposerService = createServiceId<ComposerService>("ComposerService");
