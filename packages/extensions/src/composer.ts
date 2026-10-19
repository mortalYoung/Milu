import type { Extension, ModelRef, ModelsService, Session, SettingsService } from "@milu/core";

export interface ModelGroup {
	readonly provider: string;
	readonly models: readonly { readonly id: string; readonly name: string }[];
}

export interface ModelWidgetData {
	readonly label: string;
	readonly effort: string;
	readonly efforts: readonly string[];
	readonly groups: readonly ModelGroup[];
	readonly selected: ModelRef | null;
}

export interface MeterWidgetData {
	readonly used: number;
	readonly window: number;
	readonly percent: number;
}

let services: { readonly models: ModelsService; readonly settings: SettingsService } | null = null;

function groupsOf(models: ModelsService, settings: SettingsService): ModelGroup[] {
	return (settings.get().providers ?? [])
		.map((provider) => ({ provider, models: models.available(provider).map((model) => ({ id: model.id, name: model.name })) }))
		.filter((group) => group.models.length > 0);
}

async function modelDataOf(session: Session): Promise<ModelWidgetData | null> {
	if (!services) return null;
	const { models, settings } = services;
	const groups = groupsOf(models, settings);
	if (groups.length === 0) return null;

	const chosen = await session.model();
	let efforts: string[] = [];
	try {
		efforts = [...models.supportedThinkingLevels(models.resolve(chosen ?? undefined))];
	} catch {
		efforts = [];
	}

	return { label: chosen?.modelId ?? "default model", effort: session.thinkingLevel(), efforts, groups, selected: chosen };
}

export const modelsExtension: Extension = {
	id: "composer.models",
	apiVersion: 1,

	contributions: {
		"composer.right": [{ id: "models", order: 10, widget: "models", data: (session: Session) => modelDataOf(session) }],
	},

	activate(context) {
		services = { models: context.models, settings: context.settings };

		context.actions.register({
			id: "model.set",
			run: async ({ session, args }) => {
				if (!session) throw new Error("model.set needs a session");
				const choice = (args ?? {}) as { provider?: string; modelId?: string };
				if (!choice.provider) throw new Error("model.set needs a provider");
				await session.setModel({
					provider: choice.provider,
					...(choice.modelId ? { modelId: choice.modelId } : {}),
					thinkingLevel: session.thinkingLevel(),
				});
			},
		});

		context.actions.register({
			id: "model.effort",
			run: async ({ session, args }) => {
				if (!session) throw new Error("model.effort needs a session");
				const level = ((args ?? {}) as { level?: string }).level;
				if (!level) throw new Error("model.effort needs a level");
				const current = await session.model();
				const model = context.models.resolve(current ?? undefined);
				await session.setModel({ provider: model.provider, modelId: model.id, thinkingLevel: level });
			},
		});
	},
};

export const meterExtension: Extension = {
	id: "composer.meter",
	apiVersion: 1,

	contributions: {
		"composer.right": [{ id: "meter", order: 20, widget: "meter", data: (session: Session) => session.contextUsage() }],
	},
};
