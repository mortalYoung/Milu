import {
	ActionsService,
	ActionsServiceId,
	Connection,
	ConnectionId,
	type Host,
	OpenerService,
	OpenerServiceId,
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
	/** The code this bundle brought; the core decides which of it is on the page. */
	readonly components?: readonly SurfaceComponent[];
}

export interface FrontEnd extends Disposable {
	readonly host: Host;
	start(): void;
}

/** The view layer, assembled: services in a container, surfaces registered, nothing rendered yet. */
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
	container.register(ActionsServiceId, (c) => new ActionsService(c.get(ConnectionId)));
	container.register(SessionListServiceId, (c) => new SessionListService(c.get(ConnectionId)));
	container.register(TranscriptServiceId, (c) => new TranscriptService(c.get(ConnectionId), c.get(SessionListServiceId)));
	container.register(WorkbenchServiceId, () => new WorkbenchService());
	container.register(OpenerServiceId, (c) => new OpenerService(c.get(ConnectionId)));
	container.register(SurfaceRegistryId, () => new SurfaceRegistry(deps.components ?? []));
	await container.initialize();

	const connection = container.get(ConnectionId);
	const actions = container.get(ActionsServiceId);
	const sessions = container.get(SessionListServiceId);
	const transcript = container.get(TranscriptServiceId);
	const workbench = container.get(WorkbenchServiceId);
	const opener = container.get(OpenerServiceId);
	const surfaces = container.get(SurfaceRegistryId);
	const layoutState = new Store<LayoutState>({ surfaces: [], layout: {} });

	const disposables = new DisposableStore();
	let started = false;

	/** After every (re)connect: what the page holds, then rows, then whatever was on screen. */
	const sync = async (): Promise<void> => {
		layoutState.set(await connection.request("layout", {}));
		await opener.load();
		await sessions.refresh();
		const current = transcript.selected();
		if (current) await transcript.select(current);
		else await transcript.chooseFirst(sessions.rows.get());
	};

	return {
		host: { connection, sessions, transcript, workbench, opener, actions, surfaces, layoutState },
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
					transcript.setStatus(event.session, event.running, event.error);
					if (!event.running) void sessions.refresh();
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
