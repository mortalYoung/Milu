import { createServiceId, type Service, type ServiceId } from "@milu/di";
import type { ComponentType } from "react";

import type { ActionsService } from "./actions.ts";
import type { ColumnsService } from "./columns.ts";
import type { CommandRegistry } from "./commands.ts";
import type { ComposerDataService } from "./composer-data.ts";
import type { ComposerTriggerRegistry } from "./composer-triggers.ts";
import type { ComposerService, WidgetRegistry } from "./composer.ts";
import type { Connection } from "./connection.ts";
import type { DialogService } from "./dialogs.ts";
import type { DockService } from "./dock.ts";
import type { FileEventsService } from "./files.ts";
import type { FooterService } from "./footer.ts";
import type { HeaderService } from "./header.ts";
import type { HotkeysService } from "./hotkeys.ts";
import type { LayoutService } from "./layout.ts";
import type { MarkdownPort } from "./markdown/types.ts";
import type { NotificationService } from "./notifications.ts";
import type { PickerService } from "./picker.ts";
import type { RowRegistry } from "./rows.ts";
import type { SelectionService } from "./selection.ts";
import type { SessionListService } from "./sessions.ts";
import type { SlotsService } from "./slots.ts";
import type { TranscriptService } from "./transcripts.ts";
import type { WelcomeService } from "./welcome.ts";
import type { WorkbenchService } from "./workbench.ts";

export interface SurfaceProps {
	readonly host: Host;
}

export interface SurfaceComponent {
	readonly id: string;
	readonly component: ComponentType<SurfaceProps>;
}

export interface Host {
	readonly connection: Connection;
	readonly sessions: SessionListService;
	readonly selection: SelectionService;
	readonly transcript: TranscriptService;
	readonly welcome: WelcomeService;
	readonly workbench: WorkbenchService;
	readonly actions: ActionsService;
	readonly dialogs: DialogService;
	readonly columns: ColumnsService;
	readonly dock: DockService;
	readonly header: HeaderService;
	readonly footer: FooterService;
	readonly composer: ComposerService;
	readonly composerData: ComposerDataService;
	readonly commands: CommandRegistry;
	readonly triggers: ComposerTriggerRegistry;
	readonly hotkeys: HotkeysService;
	readonly markdown: MarkdownPort;
	readonly widgets: WidgetRegistry;
	readonly picker: PickerService;
	readonly surfaces: SurfaceRegistry;
	readonly slots: SlotsService;
	readonly rows: RowRegistry;
	readonly notifications: NotificationService;
	readonly layout: LayoutService;
	readonly files: FileEventsService;
	readonly get: <T extends Service>(id: ServiceId<T>) => T;
}

export class SurfaceRegistry implements Service {
	private readonly _components = new Map<string, ComponentType<SurfaceProps>>();

	constructor(components: readonly SurfaceComponent[]) {
		for (const { id, component } of components) this.register(id, component);
	}

	register(id: string, component: ComponentType<SurfaceProps>): void {
		if (this._components.has(id)) throw new Error(`surface "${id}" is already registered`);
		this._components.set(id, component);
	}

	get(id: string): ComponentType<SurfaceProps> | undefined {
		return this._components.get(id);
	}

	dispose(): void {
		this._components.clear();
	}
}

export const SurfaceRegistryId = createServiceId<SurfaceRegistry>("SurfaceRegistry");
