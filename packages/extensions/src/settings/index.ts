import type { CustomModel, CustomProvider, Extension, ExtensionContext, Settings } from "@milu/core";
import { expandHome, IExtensionService } from "@milu/core";
import type { AuthEventText, AuthLoginState, AuthPromptText } from "@milu/protocol";

import { IMcpService } from "../mcp/index.ts";
import type { McpOptions } from "../mcp/types.ts";
import { resolveExemptRoot } from "../permission/roots.ts";
import { resolveSandboxEnv } from "../permission/sandbox-env.ts";
import { canSignIn, createLogin } from "./login.ts";

export type { CustomModel, CustomProvider, Settings };
export type { AuthEventText, AuthLoginState, AuthPromptText };

export interface AddableProvider {
	readonly id: string;
	readonly name?: string;
	readonly baseUrl?: string;
	readonly modelCount: number;
	readonly signIn?: { readonly label: string; readonly subscription: boolean };
}

export interface ModelRow {
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly input?: readonly string[];
	readonly cost?: { readonly input: number; readonly output: number };
	readonly custom: boolean;
}

export interface ProviderRow {
	readonly id: string;
	readonly name?: string;
	readonly baseUrl?: string;
	readonly custom: boolean;
	readonly auth: "api_key" | "oauth" | "unset";
	readonly signIn?: { readonly label: string; readonly subscription: boolean };
	readonly models: readonly ModelRow[];
}

export interface SettingsSnapshot {
	readonly values: Settings;
	readonly defaults: Readonly<Record<string, unknown>>;
	readonly extensions: readonly string[];
	readonly mcp: McpOptions;
	readonly providers: readonly ProviderRow[];
	readonly addable: readonly AddableProvider[];
	readonly modelOptions: readonly ModelOptionGroup[];
	readonly effective: { readonly provider: string; readonly modelId: string; readonly name: string } | null;
}

export interface ModelOptionGroup {
	readonly provider: string;
	readonly models: readonly { readonly id: string; readonly name: string }[];
}

export interface SettingsPatch {
	readonly patch?: Partial<Settings>;
	readonly credentials?: Readonly<Record<string, string | null>>;
}

function displayName(context: ExtensionContext, id: string): { name?: string } {
	const name = context.models.name(id);
	return name === undefined || name === id ? {} : { name };
}

function providerRows(context: ExtensionContext): { providers: ProviderRow[]; addable: AddableProvider[] } {
	const values = context.settings.get();
	const custom = values.customProviders ?? [];
	const added = values.providers ?? [];
	const ids = [...added];
	for (const def of custom) if (!ids.includes(def.id)) ids.push(def.id);
	const providers = ids.map((id) => {
		const baseUrl = context.models.baseUrl(id);
		const def = custom.find((entry) => entry.id === id);
		const credential = context.config.credential(id);
		const oauth = context.models.authMethods(id).oauth;
		const declared = new Set((def?.models ?? []).map((model) => model.id));
		const models = context.models.available(id).map((model) => ({
			id: model.id,
			...(model.name === model.id ? {} : { name: model.name }),
			...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
			...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
			input: model.input,
			cost: { input: model.cost.input, output: model.cost.output },
			custom: declared.has(model.id),
		}));
		return {
			id,
			...displayName(context, id),
			...(baseUrl === undefined ? {} : { baseUrl }),
			custom: def !== undefined,
			auth: credential === undefined ? ("unset" as const) : credential.type,
			...(oauth === undefined || !canSignIn(id) ? {} : { signIn: { label: oauth.name, subscription: oauth.subscription } }),
			models,
		};
	});
	const addable = [...context.models.known(), ...custom.map((def) => def.id)]
		.filter((id) => !ids.includes(id) && context.models.available(id).length > 0)
		.map((id) => {
			const baseUrl = context.models.baseUrl(id);
			const oauth = context.models.authMethods(id).oauth;
			return {
				id,
				...displayName(context, id),
				...(baseUrl === undefined ? {} : { baseUrl }),
				modelCount: context.models.available(id).length,
				...(oauth === undefined || !canSignIn(id) ? {} : { signIn: { label: oauth.name, subscription: oauth.subscription } }),
			};
		});
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

function runnable(context: ExtensionContext): { provider: string; modelId: string; name: string } | null {
	try {
		const model = context.models.resolve();
		return { provider: model.provider, modelId: model.id, name: model.name };
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
		extensions: context.get(IExtensionService).loaded(),
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
		const login = createLogin(context.models);

		context.actions.register({
			id: "settings.open",
			scope: "app",
			hotkey: "Mod+,",
			run: async ({ dialog }) => {
				await dialog?.({ kind: "custom", id: "settings", title: "Settings", dismissOnOutsideClick: false });
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
				if (patch && ("sandboxExemptRoot" in patch || "sandboxEnv" in patch)) {
					const merged = { ...(context.settings.get() as unknown as Record<string, unknown>), ...(patch as Record<string, unknown>) };
					const configured = merged["sandboxExemptRoot"] ?? "~/Milu/Permissions";
					if (typeof configured !== "string" || configured.trim() === "") throw new Error('settings "sandboxExemptRoot" must be a non-empty string');
					resolveSandboxEnv(merged["sandboxEnv"] ?? {}, resolveExemptRoot(expandHome(configured.trim())));
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

		context.actions.register({
			id: "settings.loginStart",
			run: async ({ args }) => ({ data: await login.start((args as { provider: string }).provider) }),
		});

		context.actions.register({
			id: "settings.loginPoll",
			run: async () => ({ data: login.state() }),
		});

		context.actions.register({
			id: "settings.loginAnswer",
			run: async ({ args }) => {
				login.answer((args as { value?: string | null }).value ?? null);
			},
		});

		context.actions.register({
			id: "settings.logout",
			run: async ({ args }) => {
				await context.models.logout((args as { provider: string }).provider);
			},
		});
	},
};

export default settingsExtension;
