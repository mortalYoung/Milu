import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { createBackend } from "@milu/bootstrap";
import type { WindowRef } from "@milu/core";
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell } from "electron";

import { bootMark } from "./boot.ts";
import { extensionHostFactory } from "./extension-host.ts";
import { FloatingWindows } from "./floating-windows.ts";
import { IpcServer } from "./ipc.ts";
import { bootUrl, widgetUrl } from "./widget-url.ts";
import { DEFAULT_WINDOW_STATE, readRememberSession, readWindowState, WINDOW_MIN, writeWindowState } from "./window-state.ts";

const DEV_URL = process.env["MILU_DEV_URL"];
const CONFIG_ROOT = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const WORKSPACE = process.env["MILU_WORKSPACE"] ?? process.cwd();
const HIDDEN = process.env["MILU_HIDDEN"] === "1";
const SCHEME = "milu";

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function extensionFile(roots: Readonly<Record<string, string>>, id: string, rest: string): string | null {
	const found = roots[id];
	if (found === undefined) return null;
	const root = normalize(found);
	const path = normalize(join(root, rest));
	return path.startsWith(root + sep) ? path : null;
}

function serveRenderer(directory: string, roots: () => Readonly<Record<string, string>>): void {
	protocol.handle(SCHEME, async (request) => {
		const pathname = decodeURIComponent(new URL(request.url).pathname);
		const extension = /^\/extensions\/([^/]+)\/(.+)$/.exec(pathname);
		const path = extension ? extensionFile(roots(), extension[1] ?? "", extension[2] ?? "") : normalize(join(directory, pathname));
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
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
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
	serveRenderer(join(appDir, "renderer/dist"), () => backend?.extensions.roots() ?? {});
	const target = DEV_URL === undefined ? `${SCHEME}://app/` : `${DEV_URL.replace(/\/+$/, "")}/`;
	const absolute = (path: string | undefined): string | undefined => (path === undefined ? undefined : /^[a-z]+:/i.test(path) ? path : `${target}${path.replace(/^\/+/, "")}`);
	const windows = (): readonly WindowRef[] => backend?.extensions.windows() ?? [];
	const preamble =
		DEV_URL === undefined
			? undefined
			: [
					`const loaded = await import(${JSON.stringify(`${target}@react-refresh`)});`,
					"const runtime = loaded.default ?? loaded;",
					"runtime.injectIntoGlobalHook(window);",
					"window.$RefreshReg$ = () => {};",
					"window.$RefreshSig$ = () => (type) => type;",
					"window.__vite_plugin_react_preamble_installed__ = true;",
				].join("\n");
	const floating = new FloatingWindows({
		root: CONFIG_ROOT,
		preload: join(appDir, "dist-electron/preload.cjs"),
		windows,
		asset: async (extension, root, file) => absolute(await widgetUrl(extension, file, root)),
		boot: async () => absolute(await bootUrl()),
		dispatch: (action, args) => {
			if (ipc === null || window.isDestroyed()) return;
			void ipc
				.dispatch(window.webContents, action, args)
				.then((result) => {
					if (!result.ok) console.error(`[milu] window action "${action}" failed: ${result.error ?? "unknown"}`);
				})
				.catch((error: unknown) => console.error(`[milu] window action "${action}" failed`, error));
		},
		notify: (window, drag, look) => ipc?.motion(window, drag, look),
		...(preamble === undefined ? {} : { preamble }),
	});
	const creating = createBackend({ root: CONFIG_ROOT, workspace: WORKSPACE, hosts: extensionHostFactory, windows: floating });
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
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#181715" : "#faf9f5",
		show: false,
		webPreferences: {
			preload: join(appDir, "dist-electron/preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	const openExternal = (url: string): void => {
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
			void shell.openExternal(url);
		} catch {}
	};
	window.webContents.setWindowOpenHandler(({ url }) => {
		openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url === window.webContents.getURL()) return;
		event.preventDefault();
		openExternal(url);
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
	app.on("before-quit", () => floating.dispose());

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
	ipc = new IpcServer(started, floating);
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
