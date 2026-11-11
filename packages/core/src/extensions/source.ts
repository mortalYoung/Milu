import type { ExtensionWidget } from "@milu/extension-types";

import { EXTENSION_API_VERSION, type ManifestService } from "./manifest.ts";
import type { Extension } from "./types.ts";
import type { WindowDeclaration } from "./windows.ts";

export interface LocatedExtension {
	readonly ref: string;
	readonly root?: string;
	readonly entry?: string;
	readonly services?: readonly ManifestService[];
	readonly module: Promise<unknown>;
}

export interface ServiceDeclaration extends ManifestService {
	readonly extension: string;
}

export interface HostedExtension {
	readonly id: string;
	readonly entry: string;
}

export interface WidgetRef extends ExtensionWidget {
	readonly extension: string;
	readonly root?: string;
}

export interface WindowRef extends WindowDeclaration {
	readonly extension: string;
	readonly root?: string;
}

export interface ExtensionSource {
	readonly id: string;
	readonly fatal: boolean;
	find(): Promise<readonly LocatedExtension[]>;
}

export interface ExtensionFailure {
	readonly ref: string;
	readonly error: string;
}

export interface DiscoveredExtensions {
	readonly extensions: readonly Extension[];
	readonly widgets: readonly WidgetRef[];
	readonly windows: readonly WindowRef[];
	readonly roots: Readonly<Record<string, string>>;
	readonly hosted: readonly HostedExtension[];
	readonly services: readonly ServiceDeclaration[];
	readonly failures: readonly ExtensionFailure[];
}

export async function discoverExtensions(sources: readonly ExtensionSource[]): Promise<DiscoveredExtensions> {
	const extensions: Extension[] = [];
	const widgets: WidgetRef[] = [];
	const windows: WindowRef[] = [];
	const roots: Record<string, string> = {};
	const hosted: HostedExtension[] = [];
	const services: ServiceDeclaration[] = [];
	const failures: ExtensionFailure[] = [];
	const claimed = new Map<string, string>();

	for (const source of sources) {
		let located: readonly LocatedExtension[];
		try {
			located = await source.find();
		} catch (error) {
			const message = reason(error);
			if (source.fatal) throw new Error(`extension source ${source.id} failed to list: ${message}`);
			failures.push({ ref: source.id, error: message });
			continue;
		}

		for (const item of located) {
			const ref = `${source.id}:${item.ref}`;
			try {
				const extension = readExtension(await item.module, ref);
				const owner = claimed.get(extension.id);
				if (owner) throw new Error(`extension "${extension.id}" is declared by both ${owner} and ${ref}`);
				claimed.set(extension.id, ref);
				extensions.push(extension);
				if (item.root !== undefined) roots[extension.id] = item.root;
				for (const widget of extension.widgets ?? []) widgets.push({ ...widget, extension: extension.id, ...(item.root === undefined ? {} : { root: item.root }) });
				for (const window of extension.windows ?? []) windows.push({ ...window, extension: extension.id, ...(item.root === undefined ? {} : { root: item.root }) });
				if (item.entry !== undefined) hosted.push({ id: extension.id, entry: item.entry });
				for (const service of item.services ?? []) services.push({ extension: extension.id, ...service });
			} catch (error) {
				const message = reason(error);
				if (source.fatal) throw new Error(`extension ${ref} failed to load: ${message}`);
				failures.push({ ref, error: message });
			}
		}
	}

	return { extensions, widgets, windows, roots, hosted, services, failures };
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readExtension(namespace: unknown, ref: string): Extension {
	const exported = typeof namespace === "object" && namespace !== null ? (namespace as { default?: unknown }).default : undefined;
	if (typeof exported !== "object" || exported === null) throw new Error(`${ref} has no default extension export`);
	const { id, apiVersion } = exported as { id?: unknown; apiVersion?: unknown };
	if (typeof id !== "string" || id === "") throw new Error(`${ref} exports an extension without an id`);
	if (apiVersion !== undefined && apiVersion !== EXTENSION_API_VERSION) {
		throw new Error(`${ref} targets extension API ${String(apiVersion)}, this Milu speaks ${EXTENSION_API_VERSION}`);
	}
	return exported as Extension;
}
