import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import { editorNames, type Backend, openInCodeEditor, openInFinder, openTargets } from "@milu/core";
import type { Frame, LiveEvent, MethodName, Methods, SeqEntry } from "@milu/protocol";
import { WebSocketServer, type WebSocket } from "ws";

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

/** The transport adapter: one HTTP origin for the page, one WebSocket for the protocol. */
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

	function live(event: LiveEvent): void {
		for (const socket of sockets.clients) send(socket, { kind: "live", event });
	}

	// One handler per method, keyed by the protocol's method map — a missing one is a type error.
	const handlers = {
		async transcript(params) {
			const session = await backend.sessions.get(params.session);
			const entries = await session.entries(params.since ?? 0);
			return { entries, cursor: entries.at(-1)?.seq ?? 0 };
		},
		async prompt(params) {
			const session = await backend.sessions.get(params.session);
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
		async sessions() {
			return { sessions: [...(await backend.sessions.list())] };
		},
		async markRead(params) {
			await backend.sessions.markRead(params.session, params.readAt);
			return {};
		},
		async pin(params) {
			await backend.sessions.pin(params.session, params.pinned);
			return {};
		},
		async editors() {
			return openTargets();
		},
		async openPath(params) {
			const opened = params.via === "finder" ? await openInFinder(params.path) : await openInCodeEditor(params.path, params.editorId);
			if (opened.ok) return { ok: true };
			const error =
				opened.reason === "missing-path"
					? `${params.path} is gone`
					: opened.reason === "editor-missing"
						? `${params.editorId} is not installed`
						: opened.reason === "no-editor"
							? `no code editor found (${editorNames()})`
							: `no editor would take ${params.path} — nor did the default app`;
			return { ok: false, error };
		},
		async layout() {
			return backend.layout.state();
		},
		async layoutSet(params) {
			return backend.layout.setLayout(params.layout);
		},
	} satisfies { [K in MethodName]: (params: Methods[K]["params"]) => Promise<Methods[K]["result"]> };

	// A cursor per socket per chat: `seq` is only comparable inside one chat's log.
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
					const result = await (method as (params: unknown) => Promise<unknown>)(frame.params);
					if (frame.method === "transcript") {
						// The replay is the client's new starting point for this chat; live frames continue from there.
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
			unsubscribeEntry.dispose();
			unsubscribeLayout.dispose();
			unsubscribeLoop.dispose();
			sockets.close();
			http.close();
		},
	};
}
