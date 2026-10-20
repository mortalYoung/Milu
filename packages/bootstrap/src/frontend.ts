import {
	ActionsService,
	ActionsServiceId,
	type BrowserCommands,
	type DialogComponent,
	DialogService,
	DialogServiceId,
	type FrontEndService,
	HeaderService,
	HeaderServiceId,
	HotkeysService,
	HotkeysServiceId,
	PickerService,
	PickerServiceId,
	ColumnsService,
	ColumnsServiceId,
	ComposerService,
	ComposerServiceId,
	type WidgetComponent,
	WidgetRegistry,
	WidgetRegistryId,
	Connection,
	ConnectionId,
	type Host,
	type MarkdownPort,
	SlotsService,
	SlotsServiceId,
	type SlotComponent,
	SessionListService,
	SessionListServiceId,
	SelectionService,
	SelectionServiceId,
	TranscriptService,
	TranscriptServiceId,
	WelcomeService,
	WelcomeServiceId,
	WorkbenchService,
	WorkbenchServiceId,
	type SocketFactory,
	Store,
	type SurfaceComponent,
	SurfaceRegistry,
	SurfaceRegistryId,
} from "@milu/client";
import { Container, DisposableStore, type Disposable } from "@milu/di";
import { SLOT_POINTS, type LayoutState, type Platform } from "@milu/protocol";

export interface FrontEndDeps {
	readonly url: string;
	readonly createSocket?: SocketFactory;
	readonly retryMs?: number;
	readonly components?: readonly SurfaceComponent[];
	readonly widgets?: readonly WidgetComponent[];
	readonly commands?: BrowserCommands;
	readonly dialogs?: readonly DialogComponent[];
	readonly services?: readonly FrontEndService[];
	readonly slots?: readonly SlotComponent[];
	readonly platform: Platform;
	readonly markdown: MarkdownPort & Disposable;
}

export interface FrontEnd extends Disposable {
	readonly host: Host;
	start(): void;
}

export async function createFrontEnd(deps: FrontEndDeps): Promise<FrontEnd> {
	const container = new Container();
	container.register(
		ConnectionId,
		() =>
			new Connection({
				url: deps.url,
				...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
				...(deps.retryMs === undefined ? {} : { retryMs: deps.retryMs }),
			}),
	);
	for (const service of deps.services ?? []) {
		if (!service.id.name.includes(".")) throw new Error(`front-end service "${service.id.name}" is not namespaced`);
		container.register(service.id, service.create);
	}
	container.register(DialogServiceId, () => new DialogService(deps.dialogs ?? []));
	container.register(
		ActionsServiceId,
		(c) =>
			new ActionsService(c.get(ConnectionId), {
				...deps.commands,
				shell: (on) => (on === "toggle" ? c.get(ComposerServiceId).toggleShell() : c.get(ComposerServiceId).setShell(on)),
			}),
	);
	container.register(HeaderServiceId, (c) => new HeaderService(c.get(ConnectionId)));
	container.register(PickerServiceId, (c) => new PickerService(c.get(ConnectionId)));
	container.register(SessionListServiceId, (c) => new SessionListService(c.get(ConnectionId)));
	container.register(SelectionServiceId, (c) => new SelectionService(c.get(ConnectionId)));
	container.register(TranscriptServiceId, (c) => new TranscriptService(c.get(ConnectionId)));
	container.register(WelcomeServiceId, (c) => new WelcomeService(c.get(ConnectionId)));
	container.register(SlotsServiceId, (c) => new SlotsService(c.get(ConnectionId), deps.slots ?? []));
	container.register(ColumnsServiceId, () => new ColumnsService());
	container.register(WorkbenchServiceId, () => new WorkbenchService());
	container.register(SurfaceRegistryId, () => new SurfaceRegistry(deps.components ?? []));
	container.register(WidgetRegistryId, () => new WidgetRegistry(deps.widgets ?? []));
	container.register(HotkeysServiceId, (c) => new HotkeysService(c.get(ConnectionId), deps.platform));
	container.register(ComposerServiceId, (c) => new ComposerService(c.get(ConnectionId), c.get(ActionsServiceId), c.get(HotkeysServiceId)));
	await container.initialize();

	const connection = container.get(ConnectionId);
	const actions = container.get(ActionsServiceId);
	const dialogs = container.get(DialogServiceId);
	const header = container.get(HeaderServiceId);
	const picker = container.get(PickerServiceId);
	const sessions = container.get(SessionListServiceId);
	const selection = container.get(SelectionServiceId);
	const transcript = container.get(TranscriptServiceId);
	const welcome = container.get(WelcomeServiceId);
	const slots = container.get(SlotsServiceId);
	const columns = container.get(ColumnsServiceId);
	const workbench = container.get(WorkbenchServiceId);
	const surfaces = container.get(SurfaceRegistryId);
	const composer = container.get(ComposerServiceId);
	const hotkeys = container.get(HotkeysServiceId);
	const widgets = container.get(WidgetRegistryId);
	const layoutState = new Store<LayoutState>({ surfaces: [], layout: {} });

	const disposables = new DisposableStore();
	disposables.add(deps.markdown);
	let started = false;

	const sync = async (): Promise<void> => {
		layoutState.set(await connection.request("layout", {}));
		const selected = await sessions.refresh();
		selection.apply(selected);
		await header.load();
		await hotkeys.load();
		await welcome.load();
		await slots.load([SLOT_POINTS.chatBar, SLOT_POINTS.chatPanes]);
		if (selected) await transcript.open(selected);
	};

	return {
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
			composer,
			hotkeys,
			widgets,
			picker,
			surfaces,
			slots,
			markdown: deps.markdown,
			layoutState,
			get: (id) => container.get(id),
		},
		start() {
			if (started) return;
			started = true;
			disposables.add({
				dispose: selection.selected.subscribe(() => {
					const name = selection.selected.get();
					void sessions.refresh();
					if (name) void transcript.open(name);
				}),
			});
			disposables.add(
				connection.onLink((up) => {
					transcript.setLinked(up);
					if (up) void sync();
				}),
			);
			disposables.add(connection.onEntry(({ session, entry }) => transcript.append(session, entry)));
			disposables.add(
				connection.onLive((event) => {
					if (event.type === "layout") {
						layoutState.set(event);
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
					sessions.patchStatus(event.session, event.running, event.error);
					if (!event.running) {
						void sessions.refresh();
						if (event.session === selection.selected.get()) void composer.load(event.session);
					}
				}),
			);
			connection.open();
		},
		dispose() {
			disposables.dispose();
			layoutState.dispose();
			container.dispose();
		},
	};
}
