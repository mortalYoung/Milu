import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CredentialStore, Message, Model } from "@earendil-works/pi-ai";
import { createProvider, envApiKeyAuth, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { CustomProvider, ThinkingLevel } from "../../shared/rpc";
import { getApiKey } from "../lib/credentials";

export interface PartnerModel {
	provider: string;
	modelId?: string;
}

const credentials: CredentialStore = {
	async read(providerId) {
		const key = getApiKey(providerId);
		return key ? { type: "api_key", key } : undefined;
	},
	async list() {
		return [];
	},
	async modify() {
		return undefined;
	},
	async delete() {},
};

export const MODELS = builtinModels({ credentials });

const DEFAULT_MODELS: Record<string, string> = { deepseek: "deepseek-v4-flash" };

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

function mkCustomModel(def: CustomProvider, m: CustomProvider["models"][number]): Model<"openai-completions"> {
	return {
		id: m.id,
		name: m.id,
		api: "openai-completions",
		provider: def.id,
		baseUrl: def.baseUrl,
		reasoning: true,
		thinkingLevelMap: { off: null },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: m.contextWindow ?? def.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: m.maxTokens ?? def.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
	};
}

export function registerCustomProvider(def: CustomProvider): void {
	MODELS.setProvider(
		createProvider({
			id: def.id,
			name: def.name ?? def.id,
			baseUrl: def.baseUrl,
			auth: { apiKey: envApiKeyAuth("API key", []) },
			models: def.models.map((m) => mkCustomModel(def, m)),
			api: openAICompletionsApi(),
		}),
	);
}

export function unregisterCustomProvider(id: string): void {
	MODELS.deleteProvider(id);
}

export function validateCustomProviders(list: CustomProvider[]): string | null {
	const seen = new Set<string>();
	for (const def of list) {
		if (!/^[a-z0-9-]{1,32}$/.test(def.id)) {
			return `Invalid provider id "${def.id}" — use lowercase letters, digits and dashes.`;
		}
		if ((getBuiltinProviders() as readonly string[]).includes(def.id)) return `Provider id "${def.id}" collides with a built-in provider.`;
		if (seen.has(def.id)) return `Duplicate provider id "${def.id}".`;
		seen.add(def.id);
		if (!/^https?:\/\//.test(def.baseUrl)) return `Invalid base URL for "${def.id}".`;
		if (def.models.length === 0) return `Provider "${def.id}" needs at least one model.`;
		const modelIds = new Set<string>();
		for (const m of def.models) {
			if (!m.id) return `Provider "${def.id}" has an empty model id.`;
			if (modelIds.has(m.id)) return `Provider "${def.id}" lists model "${m.id}" twice.`;
			modelIds.add(m.id);
			if (m.contextWindow !== undefined && (!Number.isFinite(m.contextWindow) || m.contextWindow <= 0)) {
				return `Provider "${def.id}" model "${m.id}" has an invalid context window.`;
			}
		}
		if (def.defaultContextWindow !== undefined && (!Number.isFinite(def.defaultContextWindow) || def.defaultContextWindow <= 0)) {
			return `Provider "${def.id}" has an invalid default context window.`;
		}
		if (def.defaultMaxTokens !== undefined && (!Number.isFinite(def.defaultMaxTokens) || def.defaultMaxTokens <= 0)) {
			return `Provider "${def.id}" has an invalid default max tokens.`;
		}
	}
	return null;
}

export function providerModels(provider: string): { id: string; name: string }[] {
	return MODELS.getModels(provider).map((m) => ({ id: m.id, name: m.name }));
}

export function providerBaseUrl(provider: string): string | undefined {
	return MODELS.getProvider(provider)?.baseUrl;
}

export function supportedThinkingLevels(model?: PartnerModel): ThinkingLevel[] {
	try {
		return getSupportedThinkingLevels(resolveModel(model));
	} catch {
		return [];
	}
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
	const out: Message[] = [];
	const pending: Message[] = [];
	const flush = () => {
		out.push(...pending);
		pending.length = 0;
	};
	for (const m of messages) {
		if (m.role === "user" || m.role === "assistant") {
			flush();
			out.push(m);
		} else if (m.role === "toolResult") {
			out.push(m);
		} else if ("display" in m && m.display) {
			pending.push({ role: "user", content: `[to user]: ${m.content}`, timestamp: m.timestamp });
		}
	}
	flush();
	return out;
}

export function resolveModel(model?: PartnerModel): Model<any> {
	const provider = model?.provider ?? "deepseek";
	if (!getApiKey(provider)) {
		throw new Error(`No API key configured for provider "${provider}" — set it in Settings (Runtime → api key).`);
	}
	const modelId = model?.modelId ?? DEFAULT_MODELS[provider] ?? MODELS.getModels(provider)[0]?.id;
	const resolved = modelId ? MODELS.getModel(provider, modelId) : undefined;
	if (!resolved) {
		throw new Error(`Model "${modelId ?? "?"}" not found for provider "${provider}". Set a model in settings.`);
	}
	return resolved;
}

export function contextWindow(model?: PartnerModel): number {
	return resolveModel(model).contextWindow;
}

export const STREAM_FN = MODELS.streamSimple.bind(MODELS);
