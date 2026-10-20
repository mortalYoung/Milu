import {
	type Backend,
	type BackendConfig,
	ActionService,
	ActionServiceId,
	ConfigService,
	ConfigServiceId,
	ContributionService,
	ContributionServiceId,
	declareExtensionServices,
	ExecutionService,
	ExecutionServiceId,
	LayoutService,
	LayoutServiceId,
	ModelsService,
	ModelsServiceId,
	PromptService,
	PromptServiceId,
	SelectionService,
	SelectionServiceId,
	ExtensionService,
	ExtensionServiceId,
	SessionService,
	SessionServiceId,
	SettingsService,
	SettingsServiceId,
	ToolService,
	ToolServiceId,
} from "@milu/core";
import { Container } from "@milu/di";

import { EXTENSIONS } from "./extensions.ts";
import { BUILT_IN_SURFACES } from "./surfaces.ts";

export async function createBackend(config: BackendConfig): Promise<Backend> {
	const container = new Container();

	container.register(ConfigServiceId, () => new ConfigService({ root: config.root, workspace: config.workspace }));
	container.register(ContributionServiceId, () => new ContributionService());
	container.register(ModelsServiceId, (c) => new ModelsService(c.get(ConfigServiceId), c.get(SettingsServiceId)));
	container.register(ExecutionServiceId, () => new ExecutionService());
	container.register(SettingsServiceId, (c) => new SettingsService(c.get(ConfigServiceId)));
	container.register(LayoutServiceId, (c) => new LayoutService(c.get(ConfigServiceId), { surfaces: BUILT_IN_SURFACES }));
	container.register(ToolServiceId, (c) => new ToolService(c.get(ConfigServiceId), c.get(ExecutionServiceId)));
	container.register(PromptServiceId, (c) => new PromptService(c.get(ContributionServiceId)));
	container.register(ActionServiceId, () => new ActionService());
	container.register(
		ExtensionServiceId,
		(c) =>
			new ExtensionService(c.get(ContributionServiceId), c.get(ConfigServiceId), c.get(ActionServiceId), c.get(ModelsServiceId), c.get(SettingsServiceId), c, {
				extensions: EXTENSIONS,
			}),
	);
	container.register(
		SessionServiceId,
		(c) =>
			new SessionService(c.get(ExecutionServiceId), c.get(SettingsServiceId), c.get(ModelsServiceId), c.get(ToolServiceId), c.get(ContributionServiceId), c.get(PromptServiceId)),
	);
	container.register(SelectionServiceId, (c) => new SelectionService(c.get(SessionServiceId), c.get(ConfigServiceId)));

	declareExtensionServices(container, EXTENSIONS);

	await container.initialize();

	const sessions = container.get(SessionServiceId);

	return {
		sessions,
		models: container.get(ModelsServiceId),
		config: container.get(ConfigServiceId),
		contributions: container.get(ContributionServiceId),
		actions: container.get(ActionServiceId),
		tools: container.get(ToolServiceId),
		settings: container.get(SettingsServiceId),
		layout: container.get(LayoutServiceId),
		selection: container.get(SelectionServiceId),
		dispose: () => container.dispose(),
		async close() {
			container.dispose();
			await sessions.shutdown();
		},
	};
}
