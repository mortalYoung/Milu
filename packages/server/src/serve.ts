import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import type { Backend } from "@milu/core";
import type { DialogDescriptor, Frame, LiveEvent, MethodName, Methods, SeqEntry } from "@milu/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import { pickDirectory } from "./pick-directory.ts";

const PORT = 8787;

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".png": "image/png",
};

export interface ServeOptions {
	readonly backend: Backend;
	readonly configRoot: string;
	readonly workspace: string;
	readonly webDir: string;
}

export interface Server {
	close(): Promise<void>;
}

export async function serve(options: ServeOptions): Promise<Server> {
	const { backend, configRoot, workspace, webDir } = options;

	async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
		const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
		if (relative.startsWith("..")) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = await readFile(join(webDir, relative));
			response.writeHead(200, { "content-type": CONTENT_TYPES[extname(relative)] ?? "application/octet-stream" }).end(body);
		} catch {
			response.writeHead(404, { "content-type": "text/plain" }).end("not found");
		}
	}

	const http = createServer((request, response) => {
		void serveStatic(new URL(request.url ?? "/", "http://localhost").pathname, response);
	});

	const sockets = new WebSocketServer({ noServer: true });

	function send(socket: WebSocket, frame: Frame): void {
		if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
	}

	function fail(socket: WebSocket, id: number, code: string, message: string): void {
		send(socket, { kind: "res", id, ok: false, error: { code, message } });
	}

	const DIALOG_TIMEOUT_MS = 5 * 60_000;
	const askings = new Map<string, { socket: WebSocket; settle: (value: unknown) => void }>();

	function dialogFor(socket: WebSocket) {
		return (dialog: DialogDescriptor): Promise<unknown> =>
			new Promise((settle) => {
				const id = randomUUID();
				const timer = setTimeout(() => {
					askings.delete(id);
					settle(null);
				}, DIALOG_TIMEOUT_MS);
				askings.set(id, {
					socket,
					settle: (value) => {
						clearTimeout(timer);
						settle(value);
					},
				});
				send(socket, { kind: "live", event: { type: "dialog", id, dialog } });
			});
	}

	function live(event: LiveEvent): void {
		for (const socket of sockets.clients) send(socket, { kind: "live", event });
	}

	const handlers = {
		async transcript(params) {
			const session = await backend.sessions.ensure(params.session);
			const entries = await session.entries(params.since ?? 0);
			return { entries, cursor: entries.at(-1)?.seq ?? 0 };
		},
		async prompt(params) {
			const session = await backend.sessions.ensure(params.session);
			try {
				await session.run(params.text);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				live({ type: "status", session: params.session, running: false, error: message });
				return { accepted: false };
			}
			return { accepted: true };
		},
		async abort(params) {
			backend.sessions.get(params.session).abort();
			return {};
		},
		async hotkeys() {
			return { bindings: backend.actions.bindings() };
		},
		async composer(params) {
			return backend.sessions.composer(await backend.sessions.ensure(params.session));
		},
		async sessions() {
			return { sessions: [...(await backend.sessions.list())] };
		},
		async markRead(params) {
			await backend.sessions.markRead(params.session, params.readAt);
			return {};
		},
		async invoke(params, socket) {
			try {
				const command = await backend.actions.run(params.action, {
					dialog: dialogFor(socket),
					confirm: async (copy) => (await dialogFor(socket)({ kind: "confirm", copy })) === true,
					sessions: backend.sessions,
					...(params.session ? { session: await backend.sessions.ensure(params.session) } : {}),
					...(params.args === undefined ? {} : { args: params.args }),
				});
				return { ok: true, ...(command ? { command } : {}) };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		async answer(params) {
			const asking = askings.get(params.id);
			if (!asking) return {};
			askings.delete(params.id);
			asking.settle(params.value);
			return {};
		},
		async contributions(params) {
			const point = backend.contributions.get<{ id: string; title: string; icon?: string; order?: number; action: string }>(params.point);
			const items = point.all().map((item) => ({
				id: item.id,
				title: item.title,
				...(item.icon ? { icon: item.icon } : {}),
				action: item.action,
				...(item.order === undefined ? {} : { order: item.order }),
			}));
			return { items: items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)) };
		},
		async pickDirectory(params) {
			const path = await pickDirectory(params.startingFolder);
			return path === undefined ? {} : { path };
		},
		async layout() {
			return backend.layout.state();
		},
		async layoutSet(params) {
			return backend.layout.setLayout(params.layout);
		},
	} satisfies { [K in MethodName]: (params: Methods[K]["params"], socket: WebSocket) => Promise<Methods[K]["result"]> };

	const cursors = new WeakMap<WebSocket, Map<string, number>>();

	function cursorOf(socket: WebSocket): Map<string, number> {
		const existing = cursors.get(socket);
		if (existing) return existing;
		const created = new Map<string, number>();
		cursors.set(socket, created);
		return created;
	}

	function forward(socket: WebSocket, session: string, entry: SeqEntry): void {
		const seen = cursorOf(socket);
		const last = seen.get(session) ?? 0;
		if (entry.seq <= last) return;
		seen.set(session, entry.seq);
		send(socket, { kind: "entry", session, seq: entry.seq, entry: entry.entry });
	}

	const unsubscribeEntry = backend.sessions.onEntry(({ session, entry }) => {
		for (const socket of sockets.clients) forward(socket, session, entry);
	});

	const unsubscribeLayout = backend.layout.onChange((state) => {
		live({ type: "layout", ...state });
	});

	const unsubscribeLoop = backend.sessions.onLoopEvent(({ session, event }) => {
		if (event.type === "message_update") return;
		if (event.type === "run_start") live({ type: "status", session, running: true });
		if (event.type === "run_end") live({ type: "status", session, running: false, ...(event.error ? { error: event.error } : {}) });
	});

	http.on("upgrade", (request, socket, head) => {
		if (new URL(request.url ?? "/", "http://localhost").pathname !== "/ws") {
			socket.destroy();
			return;
		}
		sockets.handleUpgrade(request, socket, head, (client) => {
			sockets.emit("connection", client, request);
		});
	});

	sockets.on("connection", (socket) => {
		cursorOf(socket);
		socket.on("close", () => {
			for (const [id, asking] of askings) {
				if (asking.socket !== socket) continue;
				askings.delete(id);
				asking.settle(null);
			}
		});
		socket.on("message", (data) => {
			void (async () => {
				let frame: Frame;
				try {
					frame = JSON.parse(String(data)) as Frame;
				} catch {
					return;
				}
				if (frame.kind !== "req") return;
				const method = handlers[frame.method as MethodName];
				if (!method) {
					fail(socket, frame.id, "unknown_method", `no method "${frame.method}"`);
					return;
				}
				try {
					const result = await (method as (params: unknown, socket: WebSocket) => Promise<unknown>)(frame.params, socket);
					if (frame.method === "transcript") {
						const session = (frame.params as Methods["transcript"]["params"]).session;
						cursorOf(socket).set(session, (result as Methods["transcript"]["result"]).cursor);
					}
					send(socket, { kind: "res", id: frame.id, ok: true, result });
				} catch (error) {
					fail(socket, frame.id, "handler_failed", error instanceof Error ? error.message : String(error));
				}
			})();
		});
	});

	http.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EADDRINUSE") {
			console.error(`port ${PORT} is already in use — stop whatever holds it, then start again`);
			process.exit(1);
		}
		throw error;
	});

	await new Promise<void>((resolve) => {
		http.listen(PORT, "127.0.0.1", () => {
			console.log(`MILU_URL=http://127.0.0.1:${PORT}/`);
			console.log(`config=${configRoot} workspace=${workspace} web=${webDir}`);
			console.log(`partners=${backend.sessions.partnerRoot}`);
			void backend.sessions
				.list()
				.then((rows) => console.log(`sessions=${rows.length}`))
				.catch((error: unknown) => console.warn(`sessions: ${error instanceof Error ? error.message : String(error)}`));
			resolve();
		});
	});

	return {
		async close() {
			for (const [id, asking] of askings) {
				askings.delete(id);
				asking.settle(null);
			}
			unsubscribeEntry.dispose();
			unsubscribeLayout.dispose();
			unsubscribeLoop.dispose();
			sockets.close();
			http.close();
		},
	};
}
