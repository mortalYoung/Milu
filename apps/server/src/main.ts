import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createBackend, type Backend } from "@milu/backend";
import type { Frame, LiveEvent, MethodName, Methods, SeqEntry } from "@milu/protocol";
import { WebSocketServer, type WebSocket } from "ws";

const PORT = 8787;
const CONFIG_ROOT = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const WORKSPACE = process.env["MILU_WORKSPACE"] ?? process.cwd();
const WEB_DIR = process.env["MILU_WEB_DIR"] ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".png": "image/png",
};

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
	const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
	if (relative.startsWith("..")) {
		response.writeHead(403).end();
		return;
	}
	try {
		const body = await readFile(join(WEB_DIR, relative));
		response.writeHead(200, { "content-type": CONTENT_TYPES[extname(relative)] ?? "application/octet-stream" }).end(body);
	} catch {
		response.writeHead(404, { "content-type": "text/plain" }).end("not found");
	}
}

const backend: Backend = await createBackend({ root: CONFIG_ROOT, workspace: WORKSPACE });

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

// One handler per method, keyed by the protocol's method map — a missing one is a type error.
const handlers = {
	async transcript(params) {
		const scope = await backend.chats.ensure(params.chat);
		const entries = await scope.sessions.entries(params.since ?? 0);
		return { entries, cursor: entries.at(-1)?.seq ?? 0 };
	},
	async prompt(params) {
		const scope = await backend.chats.ensure(params.chat);
		try {
			scope.loop.setModel(backend.models.resolve());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			live({ type: "status", chat: params.chat, running: false, error: message });
			return { accepted: false };
		}
		void scope.loop
			.run(params.text)
			.then((outcome) => {
				if (outcome.error) live({ type: "status", chat: params.chat, running: false, error: outcome.error });
			})
			.catch((error: unknown) => live({ type: "status", chat: params.chat, running: false, error: error instanceof Error ? error.message : String(error) }));
		return { accepted: true };
	},
	async abort(params) {
		backend.chats.get(params.chat)?.loop.abort();
		return {};
	},
	async chats() {
		return { chats: [...(await backend.chats.list())] };
	},
	async markRead(params) {
		await backend.chats.markRead(params.chat, params.readAt);
		return {};
	},
} satisfies { [K in MethodName]: (params: Methods[K]["params"]) => Promise<Methods[K]["result"]> };

function live(event: LiveEvent): void {
	for (const socket of sockets.clients) send(socket, { kind: "live", event });
}

// A cursor per socket per chat: `seq` is only comparable inside one chat's log.
const cursors = new WeakMap<WebSocket, Map<string, number>>();

function cursorOf(socket: WebSocket): Map<string, number> {
	const existing = cursors.get(socket);
	if (existing) return existing;
	const created = new Map<string, number>();
	cursors.set(socket, created);
	return created;
}

function forward(socket: WebSocket, chat: string, entry: SeqEntry): void {
	const seen = cursorOf(socket);
	const last = seen.get(chat) ?? 0;
	if (entry.seq <= last) return;
	seen.set(chat, entry.seq);
	send(socket, { kind: "entry", chat, seq: entry.seq, entry: entry.entry });
}

const unsubscribeEntry = backend.chats.onEntry(({ chat, entry }) => {
	for (const socket of sockets.clients) forward(socket, chat, entry);
});

const unsubscribeLoop = backend.chats.onLoopEvent(({ chat, event }) => {
	if (event.type === "message_update") return;
	if (event.type === "run_start") live({ type: "status", chat, running: true });
	if (event.type === "run_end") live({ type: "status", chat, running: false, ...(event.error ? { error: event.error } : {}) });
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
					const chat = (frame.params as Methods["transcript"]["params"]).chat;
					cursorOf(socket).set(chat, (result as Methods["transcript"]["result"]).cursor);
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

http.listen(PORT, "127.0.0.1", () => {
	console.log(`MILU_URL=http://127.0.0.1:${PORT}/`);
	console.log(`config=${CONFIG_ROOT} workspace=${WORKSPACE} web=${WEB_DIR}`);
	console.log(`partners=${backend.chats.partnerRoot}`);
	void backend.chats
		.list()
		.then((rows) => console.log(`chats=${rows.length}`))
		.catch((error: unknown) => console.warn(`chats: ${error instanceof Error ? error.message : String(error)}`));
});

async function shutdown(): Promise<void> {
	unsubscribeEntry.dispose();
	unsubscribeLoop.dispose();
	sockets.close();
	await backend.close();
	http.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown().finally(() => process.exit(0)));
