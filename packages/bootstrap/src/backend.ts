import {
	type Backend,
	type BackendConfig,
	ChatScopeService,
	ChatScopeServiceId,
	ConfigService,
	ConfigServiceId,
	ContributionService,
	ContributionServiceId,
	ExecutionService,
	ExecutionServiceId,
	ModelsService,
	ModelsServiceId,
	sessionLogExtension,
	SettingsService,
	SettingsServiceId,
	ToolService,
	ToolServiceId,
} from "@milu/core";
import { Container } from "@milu/di";

/** The core, assembled. Construction order is dependency order; dispose runs it backwards. */
export async function createBackend(config: BackendConfig): Promise<Backend> {
	const container = new Container();

	container.register(ConfigServiceId, () => new ConfigService({ root: config.root, workspace: config.workspace }));
	container.register(ContributionServiceId, () => new ContributionService());
	container.register(ModelsServiceId, (c) => new ModelsService(c.get(ConfigServiceId)));
	container.register(ExecutionServiceId, () => new ExecutionService());
	container.register(SettingsServiceId, (c) => new SettingsService(c.get(ConfigServiceId)));
	container.register(ToolServiceId, (c) => new ToolService(c.get(ConfigServiceId), c.get(ExecutionServiceId)));
	container.register(ChatScopeServiceId, (c) => new ChatScopeService(c, c.get(SettingsServiceId), c.get(ExecutionServiceId), { extensions: [sessionLogExtension] }));

	await container.initialize();

	const chats = container.get(ChatScopeServiceId);

	return {
		chats,
		models: container.get(ModelsServiceId),
		config: container.get(ConfigServiceId),
		contributions: container.get(ContributionServiceId),
		tools: container.get(ToolServiceId),
		settings: container.get(SettingsServiceId),
		dispose: () => container.dispose(),
		async close() {
			// Dispose first so no chat keeps writing, then drain every chat's queue.
			container.dispose();
			await chats.flush();
		},
	};
}
