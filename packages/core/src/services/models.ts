import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model, ModelThinkingLevel, MutableModels } from "@earendil-works/pi-ai";
import { createProvider, envApiKeyAuth, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createServiceId, type Service } from "@milu/di";

import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";
import { ISettingsService } from "./settings.ts";
import type { CustomProvider, SettingsService } from "./settings.ts";

export interface ModelRef {
	provider: string;
	modelId?: string;
}

const FALLBACK_PROVIDER = "deepseek";
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

export class ModelsService implements Service {
	private readonly _models: MutableModels;

	readonly stream: StreamFn;

	constructor(
		@IConfigService private readonly _configService: ConfigService,
		@ISettingsService private readonly _settingsService: SettingsService,
	) {
		this._models = builtinModels({
			credentials: {
				read: async (providerId) => {
					const key = this._configService.apiKey(providerId);
					return key ? { type: "api_key", key } : undefined;
				},
				list: async () => this._configService.providers().map((providerId) => ({ providerId, type: "api_key" as const })),
				modify: async (providerId, change) => {
					const current = this._configService.apiKey(providerId);
					const next = await change(current ? { type: "api_key", key: current } : undefined);
					if (!next) return undefined;
					if (next.type !== "api_key" || next.key === undefined) {
						throw new Error(`ConfigService stores api keys only — cannot persist a "${next.type}" credential for "${providerId}"`);
					}
					await this._configService.setApiKey(providerId, next.key);
					return next;
				},
				delete: async (providerId) => {
					await this._configService.deleteApiKey(providerId);
				},
			},
		});
		this.stream = (model, context, options) => this._models.streamSimple(model, context, options);
	}

	initialize(): void {
		for (const def of this._settingsService.get().customProviders ?? []) {
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
		}
	}

	supportedThinkingLevels(model: Model<Api>): readonly ModelThinkingLevel[] {
		return getSupportedThinkingLevels(model);
	}

	resolve(ref?: ModelRef): Model<Api> {
		const provider = ref?.provider ?? FALLBACK_PROVIDER;
		if (!this._configService.apiKey(provider)) {
			throw new Error(`No API key for provider "${provider}"`);
		}
		const modelId = ref?.modelId ?? DEFAULT_MODELS[provider] ?? this._models.getModels(provider)[0]?.id;
		const model = modelId ? this._models.getModel(provider, modelId) : undefined;
		if (!model) {
			throw new Error(`Model "${modelId ?? "?"}" not found for provider "${provider}"`);
		}
		return model;
	}

	available(provider?: string): readonly Model<Api>[] {
		return this._models.getModels(provider);
	}

	dispose(): void {}
}

export const IModelsService = createServiceId<ModelsService>("ModelsService");
