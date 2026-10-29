import type { WidgetEntry } from "@milu/protocol";
import { type ComponentType, createElement } from "react";

import type { ExtensionWidgetProps } from "./api/widget.ts";
import type { ComposerTriggerComponent } from "./composer-triggers.ts";
import type { WidgetComponent, WidgetProps } from "./composer.ts";
import type { DialogComponent, DialogProps } from "./dialogs.ts";
import { ExtensionWidget, WidgetBoundary } from "./extension-widget.tsx";
import type { FrontEndService } from "./extensions.ts";
import type { MarkdownPlugin } from "./markdown/types.ts";
import type { RowComponent } from "./rows.ts";
import type { SlotComponent, SlotProps } from "./slots.ts";

export interface WidgetFailure {
	readonly ref: string;
	readonly error: string;
}

export interface WidgetSet {
	readonly slots: readonly SlotComponent[];
	readonly rows: readonly RowComponent[];
	readonly widgets: readonly WidgetComponent[];
	readonly dialogs: readonly DialogComponent[];
	readonly triggers: readonly ComposerTriggerComponent[];
	readonly services: readonly FrontEndService[];
	readonly markdown: readonly MarkdownPlugin[];
	readonly failures: readonly WidgetFailure[];
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asComponent<T>(value: unknown, entry: WidgetEntry): ComponentType<T> {
	if (typeof value !== "function") throw new Error(`"${entry.export ?? "default"}" is not a component`);
	return value as ComponentType<T>;
}

function asTrigger(value: unknown, entry: WidgetEntry): ComposerTriggerComponent {
	if (typeof value !== "object" || value === null || (value as { id?: unknown }).id !== entry.id)
		throw new Error(`"${entry.export ?? "default"}" is not the "${entry.id}" trigger`);
	return value as ComposerTriggerComponent;
}

function asService(value: unknown, entry: WidgetEntry): FrontEndService {
	const service = value as { id?: { name?: unknown }; create?: unknown };
	if (typeof service !== "object" || service === null || service.id?.name !== entry.id || typeof service.create !== "function") {
		throw new Error(`"${entry.export ?? "default"}" is not the "${entry.id}" service`);
	}
	return value as FrontEndService;
}

function asMarkdownPlugin(value: unknown, entry: WidgetEntry): MarkdownPlugin {
	const plugin = value as { id?: unknown; order?: unknown; tier?: unknown; setup?: unknown; html?: unknown; source?: unknown };
	if (typeof plugin !== "object" || plugin === null || plugin.id !== entry.id || typeof plugin.order !== "number") {
		throw new Error(`"${entry.export ?? "default"}" is not the "${entry.id}" markdown plugin`);
	}
	return plugin as MarkdownPlugin;
}

function wrap<P extends object>(entry: WidgetEntry, component: ComponentType<P>, narrowed: boolean): ComponentType<P> {
	if (entry.source === "builtin") return component;
	if (narrowed) {
		const surface = component as unknown as ComponentType<ExtensionWidgetProps>;
		return ((props: P) => <ExtensionWidget {...(props as SlotProps)} extension={entry.extension} widget={entry.id} component={surface} />) as ComponentType<P>;
	}
	return ((props: P) => <WidgetBoundary id={entry.extension}>{createElement(component, props)}</WidgetBoundary>) as ComponentType<P>;
}

export async function loadWidgets(entries: readonly WidgetEntry[]): Promise<WidgetSet> {
	const slots: SlotComponent[] = [];
	const rows: RowComponent[] = [];
	const widgets: WidgetComponent[] = [];
	const dialogs: DialogComponent[] = [];
	const triggers: ComposerTriggerComponent[] = [];
	const services: FrontEndService[] = [];
	const markdown: MarkdownPlugin[] = [];
	const failures: WidgetFailure[] = [];

	for (const entry of entries) {
		try {
			const url = entry.url;
			if (url === undefined) throw new Error("the host did not provide a module url");
			const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
			const value = module[entry.export ?? "default"];
			if (value === undefined) throw new Error(`module has no "${entry.export ?? "default"}" export`);
			if (entry.type === "slot")
				slots.push({ id: entry.id, component: wrap<SlotProps>(entry, asComponent<ExtensionWidgetProps>(value, entry) as unknown as ComponentType<SlotProps>, true) });
			else if (entry.type === "widget") widgets.push({ id: entry.id, component: wrap<WidgetProps>(entry, asComponent<WidgetProps>(value, entry), true) });
			else if (entry.type === "row") rows.push({ id: entry.id, component: wrap<SlotProps>(entry, asComponent<SlotProps>(value, entry), true) });
			else if (entry.type === "dialog") dialogs.push({ id: entry.id, component: wrap<DialogProps>(entry, asComponent<DialogProps>(value, entry), false) });
			else if (entry.type === "trigger") triggers.push(asTrigger(value, entry));
			else if (entry.type === "markdown") markdown.push(asMarkdownPlugin(value, entry));
			else services.push(asService(value, entry));
		} catch (error) {
			const message = reason(error);
			if (entry.source === "builtin") throw new Error(`extension "${entry.extension}" cannot load widget "${entry.id}": ${message}`);
			failures.push({ ref: `widget:${entry.extension}/${entry.id}`, error: message });
		}
	}

	return { slots, rows, widgets, dialogs, triggers, services, markdown, failures };
}
