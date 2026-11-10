import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AuthEvent, AuthInteraction, AuthPrompt, Credential, CredentialStore, LoginOptions, Model, ModelThinkingLevel, MutableModels } from "@earendil-works/pi-ai";
import { createProvider, envApiKeyAuth, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { createServiceId, DisposableStore, type Service } from "@milu/di";
import type { AuthEventText, AuthLoginHandlers, AuthPromptText } from "@milu/protocol";

import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";
import { ISettingsService } from "./settings.ts";
import type { CustomProvider, SettingsService } from "./settings.ts";

export interface ModelRef {
	provider: string;
	modelId?: string;
}

export interface ProviderAuthMethods {
	readonly apiKey: boolean;
	readonly oauth?: { readonly name: string; readonly label?: string; readonly subscription: boolean };
}

function promptText(prompt: AuthPrompt): AuthPromptText {
	if (prompt.type === "select") {
		return {
			kind: "select",
			message: prompt.message,
			options: prompt.options.map((option) => ({ id: option.id, label: option.label, ...(option.description === undefined ? {} : { description: option.description }) })),
		};
	}
	return { kind: prompt.type, message: prompt.message, ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }) };
}

function eventText(event: AuthEvent): AuthEventText {
	if (event.type === "auth_url") return { kind: "auth_url", url: event.url, ...(event.instructions === undefined ? {} : { instructions: event.instructions }) };
	if (event.type === "device_code") return { kind: "device_code", userCode: event.userCode, verificationUri: event.verificationUri };
	if (event.type === "progress") return { kind: "progress", message: event.message };
	return { kind: "info", message: event.message, ...(event.links === undefined ? {} : { links: event.links }) };
}

const DEFAULT_MODELS: Record<string, string> = { deepseek: "deepseek-v4-flash" };
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

function customModel(def: CustomProvider, model: CustomProvider["models"][number]): Model<"openai-completions"> {
	return {
		id: model.id,
		name: model.id,
		api: "openai-completions",
		provider: def.id,
		baseUrl: def.baseUrl,
		reasoning: true,
		thinkingLevelMap: { off: null },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.contextWindow ?? def.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: model.maxTokens ?? def.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
	};
}

export function credentialStore(config: ConfigService): CredentialStore {
	return {
		read: async (providerId) => config.credential(providerId),
		list: async () => config.providers().map((providerId) => ({ providerId, type: (config.credential(providerId)?.type ?? "api_key") as Credential["type"] })),
		modify: async (providerId, change) => {
			const current = config.credential(providerId);
			const next = await change(current);
			if (next === undefined) return current;
			await config.setCredential(providerId, next);
			return next;
		},
		delete: async (providerId) => {
			await config.deleteCredential(providerId);
		},
	};
}

export class ModelsService implements Service {
	private readonly _models: MutableModels;
	private readonly _custom = new Set<string>();
	private readonly _disposables = new DisposableStore();
	private _signature = "";

	readonly stream: StreamFn;

	constructor(
		@IConfigService private readonly _configService: ConfigService,
		@ISettingsService private readonly _settingsService: SettingsService,
	) {
		this._models = builtinModels({ credentials: credentialStore(this._configService) });
		this.stream = (model, context, options) => this._models.streamSimple(model, context, options);
	}

	initialize(): void {
		registerBunOAuthFlows();
		this._sync();
		this._disposables.add(this._settingsService.onChange(() => this._sync()));
	}

	known(): readonly string[] {
		return getBuiltinProviders();
	}

	baseUrl(provider: string): string | undefined {
		return this._models.getProvider(provider)?.baseUrl;
	}

	name(provider: string): string | undefined {
		return this._models.getProvider(provider)?.name;
	}

	supportedThinkingLevels(model: Model<Api>): readonly ModelThinkingLevel[] {
		return getSupportedThinkingLevels(model);
	}

	credential(provider: string): Credential | undefined {
		return this._configService.credential(provider);
	}

	authMethods(provider: string): ProviderAuthMethods {
		const auth = this._models.getProvider(provider)?.auth;
		const oauth = auth?.oauth;
		return {
			apiKey: auth?.apiKey !== undefined,
			...(oauth === undefined
				? {}
				: { oauth: { name: oauth.name, ...(oauth.loginLabel === undefined ? {} : { label: oauth.loginLabel }), subscription: oauth.isSubscription === true } }),
		};
	}

	async login(provider: string, handlers: AuthLoginHandlers, options?: LoginOptions, signal?: AbortSignal): Promise<void> {
		const interaction: AuthInteraction = {
			signal: signal ?? new AbortController().signal,
			prompt: (prompt) => handlers.prompt(promptText(prompt)),
			notify: (event) => handlers.notify(eventText(event)),
		};
		await this._models.login(provider, "oauth", interaction, options);
	}

	async logout(provider: string): Promise<void> {
		await this._models.logout(provider);
	}

	defaultRef(): ModelRef | null {
		const value = this._settingsService.get().defaultModel;
		return value !== undefined && value.provider !== "" ? value : null;
	}

	resolve(ref?: ModelRef): Model<Api> {
		const chosen = ref ?? this.defaultRef() ?? undefined;
		if (chosen === undefined) {
			throw new Error("No model — pick one for this session, or set a default in Settings → Providers");
		}
		const provider = chosen.provider;
		if (this._configService.credential(provider) === undefined) {
			throw new Error(`No credentials for provider "${provider}"`);
		}
		const modelId = chosen.modelId ?? DEFAULT_MODELS[provider] ?? this._models.getModels(provider)[0]?.id;
		const model = modelId ? this._models.getModel(provider, modelId) : undefined;
		if (!model) {
			throw new Error(`Model "${modelId ?? "?"}" not found for provider "${provider}"`);
		}
		return model;
	}

	available(provider?: string): readonly Model<Api>[] {
		return this._models.getModels(provider);
	}

	private _sync(): void {
		const defs = this._settingsService.get().customProviders ?? [];
		const signature = JSON.stringify(defs);
		if (signature === this._signature) return;
		this._signature = signature;
		for (const id of this._custom) this._models.deleteProvider(id);
		this._custom.clear();
		for (const def of defs) {
			this._models.setProvider(
				createProvider({
					id: def.id,
					name: def.name ?? def.id,
					baseUrl: def.baseUrl,
					auth: { apiKey: envApiKeyAuth("API key", []) },
					models: def.models.map((model) => customModel(def, model)),
					api: openAICompletionsApi(),
				}),
			);
			this._custom.add(def.id);
		}
	}

	dispose(): void {
		this._disposables.dispose();
	}
}

export const IModelsService = createServiceId<ModelsService>("ModelsService");
