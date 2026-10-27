import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { createBackend } from "@milu/bootstrap";
import type { WidgetRef } from "@milu/core";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";

import { bootMark } from "./boot.ts";
import { extensionHostFactory } from "./extension-host.ts";
import { IpcServer } from "./ipc.ts";
import { DEFAULT_WINDOW_STATE, readRememberSession, readWindowState, WINDOW_MIN, writeWindowState } from "./window-state.ts";

const DEV_URL = process.env["MILU_DEV_URL"];
const CONFIG_ROOT = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const WORKSPACE = process.env["MILU_WORKSPACE"] ?? process.cwd();
const HIDDEN = process.env["MILU_HIDDEN"] === "1";
const SCHEME = "milu";

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function extensionFile(widgets: readonly WidgetRef[], id: string, rest: string): string | null {
	const widget = widgets.find((each) => each.extension === id);
	if (!widget || widget.root === undefined) return null;
	const root = normalize(widget.root);
	const path = normalize(join(root, rest));
	return path.startsWith(root + sep) ? path : null;
}

function serveRenderer(directory: string, widgets: () => readonly WidgetRef[]): void {
	protocol.handle(SCHEME, async (request) => {
		const pathname = decodeURIComponent(new URL(request.url).pathname);
		const extension = /^\/extensions\/([^/]+)\/(.+)$/.exec(pathname);
		const path = extension ? extensionFile(widgets(), extension[1] ?? "", extension[2] ?? "") : normalize(join(directory, pathname));
		if (path === null) return new Response("not found", { status: 404 });
		if (!extension && path !== directory && !path.startsWith(directory + sep)) return new Response("forbidden", { status: 403 });
		let response: Response;
		try {
			response = await net.fetch(pathToFileURL(path).toString());
		} catch {
			return new Response("not found", { status: 404 });
		}
		const headers = new Headers(response.headers);
		headers.set(
			"content-security-policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
		);
		return new Response(response.body, { status: response.status, headers });
	});
}

async function main(): Promise<void> {
	bootMark("wake");
	const appDir = app.getAppPath();
	const icon = join(appDir, "build/icon.png");
	let backend: Awaited<ReturnType<typeof createBackend>> | null = null;
	let ipc: IpcServer | null = null;
	serveRenderer(join(appDir, "renderer/dist"), () => backend?.extensions.widgets() ?? []);
	const creating = createBackend({ root: CONFIG_ROOT, workspace: WORKSPACE, hosts: extensionHostFactory });
	let attach!: (server: IpcServer) => void;
	const listening = new Promise<IpcServer>((resolve) => {
		attach = resolve;
	});
	ipcMain.handle("milu:connect", (event) => listening.then((server) => server.connect(event)));
	ipcMain.handle("milu:request", (event, method: string, params: unknown) => listening.then((server) => server.request(event, method, params)));

	const rememberSession = readRememberSession(CONFIG_ROOT);
	const state = (rememberSession ? readWindowState(CONFIG_ROOT) : null) ?? DEFAULT_WINDOW_STATE;
	const window = new BrowserWindow({
		title: "Milu",
		icon,
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
			preload: join(appDir, "dist-electron/preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	bootMark("window");
	if (state.maximized) window.maximize();
	if (!HIDDEN)
		window.once("ready-to-show", () => {
			window.show();
			bootMark("shown");
		});

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
		ipcMain.removeHandler("milu:connect");
		ipcMain.removeHandler("milu:request");
		ipc?.stop();
		void backend?.close();
	});

	const loading = (DEV_URL ? window.loadURL(DEV_URL) : window.loadURL(`${SCHEME}://app/index.html`)).catch((error: unknown) =>
		console.error("[milu] the renderer did not load", error),
	);
	if (process.platform === "darwin") app.dock?.setIcon(icon);

	const started = await creating;
	backend = started;
	bootMark("backend");
	started.lifecycle.onChange((phase) => {
		if (phase === "ready") bootMark("ready");
	});
	if (started.lifecycle.phase === "ready") bootMark("ready");
	ipc = new IpcServer(started);
	ipc.start();
	attach(ipc);
	await loading;
	bootMark("loaded");

	console.log(`[milu] partners=${started.sessions.partnerRoot}`);
}

app.setName("Milu");
app.setAboutPanelOptions({ applicationName: "Milu", applicationVersion: app.getVersion() });

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
