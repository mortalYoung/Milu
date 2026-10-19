import {
	ChatsService,
	ChatsServiceId,
	Connection,
	ConnectionId,
	type Host,
	LayoutService,
	LayoutServiceId,
	SessionsService,
	SessionsServiceId,
	ShellService,
	ShellServiceId,
	type SocketFactory,
	type Surface,
	SurfaceRegistry,
	SurfaceRegistryId,
} from "@milu/client";
import { Container, DisposableStore, type Disposable } from "@milu/di";

export interface FrontEndDeps {
	readonly url: string;
	readonly createSocket?: SocketFactory;
	readonly retryMs?: number;
	/** Everything that can be placed on the page — the core's surfaces and any extension's alike. */
	readonly surfaces?: readonly Surface[];
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
	container.register(ChatsServiceId, (c) => new ChatsService(c.get(ConnectionId)));
	container.register(SessionsServiceId, (c) => new SessionsService(c.get(ConnectionId), c.get(ChatsServiceId)));
	container.register(ShellServiceId, () => new ShellService());
	container.register(SurfaceRegistryId, () => new SurfaceRegistry(deps.surfaces ?? []));
	container.register(LayoutServiceId, (c) => new LayoutService(c.get(SurfaceRegistryId)));
	await container.initialize();

	const connection = container.get(ConnectionId);
	const chats = container.get(ChatsServiceId);
	const sessions = container.get(SessionsServiceId);
	const shell = container.get(ShellServiceId);
	const surfaces = container.get(SurfaceRegistryId);
	const layout = container.get(LayoutServiceId);

	const disposables = new DisposableStore();
	let started = false;

	/** After every (re)connect: rows first, then whatever was on screen. */
	const sync = async (): Promise<void> => {
		await chats.refresh();
		const current = sessions.selected();
		if (current) await sessions.select(current);
		else await sessions.chooseFirst(chats.rows.get());
	};

	return {
		host: { connection, chats, sessions, shell, surfaces, layout },
		start() {
			if (started) return;
			started = true;
			disposables.add(
				connection.onLink((up) => {
					sessions.setLinked(up);
					if (up) void sync();
				}),
			);
			disposables.add(connection.onEntry(({ chat, entry }) => sessions.append(chat, entry)));
			disposables.add(
				connection.onLive((event) => {
					sessions.setStatus(event.chat, event.running, event.error);
					if (!event.running) void chats.refresh();
				}),
			);
			connection.open();
		},
		dispose() {
			disposables.dispose();
			container.dispose();
		},
	};
}
