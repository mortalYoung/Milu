import { DisposableStore, type Disposable, IInstantiationService, InstantiationService, ServiceCollection, SyncDescriptor } from "@milu/di";
import type { Platform, Snapshot, WidgetEntry } from "@milu/protocol";
import {
	ActionsService,
	IActionsService,
	type BrowserCommands,
	DialogService,
	IDialogService,
	FooterService,
	IFooterService,
	HeaderService,
	IHeaderService,
	LayoutService,
	ILayoutService,
	HotkeysService,
	IHotkeysService,
	PickerService,
	IPickerService,
	ColumnsService,
	IColumnsService,
	CommandRegistry,
	CommandRegistryId,
	ComposerService,
	IComposerService,
	ComposerTriggerRegistry,
	ComposerTriggerRegistryId,
	WidgetRegistry,
	WidgetRegistryId,
	Connection,
	IConnection,
	type Host,
	RowRegistry,
	RowRegistryId,
	SlotsService,
	ISlotsService,
	SessionListService,
	ISessionListService,
	SelectionService,
	ISelectionService,
	TranscriptService,
	ITranscriptService,
	WelcomeService,
	IWelcomeService,
	WorkbenchService,
	IWorkbenchService,
	type ComposerTriggerComponent,
	type Transport,
	type SurfaceComponent,
	SurfaceRegistry,
	SurfaceRegistryId,
	loadWidgets,
	type WidgetFailure,
} from "@milu/window";
import type { MarkdownPort } from "@milu/window/markdown";

export interface FrontEndDeps {
	readonly transport: Transport;
	readonly components?: readonly SurfaceComponent[];
	readonly triggers?: readonly ComposerTriggerComponent[];
	readonly commands?: BrowserCommands;
	readonly platform: Platform;
	readonly markdown: MarkdownPort & Disposable;
}

export interface FrontEnd extends Disposable {
	readonly host: Host;
	readonly failures: readonly WidgetFailure[];
	start(): void;
}

async function widgetEntries(connection: Connection): Promise<readonly WidgetEntry[]> {
	try {
		return await connection.request("widgets", {});
	} catch (error) {
		console.error("discovering widgets failed", error);
		return [];
	}
}

export async function createFrontEnd(deps: FrontEndDeps): Promise<FrontEnd> {
	const connection = new Connection(deps.transport);
	const set = await loadWidgets(await widgetEntries(connection));

	let container: InstantiationService;
	const services = new ServiceCollection();
	services.set(IConnection, connection);
	for (const service of set.services) {
		if (!service.id.name.includes(".")) throw new Error(`front-end service "${service.id.name}" is not namespaced`);
		services.set(service.id, service.create);
	}
	services.set(IDialogService, new SyncDescriptor(DialogService, [set.dialogs]));
	services.set(IActionsService, new SyncDescriptor(ActionsService, [{ ...deps.commands }]));
	services.set(IHeaderService, new SyncDescriptor(HeaderService));
	services.set(IFooterService, new SyncDescriptor(FooterService));
	services.set(IPickerService, new SyncDescriptor(PickerService));
	services.set(ISessionListService, new SyncDescriptor(SessionListService));
	services.set(ISelectionService, new SyncDescriptor(SelectionService));
	services.set(ITranscriptService, new SyncDescriptor(TranscriptService));
	services.set(IWelcomeService, new SyncDescriptor(WelcomeService));
	services.set(ISlotsService, new SyncDescriptor(SlotsService, [set.slots]));
	services.set(RowRegistryId, new SyncDescriptor(RowRegistry, [set.rows]));
	services.set(IColumnsService, new SyncDescriptor(ColumnsService));
	services.set(IWorkbenchService, new SyncDescriptor(WorkbenchService));
	services.set(SurfaceRegistryId, new SyncDescriptor(SurfaceRegistry, [deps.components ?? []]));
	services.set(WidgetRegistryId, new SyncDescriptor(WidgetRegistry, [set.widgets]));
	services.set(IHotkeysService, new SyncDescriptor(HotkeysService, [deps.platform]));
	services.set(IComposerService, new SyncDescriptor(ComposerService));
	services.set(ComposerTriggerRegistryId, new SyncDescriptor(ComposerTriggerRegistry, [[...(deps.triggers ?? []), ...set.triggers]]));
	services.set(CommandRegistryId, new SyncDescriptor(CommandRegistry));
	services.set(ILayoutService, new SyncDescriptor(LayoutService));
	container = new InstantiationService(services);
	services.set(IInstantiationService, container);
	await container.initialize();

	const actions = container.get(IActionsService);
	const dialogs = container.get(IDialogService);
	const header = container.get(IHeaderService);
	const footer = container.get(IFooterService);
	const picker = container.get(IPickerService);
	const sessions = container.get(ISessionListService);
	const selection = container.get(ISelectionService);
	const transcript = container.get(ITranscriptService);
	const welcome = container.get(IWelcomeService);
	const slots = container.get(ISlotsService);
	const rows = container.get(RowRegistryId);
	const columns = container.get(IColumnsService);
	const workbench = container.get(IWorkbenchService);
	const surfaces = container.get(SurfaceRegistryId);
	const composer = container.get(IComposerService);
	const triggers = container.get(ComposerTriggerRegistryId);
	const commands = container.get(CommandRegistryId);
	const hotkeys = container.get(IHotkeysService);
	const widgets = container.get(WidgetRegistryId);
	const layout = container.get(ILayoutService);

	const disposables = new DisposableStore();
	disposables.add(deps.markdown);
	disposables.add(
		connection.onLive((event) => {
			if (event.type !== "dialog") return;
			void (async () => {
				const value = await dialogs.ask(event.id, event.dialog);
				await connection.request("answer", { id: event.id, value });
			})();
		}),
	);
	let started = false;
	let applying = false;

	const apply = (snapshot: Snapshot): void => {
		applying = true;
		try {
			layout.set(snapshot.layout);
			sessions.apply(snapshot.sessions);
			selection.apply(snapshot.selected);
			header.apply(snapshot.header);
			footer.apply(snapshot.footer);
			hotkeys.apply(snapshot.hotkeys);
			welcome.apply(snapshot.welcome);
			commands.apply(snapshot.commands);
			slots.apply(snapshot.slots);
		} finally {
			applying = false;
		}
		if (snapshot.selected) void transcript.open(snapshot.selected);
	};

	return {
		failures: set.failures,
		host: {
			connection,
			sessions,
			selection,
			transcript,
			welcome,
			workbench,
			columns,
			actions,
			dialogs,
			header,
			footer,
			composer,
			triggers,
			commands,
			hotkeys,
			widgets,
			picker,
			surfaces,
			slots,
			rows,
			markdown: deps.markdown,
			layout,
			get: (id) => container.get(id),
		},
		start() {
			if (started) return;
			started = true;
			disposables.add({
				dispose: selection.store.subscribe(() => {
					if (applying) return;
					const name = selection.store.getState().selected;
					void sessions.refresh();
					if (name) void transcript.open(name);
				}),
			});
			disposables.add({
				dispose: sessions.store.subscribe(() => {
					const dropped = transcript.retain(sessions.store.getState().rows);
					const name = selection.store.getState().selected;
					if (name !== "" && dropped.includes(name)) void transcript.open(name);
				}),
			});
			disposables.add(connection.onSnapshot(apply));
			disposables.add(connection.onLink((up) => transcript.setLinked(up)));
			disposables.add(connection.onEntry(({ session, entry }) => transcript.append(session, entry)));
			disposables.add(connection.onPartial(({ session, message }) => transcript.setPartial(session, message)));
			disposables.add(
				connection.onLive((event) => {
					if (event.type === "lifecycle") {
						connection.phase(event.phase);
						return;
					}
					if (event.type === "layout") {
						layout.set(event);
						return;
					}
					if (event.type === "dialog") {
						void dialogs.ask(event.id, event.dialog).then((value) => connection.request("answer", { id: event.id, value }));
						return;
					}
					if (event.type === "selection") {
						selection.apply(event.selected);
						return;
					}
					if (event.type === "composer") {
						composer.apply(event.session, event.mode);
						return;
					}
					if (event.type !== "status") return;
					sessions.patchStatus(event.session, event.running, event.error);
					transcript.markRunning(event.session, event.running);
					if (!event.running) {
						transcript.clearPartial(event.session);
						void sessions.refresh();
						if (event.session === selection.store.getState().selected) void composer.load(event.session);
					}
				}),
			);
			void connection.connect().catch((error: unknown) => console.error("connection failed", error));
		},
		dispose() {
			disposables.dispose();
			container.dispose();
		},
	};
}
