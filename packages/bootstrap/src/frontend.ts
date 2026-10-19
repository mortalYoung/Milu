import {
	ActionsService,
	ActionsServiceId,
	type BrowserCommands,
	type DialogComponent,
	DialogService,
	DialogServiceId,
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
	SessionListService,
	SessionListServiceId,
	TranscriptService,
	TranscriptServiceId,
	WorkbenchService,
	WorkbenchServiceId,
	type SocketFactory,
	Store,
	type SurfaceComponent,
	SurfaceRegistry,
	SurfaceRegistryId,
} from "@milu/client";
import { Container, DisposableStore, type Disposable } from "@milu/di";
import type { LayoutState } from "@milu/protocol";

export interface FrontEndDeps {
	readonly url: string;
	readonly createSocket?: SocketFactory;
	readonly retryMs?: number;
	readonly components?: readonly SurfaceComponent[];
	readonly widgets?: readonly WidgetComponent[];
	readonly commands?: BrowserCommands;
	readonly dialogs?: readonly DialogComponent[];
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
	container.register(DialogServiceId, () => new DialogService(deps.dialogs ?? []));
	container.register(
		ActionsServiceId,
		(c) =>
			new ActionsService(c.get(ConnectionId), {
				...deps.commands,
				select: (session) => c.get(TranscriptServiceId).select(session),
				shell: (on) => (on === "toggle" ? c.get(ComposerServiceId).toggleShell() : c.get(ComposerServiceId).setShell(on)),
			}),
	);
	container.register(HeaderServiceId, (c) => new HeaderService(c.get(ConnectionId)));
	container.register(PickerServiceId, (c) => new PickerService(c.get(ConnectionId)));
	container.register(SessionListServiceId, (c) => new SessionListService(c.get(ConnectionId)));
	container.register(TranscriptServiceId, (c) => new TranscriptService(c.get(ConnectionId), c.get(SessionListServiceId)));
	container.register(ColumnsServiceId, () => new ColumnsService());
	container.register(WorkbenchServiceId, () => new WorkbenchService());
	container.register(SurfaceRegistryId, () => new SurfaceRegistry(deps.components ?? []));
	container.register(WidgetRegistryId, () => new WidgetRegistry(deps.widgets ?? []));
	container.register(HotkeysServiceId, (c) => new HotkeysService(c.get(ConnectionId)));
	container.register(ComposerServiceId, (c) => new ComposerService(c.get(ConnectionId), c.get(ActionsServiceId), c.get(HotkeysServiceId)));
	await container.initialize();

	const connection = container.get(ConnectionId);
	const actions = container.get(ActionsServiceId);
	const dialogs = container.get(DialogServiceId);
	const header = container.get(HeaderServiceId);
	const picker = container.get(PickerServiceId);
	const sessions = container.get(SessionListServiceId);
	const transcript = container.get(TranscriptServiceId);
	const columns = container.get(ColumnsServiceId);
	const workbench = container.get(WorkbenchServiceId);
	const surfaces = container.get(SurfaceRegistryId);
	const composer = container.get(ComposerServiceId);
	const hotkeys = container.get(HotkeysServiceId);
	const widgets = container.get(WidgetRegistryId);
	const layoutState = new Store<LayoutState>({ surfaces: [], layout: {} });

	const disposables = new DisposableStore();
	let started = false;

	const sync = async (): Promise<void> => {
		layoutState.set(await connection.request("layout", {}));
		await sessions.refresh();
		await header.load();
		await hotkeys.load();
		const current = transcript.selected();
		if (current) await transcript.select(current);
		else await transcript.chooseFirst(sessions.rows.get());
	};

	return {
		host: { connection, sessions, transcript, workbench, columns, actions, dialogs, header, composer, hotkeys, widgets, picker, surfaces, layoutState },
		start() {
			if (started) return;
			started = true;
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
					transcript.setStatus(event.session, event.running, event.error);
					if (!event.running) {
						void sessions.refresh();
						if (event.session === transcript.selected()) void composer.load(event.session);
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
