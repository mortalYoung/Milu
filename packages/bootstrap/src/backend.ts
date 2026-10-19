import {
	type Backend,
	type BackendConfig,
	ActionRegistry,
	ActionRegistryId,
	ConfigService,
	ConfigServiceId,
	ContributionService,
	ContributionServiceId,
	ExecutionService,
	ExecutionServiceId,
	LayoutService,
	LayoutServiceId,
	ModelsService,
	ModelsServiceId,
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

/** The core, assembled. Construction order is dependency order; dispose runs it backwards. */
export async function createBackend(config: BackendConfig): Promise<Backend> {
	const container = new Container();

	container.register(ConfigServiceId, () => new ConfigService({ root: config.root, workspace: config.workspace }));
	container.register(ContributionServiceId, () => new ContributionService());
	container.register(ModelsServiceId, (c) => new ModelsService(c.get(ConfigServiceId)));
	container.register(ExecutionServiceId, () => new ExecutionService());
	container.register(SettingsServiceId, (c) => new SettingsService(c.get(ConfigServiceId)));
	container.register(LayoutServiceId, (c) => new LayoutService(c.get(ConfigServiceId), { surfaces: BUILT_IN_SURFACES }));
	container.register(ToolServiceId, (c) => new ToolService(c.get(ConfigServiceId), c.get(ExecutionServiceId)));
	container.register(ActionRegistryId, () => new ActionRegistry());
	container.register(ExtensionServiceId, (c) => new ExtensionService(c.get(ContributionServiceId), c.get(ConfigServiceId), c.get(ActionRegistryId), { extensions: EXTENSIONS }));
	container.register(
		SessionServiceId,
		(c) => new SessionService(c.get(ExecutionServiceId), c.get(SettingsServiceId), c.get(ModelsServiceId), c.get(ToolServiceId), c.get(ContributionServiceId)),
	);

	await container.initialize();

	const sessions = container.get(SessionServiceId);

	return {
		sessions,
		models: container.get(ModelsServiceId),
		config: container.get(ConfigServiceId),
		contributions: container.get(ContributionServiceId),
		actions: container.get(ActionRegistryId),
		tools: container.get(ToolServiceId),
		settings: container.get(SettingsServiceId),
		layout: container.get(LayoutServiceId),
		dispose: () => container.dispose(),
		async close() {
			// Dispose first so no session keeps writing, then drain every log.
			container.dispose();
			await sessions.shutdown();
		},
	};
}
