import {
	type Backend,
	type BackendConfig,
	ActionService,
	CommandsService,
	ComposerService,
	IComposerService,
	CompactionService,
	ConfigService,
	ContributionService,
	declareExtensionServices,
	discoverExtensions,
	ExecutionService,
	ExtensionService,
	HookService,
	IActionService,
	ICommandsService,
	ICompactionService,
	IConfigService,
	IContributionService,
	IExecutionService,
	IExtensionService,
	IHookService,
	ILayoutService,
	ILifecycleService,
	IWatchService,
	WatchService,
	IModelsService,
	IPromptService,
	ISelectionService,
	ISessionService,
	ISettingsService,
	IThemesService,
	IToolService,
	LayoutService,
	LifecycleService,
	ModelsService,
	PromptService,
	SelectionService,
	SessionService,
	SettingsService,
	ThemesService,
	ToolService,
} from "@milu/core";
import { IInstantiationService, InstantiationService, ServiceCollection, SyncDescriptor } from "@milu/di";

import { sources } from "./extensions.ts";

export async function createBackend(config: BackendConfig): Promise<Backend> {
	const discovered = await discoverExtensions(sources(config.root));

	const services = new ServiceCollection();
	services.set(IConfigService, new ConfigService({ root: config.root, workspace: config.workspace }));
	services.set(IContributionService, new SyncDescriptor(ContributionService));
	services.set(IExecutionService, new SyncDescriptor(ExecutionService));
	services.set(ISettingsService, new SyncDescriptor(SettingsService));
	services.set(IThemesService, new SyncDescriptor(ThemesService));
	services.set(IModelsService, new SyncDescriptor(ModelsService));
	services.set(ILayoutService, new SyncDescriptor(LayoutService));
	services.set(IToolService, new SyncDescriptor(ToolService));
	services.set(IPromptService, new SyncDescriptor(PromptService));
	services.set(IHookService, new SyncDescriptor(HookService));
	services.set(IActionService, new SyncDescriptor(ActionService));
	services.set(ICommandsService, new SyncDescriptor(CommandsService));
	services.set(IComposerService, new SyncDescriptor(ComposerService));
	services.set(ICompactionService, new SyncDescriptor(CompactionService));
	services.set(IExtensionService, new SyncDescriptor(ExtensionService, [discovered, config.hosts]));
	services.set(ISessionService, new SyncDescriptor(SessionService));
	services.set(ISelectionService, new SyncDescriptor(SelectionService));
	services.set(ILifecycleService, new SyncDescriptor(LifecycleService));
	services.set(IWatchService, new SyncDescriptor(WatchService));

	declareExtensionServices(services, discovered.extensions);

	const instantiation = new InstantiationService(services);
	services.set(IInstantiationService, instantiation);
	await instantiation.initialize();

	const sessions = instantiation.get(ISessionService);
	const extensions = instantiation.get(IExtensionService);
	const lifecycle = instantiation.get(ILifecycleService);
	lifecycle.advance("restored");
	void extensions.settled().then(() => lifecycle.advance("ready"));

	return {
		sessions,
		extensions,
		models: instantiation.get(IModelsService),
		config: instantiation.get(IConfigService),
		contributions: instantiation.get(IContributionService),
		actions: instantiation.get(IActionService),
		commands: instantiation.get(ICommandsService),
		composer: instantiation.get(IComposerService),
		tools: instantiation.get(IToolService),
		settings: instantiation.get(ISettingsService),
		layout: instantiation.get(ILayoutService),
		lifecycle,
		selection: instantiation.get(ISelectionService),
		watch: instantiation.get(IWatchService),
		dispose: () => instantiation.dispose(),
		async close() {
			instantiation.dispose();
			await sessions.shutdown();
		},
	};
}
