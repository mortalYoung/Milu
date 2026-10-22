import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { createBackend } from "@milu/bootstrap";
import { app, BrowserWindow, net, protocol } from "electron";

import { IpcServer } from "./ipc.ts";
import { DEFAULT_WINDOW_STATE, readWindowState, WINDOW_MIN, writeWindowState } from "./window-state.ts";

const DEV_URL = process.env["MILU_DEV_URL"];
const CONFIG_ROOT = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const WORKSPACE = process.env["MILU_WORKSPACE"] ?? process.cwd();
const HIDDEN = process.env["MILU_HIDDEN"] === "1";
const SCHEME = "milu";

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveRenderer(directory: string): void {
	protocol.handle(SCHEME, async (request) => {
		const path = normalize(join(directory, decodeURIComponent(new URL(request.url).pathname)));
		if (path !== directory && !path.startsWith(directory + sep)) return new Response("forbidden", { status: 403 });
		const response = await net.fetch(pathToFileURL(path).toString());
		const headers = new Headers(response.headers);
		headers.set(
			"content-security-policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
		);
		return new Response(response.body, { status: response.status, headers });
	});
}

async function main(): Promise<void> {
	const appDir = app.getAppPath();
	serveRenderer(join(appDir, "renderer/dist"));
	const backend = await createBackend({ root: CONFIG_ROOT, workspace: WORKSPACE });
	const ipc = new IpcServer(backend);
	ipc.start();

	const rememberSession = backend.settings.get().rememberSession !== false;
	const state = (rememberSession ? readWindowState(CONFIG_ROOT) : null) ?? DEFAULT_WINDOW_STATE;
	const window = new BrowserWindow({
		title: "Milu",
		x: state.frame.x,
		y: state.frame.y,
		width: Math.max(state.frame.width, WINDOW_MIN.width),
		height: Math.max(state.frame.height, WINDOW_MIN.height),
		minWidth: WINDOW_MIN.width,
		minHeight: WINDOW_MIN.height,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 20, y: 20 },
		backgroundColor: "#faf9f5",
		show: false,
		webPreferences: {
			preload: join(appDir, "dist-electron/preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	if (state.maximized) window.maximize();
	if (!HIDDEN) window.once("ready-to-show", () => window.show());

	let frameTimer: ReturnType<typeof setTimeout> | undefined;
	const remember = (): void => {
		if (!rememberSession || window.isDestroyed()) return;
		clearTimeout(frameTimer);
		frameTimer = setTimeout(() => {
			if (window.isDestroyed()) return;
			writeWindowState(CONFIG_ROOT, { frame: window.getNormalBounds(), maximized: window.isMaximized() });
		}, 400);
	};
	const flush = (): void => {
		if (!rememberSession || window.isDestroyed()) return;
		clearTimeout(frameTimer);
		writeWindowState(CONFIG_ROOT, { frame: window.getNormalBounds(), maximized: window.isMaximized() });
	};

	window.on("resize", remember);
	window.on("move", remember);
	window.on("maximize", remember);
	window.on("unmaximize", remember);
	window.on("close", flush);
	app.on("before-quit", flush);

	window.on("closed", () => {
		app.off("before-quit", flush);
		ipc.stop();
		void backend.close();
	});

	if (DEV_URL) await window.loadURL(DEV_URL);
	else await window.loadURL(`${SCHEME}://app/index.html`);

	console.log(`[milu] partners=${backend.sessions.partnerRoot}`);
}

const singleInstance = HIDDEN || app.requestSingleInstanceLock();

if (!singleInstance) {
	app.quit();
} else {
	app.on("second-instance", () => {
		const existing = BrowserWindow.getAllWindows()[0];
		if (!existing) return;
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
	});

	app
		.whenReady()
		.then(main)
		.catch((error: unknown) => {
			console.error("[milu] failed to start", error);
			app.quit();
		});

	app.on("window-all-closed", () => app.quit());
}
