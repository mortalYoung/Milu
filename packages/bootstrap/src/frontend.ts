import { Container, DisposableStore, type Disposable } from "@milu/di";
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
	LayoutService,
	LayoutServiceId,
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
	type Transport,
	type SurfaceComponent,
	SurfaceRegistry,
	SurfaceRegistryId,
} from "@milu/extensions/host";
import type { MarkdownPort } from "@milu/extensions/markdown";
import type { Platform, Snapshot } from "@milu/protocol";

export interface FrontEndDeps {
	readonly transport: Transport;
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
	container.register(ConnectionId, () => new Connection(deps.transport));
	for (const service of deps.services ?? []) {
		if (!service.id.name.includes(".")) throw new Error(`front-end service "${service.id.name}" is not namespaced`);
		container.register(service.id, service.create);
	}
	container.register(DialogServiceId, () => new DialogService(deps.dialogs ?? []));
	container.register(
		ActionsServiceId,
		(c) =>
			new ActionsService(c.get(ConnectionId), c.get(DialogServiceId), {
				...deps.commands,
				shell: (on) => (on === "toggle" ? c.get(ComposerServiceId).toggleShell() : c.get(ComposerServiceId).setShell(on)),
			}),
	);
	container.register(HeaderServiceId, () => new HeaderService());
	container.register(PickerServiceId, (c) => new PickerService(c.get(ConnectionId)));
	container.register(SessionListServiceId, (c) => new SessionListService(c.get(ConnectionId)));
	container.register(SelectionServiceId, (c) => new SelectionService(c.get(ConnectionId)));
	container.register(TranscriptServiceId, (c) => new TranscriptService(c.get(ConnectionId)));
	container.register(WelcomeServiceId, () => new WelcomeService());
	container.register(SlotsServiceId, () => new SlotsService(deps.slots ?? []));
	container.register(ColumnsServiceId, () => new ColumnsService());
	container.register(WorkbenchServiceId, () => new WorkbenchService());
	container.register(SurfaceRegistryId, () => new SurfaceRegistry(deps.components ?? []));
	container.register(WidgetRegistryId, () => new WidgetRegistry(deps.widgets ?? []));
	container.register(HotkeysServiceId, () => new HotkeysService(deps.platform));
	container.register(ComposerServiceId, (c) => new ComposerService(c.get(ConnectionId), c.get(ActionsServiceId), c.get(HotkeysServiceId)));
	container.register(LayoutServiceId, () => new LayoutService());
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
	const layout = container.get(LayoutServiceId);

	const disposables = new DisposableStore();
	disposables.add(deps.markdown);
	let started = false;
	let applying = false;

	const apply = (snapshot: Snapshot): void => {
		applying = true;
		try {
			layout.set(snapshot.layout);
			sessions.apply(snapshot.sessions);
			selection.apply(snapshot.selected);
			header.apply(snapshot.header);
			hotkeys.apply(snapshot.hotkeys);
			welcome.apply(snapshot.welcome);
			slots.apply(snapshot.slots);
		} finally {
			applying = false;
		}
		if (snapshot.selected) void transcript.open(snapshot.selected);
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
			disposables.add(connection.onSnapshot(apply));
			disposables.add(connection.onLink((up) => transcript.setLinked(up)));
			disposables.add(connection.onEntry(({ session, entry }) => transcript.append(session, entry)));
			disposables.add(
				connection.onLive((event) => {
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
					sessions.patchStatus(event.session, event.running, event.error);
					if (!event.running) {
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
