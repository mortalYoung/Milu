import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createServiceId, type Service } from "@milu/di";

import type { ConfigService } from "./config.ts";

export interface ModelRef {
	provider: string;
	modelId?: string;
}

const FALLBACK_PROVIDER = "deepseek";
const DEFAULT_MODELS: Record<string, string> = { deepseek: "deepseek-v4-flash" };

export class ModelsService implements Service {
	private readonly _models: MutableModels;

	readonly stream: StreamFn;

	constructor(private readonly _configService: ConfigService) {
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

export const ModelsServiceId = createServiceId<ModelsService>("ModelsService");
