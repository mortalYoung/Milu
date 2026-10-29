import type { CustomModel, CustomProvider, Extension, ExtensionContext, Settings } from "@milu/core";

import { IMcpService } from "../mcp/index.ts";
import type { McpOptions } from "../mcp/types.ts";

export type { CustomModel, CustomProvider, Settings };

export interface ProviderRow {
	readonly id: string;
	readonly configured: boolean;
	readonly baseUrl?: string;
	readonly modelCount: number;
	readonly custom: boolean;
}

export interface SettingsSnapshot {
	readonly values: Settings;
	readonly defaults: Readonly<Record<string, unknown>>;
	readonly mcp: McpOptions;
	readonly providers: readonly ProviderRow[];
	readonly addable: readonly string[];
	readonly modelOptions: readonly ModelOptionGroup[];
	readonly effective: { readonly provider: string; readonly modelId: string } | null;
}

export interface ModelOptionGroup {
	readonly provider: string;
	readonly models: readonly { readonly id: string; readonly name: string }[];
}

export interface SettingsPatch {
	readonly patch?: Partial<Settings>;
	readonly credentials?: Readonly<Record<string, string | null>>;
}

function providerRows(context: ExtensionContext): { providers: ProviderRow[]; addable: string[] } {
	const values = context.settings.get();
	const custom = values.customProviders ?? [];
	const added = values.providers ?? [];
	const ids = [...added];
	for (const def of custom) if (!ids.includes(def.id)) ids.push(def.id);
	const providers = ids.map((id) => {
		const baseUrl = context.models.baseUrl(id);
		return {
			id,
			configured: context.config.apiKey(id) !== undefined,
			...(baseUrl === undefined ? {} : { baseUrl }),
			modelCount: context.models.available(id).length,
			custom: custom.some((def) => def.id === id),
		};
	});
	const addable = [...context.models.known(), ...custom.map((def) => def.id)].filter((id) => !ids.includes(id) && context.models.available(id).length > 0);
	return { providers, addable };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function effective(values: Settings, defaults: Readonly<Record<string, unknown>>): Settings {
	const merged: Record<string, unknown> = { ...defaults };
	for (const [key, value] of Object.entries(values)) {
		const base = merged[key];
		merged[key] = isObject(base) && isObject(value) ? { ...base, ...value } : value;
	}
	return merged as unknown as Settings;
}

function modelOptions(context: ExtensionContext, providers: readonly ProviderRow[]): ModelOptionGroup[] {
	return providers
		.map((row) => ({ provider: row.id, models: context.models.available(row.id).map((model) => ({ id: model.id, name: model.name })) }))
		.filter((group) => group.models.length > 0);
}

function runnable(context: ExtensionContext): { provider: string; modelId: string } | null {
	try {
		const model = context.models.resolve();
		return { provider: model.provider, modelId: model.id };
	} catch {
		return null;
	}
}

async function collect(context: ExtensionContext): Promise<SettingsSnapshot> {
	const { providers, addable } = providerRows(context);
	const defaults = context.settings.defaults();
	return {
		values: effective(context.settings.get(), defaults),
		defaults,
		mcp: await context.get(IMcpService).options(),
		providers,
		addable,
		modelOptions: modelOptions(context, providers),
		effective: runnable(context),
	};
}

const settingsExtension: Extension = {
	id: "settings",
	apiVersion: 1,
	widgets: [{ id: "settings", type: "dialog", entry: "./widget/settings.tsx" }],

	contributions: {
		"session.footer": [{ id: "settings", title: "Settings", icon: "settings", action: "settings.open" }],
		"welcome.items": [{ id: "settings-key", variant: "key", order: 10, title: "Settings", keys: ["⌘", ","], action: "settings.open" }],
	},

	activate(context) {
		context.actions.register({
			id: "settings.open",
			scope: "app",
			hotkey: "Mod+,",
			run: async ({ dialog }) => {
				await dialog?.({ kind: "custom", id: "settings", title: "Settings" });
			},
		});

		context.actions.register({
			id: "settings.collect",
			run: async () => ({ data: await collect(context) }),
		});

		context.actions.register({
			id: "settings.update",
			run: async ({ args }) => {
				const { patch, credentials } = (args ?? {}) as SettingsPatch;
				for (const [provider, key] of Object.entries(credentials ?? {})) {
					if (key === null) await context.config.deleteApiKey(provider);
					else await context.config.setApiKey(provider, key);
				}
				if (patch) await context.settings.update(patch);
			},
		});

		context.actions.register({
			id: "settings.mcp",
			run: async ({ args }) => {
				await context.get(IMcpService).saveOptions(args as McpOptions);
			},
		});
	},
};

export default settingsExtension;
