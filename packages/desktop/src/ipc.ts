import { randomUUID } from "node:crypto";

import { type Backend, SESSION_FOOTER_POINT, SESSION_HEADER_POINT, WELCOME_ITEMS_POINT, type WelcomeItem } from "@milu/core";
import {
	type ContributionItem,
	type DialogDescriptor,
	type WidgetEntry,
	type LiveEvent,
	type MethodName,
	type Params,
	type Result,
	SLOT_POINTS,
	type Snapshot,
} from "@milu/protocol";
import { BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, type IpcMainInvokeEvent, type OpenDialogOptions, Notification, type WebContents } from "electron";

import { recordBootMarks } from "./boot.ts";
import { widgetUrl } from "./widget-url.ts";

const DIALOG_TIMEOUT_MS = 5 * 60_000;
/** Tokens arrive far faster than a frame; keep the latest partial per session and flush on this beat. */
const PARTIAL_INTERVAL_MS = 32;

interface ServerEvent {
	readonly type: "entry" | "live" | "partial";
	readonly session?: string;
	readonly entry?: unknown;
	readonly message?: unknown;
	readonly event?: LiveEvent;
}

type Handlers = { [K in MethodName]: (params: Params<K>, sender: WebContents) => Promise<Result<K>> };

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class IpcServer {
	private readonly _windows = new Set<WebContents>();
	private readonly _askings = new Map<string, { settle: (value: unknown) => void }>();
	private readonly _partials = new Map<string, unknown>();
	private _partialTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly _cleanup: (() => void)[] = [];
	private readonly _handlers: Handlers;
	private _started = false;

	constructor(private readonly _backend: Backend) {
		this._handlers = {
			transcript: (params) => this._transcript(params),
			origin: (params) => this._origin(params),
			slice: (params) => this._slice(params),
			prompt: (params) => this._prompt(params),
			abort: () => this._abort(),
			hotkeys: () => this._hotkeys(),
			composer: () => this._composer(),
			composerMode: (params) => this._composerMode(params),
			composerData: (params) => this._composerData(params),
			commands: (params) => this._commands(params),
			boot: (params) => this._boot(params),
			hello: () => this._hello(),
			sessions: () => this._sessions(),
			select: (params) => this._select(params),
			read: (params) => this._read(params),
			invoke: (params, sender) => this._invoke(params, sender),
			answer: (params) => this._answer(params),
			slots: (params) => this._slots(params),
			welcome: () => this._welcome(),
			contributions: (params) => this._contributions(params),
			pickDirectory: (params, sender) => this._pickDirectory(params, sender),
			widgets: () => this._widgetEntries(),
			extensionData: (params) => this._extensionData(params),
			extensions: () => this._extensions(),
			layout: () => this._layout(),
			layoutSet: (params) => this._layoutSet(params),
		};
	}

	start(): void {
		if (this._started) return;
		this._started = true;
		const subscriptions = [
			this._backend.sessions.onEntry(({ session, entry }) => {
				this._broadcast({ type: "entry", session, entry });
				if (entry.entry.type !== "custom" || entry.entry.customType !== "escalation/request" || this._looking(session)) return;
				const request = entry.entry.data as { command?: unknown; from?: unknown; to?: unknown } | undefined;
				this._notify({
					title: `${session} · sandbox escalation`,
					body: String(request?.command ?? "").slice(0, 140),
					subtitle: `${String(request?.from ?? "")} → ${String(request?.to ?? "")}`,
					session,
				});
			}),
			this._backend.layout.onChange((state) => this._broadcast({ type: "live", event: { type: "layout", ...state } })),
			this._backend.watch.onChange((path: string) => this._broadcast({ type: "live", event: { type: "file", path } })),
			this._backend.sessions.onFork(({ session, error }) => this._broadcast({ type: "live", event: { type: "fork", session, ...(error === undefined ? {} : { error }) } })),
			this._backend.sessions.onLoopEvent(({ session, event }) => {
				if (event.type === "message_update") {
					this._queuePartial(session, event.message);
					return;
				}
				if (event.type === "message_end") {
					this._partials.delete(session);
					return;
				}
				if (event.type === "run_start") this._broadcast({ type: "live", event: { type: "status", session, running: true } });
				if (event.type === "run_end") {
					this._partials.delete(session);
					if (!this._looking(session)) void this._notifyRunEnd(session, event.error);
					const status = { type: "status" as const, session, running: false };
					void this._backend.sessions
						.get(session)
						.flush()
						.then(() => this._broadcast({ type: "live", event: status }));
				}
			}),
			this._backend.selection.onChange((selected) => {
				this._broadcast({ type: "live", event: { type: "selection", selected } });
				this._installMenu();
			}),
			this._backend.composer.onModeChange(({ session, mode }) => this._broadcast({ type: "live", event: { type: "composer", session, mode } })),
			this._backend.settings.onChange(() => this._broadcast({ type: "live", event: { type: "settings" } })),
			this._backend.lifecycle.onChange((phase) => this._broadcast({ type: "live", event: { type: "lifecycle", phase } })),
		];
		for (const subscription of subscriptions) this._cleanup.push(() => subscription.dispose());
		this._installMenu();
	}

	stop(): void {
		if (!this._started) return;
		this._started = false;
		for (const cleanup of this._cleanup.splice(0)) cleanup();
		if (this._partialTimer) clearTimeout(this._partialTimer);
		this._partialTimer = null;
		this._partials.clear();
		for (const asking of this._askings.values()) asking.settle(null);
		this._askings.clear();
		this._windows.clear();
	}

	readonly connect = async (event: IpcMainInvokeEvent): Promise<Snapshot> => {
		const sender = event.sender;
		const snapshot = await this._snapshot();
		if (!this._windows.has(sender)) {
			this._windows.add(sender);
			sender.once("destroyed", () => this._windows.delete(sender));
		}
		return snapshot;
	};

	readonly request = async (event: IpcMainInvokeEvent, method: string, params: unknown) => {
		const handler = this._handlers[method as MethodName];
		if (!handler) return { ok: false, error: { code: "unknown_method", message: `no method "${method}"` } };
		try {
			const result = await (handler as (params: unknown, sender: WebContents) => Promise<unknown>)(params, event.sender);
			return { ok: true, result };
		} catch (error) {
			return { ok: false, error: { code: "handler_failed", message: reason(error) } };
		}
	};

	private _queuePartial(session: string, message: unknown): void {
		this._partials.set(session, message);
		if (this._partialTimer) return;
		this._partialTimer = setTimeout(() => {
			this._partialTimer = null;
			for (const [name, latest] of this._partials) this._broadcast({ type: "partial", session: name, message: latest });
			this._partials.clear();
		}, PARTIAL_INTERVAL_MS);
	}

	private _send(sender: WebContents, message: ServerEvent): void {
		if (sender.isDestroyed()) return;
		sender.send("milu:event", message);
	}

	private _broadcast(message: ServerEvent): void {
		for (const sender of this._windows) this._send(sender, message);
	}

	private _dialogFor(sender: WebContents) {
		return (dialog: DialogDescriptor): Promise<unknown> =>
			new Promise((settle) => {
				const id = randomUUID();
				const timer = setTimeout(() => this._settle(id, null), DIALOG_TIMEOUT_MS);
				this._askings.set(id, {
					settle: (value) => {
						clearTimeout(timer);
						settle(value);
					},
				});
				sender.once("destroyed", () => this._settle(id, null));
				this._send(sender, { type: "live", event: { type: "dialog", id, dialog } });
			});
	}

	private _settle(id: string, value: unknown): void {
		const asking = this._askings.get(id);
		if (!asking) return;
		this._askings.delete(id);
		asking.settle(value);
	}

	private _ordered<T extends { readonly id: string; readonly order?: number }>(point: string): readonly T[] {
		return [...this._backend.contributions.get<T>(point).all()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	private async _extensionData(params: Params<"extensionData">): Promise<Result<"extensionData">> {
		return { data: await this._backend.extensions.data(params.extension, params.key, params.session) };
	}

	private async _extensions(): Promise<Result<"extensions">> {
		return { phase: this._backend.lifecycle.phase, ...this._backend.extensions.status() };
	}

	private async _widgetEntries(): Promise<readonly WidgetEntry[]> {
		const entries: WidgetEntry[] = [];
		for (const widget of this._backend.extensions.widgets()) {
			const url = await widgetUrl(widget.extension, widget.entry, widget.root);
			entries.push({
				extension: widget.extension,
				source: widget.root === undefined ? "builtin" : "package",
				id: widget.id,
				type: widget.type,
				entry: widget.entry,
				...(widget.export === undefined ? {} : { export: widget.export }),
				...(url === undefined ? {} : { url }),
			});
		}
		return entries;
	}

	private async _snapshot(): Promise<Snapshot> {
		const sessions = [...(await this._backend.sessions.list())];
		await this._backend.selection.reconcile(sessions.map((row) => row.name));
		const selected = this._backend.selection.selected ? this._backend.sessions.get(this._backend.selection.selected) : null;
		return {
			lifecycle: this._backend.lifecycle.phase,
			layout: this._backend.layout.state(),
			sessions,
			selected: this._backend.selection.selected,
			header: this._ordered<ContributionItem>(SESSION_HEADER_POINT),
			footer: this._ordered<ContributionItem>(SESSION_FOOTER_POINT),
			hotkeys: this._backend.actions.bindings(),
			commands: await this._backend.commands.list(selected),
			welcome: this._ordered<WelcomeItem>(WELCOME_ITEMS_POINT),
			slots: {
				[SLOT_POINTS.chatBar]: await this._backend.sessions.slots(SLOT_POINTS.chatBar, selected),
				[SLOT_POINTS.chatName]: await this._backend.sessions.slots(SLOT_POINTS.chatName, selected),
				[SLOT_POINTS.chatPanes]: await this._backend.sessions.slots(SLOT_POINTS.chatPanes, selected),
				[SLOT_POINTS.workspaceViews]: await this._backend.sessions.slots(SLOT_POINTS.workspaceViews, selected),
				[SLOT_POINTS.dockViews]: await this._backend.sessions.slots(SLOT_POINTS.dockViews, selected),
				[SLOT_POINTS.dockBar]: await this._backend.sessions.slots(SLOT_POINTS.dockBar, selected),
				[SLOT_POINTS.welcomeTimeline]: await this._backend.sessions.slots(SLOT_POINTS.welcomeTimeline),
				[SLOT_POINTS.overlay]: await this._backend.sessions.slots(SLOT_POINTS.overlay),
			},
		};
	}

	private async _transcript(params: Params<"transcript">): Promise<Result<"transcript">> {
		const session = await this._backend.sessions.ensure(params.session);
		const window = await session.window({
			...(params.mode ? { mode: params.mode } : {}),
			...(params.cursor ? { cursor: params.cursor } : {}),
			conversations: params.conversations ?? 6,
		});
		const entries = await session.seqsOf(window.entries);
		return { entries, total: window.total, hasMore: window.hasMore, reset: window.reset };
	}

	private async _origin(params: Params<"origin">): Promise<Result<"origin">> {
		const session = await this._backend.sessions.ensure(params.session);
		const window = await session.window({
			...(params.mode ? { mode: params.mode } : {}),
			...(params.cursor ? { cursor: params.cursor } : {}),
			conversations: params.conversations ?? 20,
		});
		const entries = await session.seqsOf(window.entries);
		return { entries, total: window.total, hasMore: window.hasMore, reset: window.reset };
	}

	private async _slice(params: Params<"slice">): Promise<Result<"slice">> {
		const session = await this._backend.sessions.ensure(params.session);
		const items = await session.sliceItems();
		return { items: items.map((item) => ({ id: item.id, message: item.message })) };
	}

	private async _prompt(params: Params<"prompt">): Promise<Result<"prompt">> {
		const name = this._backend.selection.selected;
		if (!name) throw new Error("no session is selected");
		const session = await this._backend.sessions.ensure(name);
		await this._backend.extensions.settled();
		await session.run(params.text);
		return {};
	}

	private async _abort(): Promise<Result<"abort">> {
		const name = this._backend.selection.selected;
		return { aborted: name ? this._backend.sessions.get(name).abort() : false };
	}

	private async _hotkeys(): Promise<Result<"hotkeys">> {
		return { bindings: this._backend.actions.bindings() };
	}

	private async _composer(): Promise<Result<"composer">> {
		return { layout: await this._backend.sessions.composer() };
	}

	private async _composerMode(params: Params<"composerMode">): Promise<Result<"composerMode">> {
		const session = await this._backend.sessions.ensure(params.session);
		return { mode: this._backend.composer.mode(session) };
	}

	private async _composerData(params: Params<"composerData">): Promise<Result<"composerData">> {
		const session = await this._backend.sessions.ensure(params.session);
		return { data: await this._backend.sessions.composerData(session) };
	}

	private async _commands(params: Params<"commands">): Promise<Result<"commands">> {
		const session = await this._backend.sessions.ensure(params.session);
		return { commands: await this._backend.commands.list(session) };
	}

	private async _boot(params: Params<"boot">): Promise<Result<"boot">> {
		recordBootMarks(params.marks);
		return {};
	}

	private async _hello(): Promise<Result<"hello">> {
		return { lifecycle: this._backend.lifecycle.phase, selected: this._backend.selection.selected, layout: this._backend.layout.state() };
	}

	private async _sessions(): Promise<Result<"sessions">> {
		const sessions = [...(await this._backend.sessions.list())];
		await this._backend.selection.reconcile(sessions.map((row) => row.name));
		return { sessions, selected: this._backend.selection.selected };
	}

	/** The chat on screen in a focused window — the same test v1 used before raising a system notification. */
	private _looking(session: string): boolean {
		if (this._backend.selection.selected !== session) return false;
		for (const sender of this._windows) {
			if (!sender.isDestroyed() && (BrowserWindow.fromWebContents(sender)?.isFocused() ?? false)) return true;
		}
		return false;
	}

	/** v1's menu, with the items v2 actually has; each one asks the window to run the action it names. */
	private _installMenu(): void {
		const hasSession = this._backend.selection.selected !== null;
		const command = (action: string) => () => this._broadcast({ type: "live", event: { type: "command", action } });
		const template: MenuItemConstructorOptions[] = [
			{
				label: "Milu",
				submenu: [
					{ role: "about", label: "About Milu" },
					{ type: "separator" },
					{ label: "Settings…", accelerator: "Command+,", click: command("settings.open") },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit", label: "Quit Milu" },
				],
			},
			{
				label: "Chat",
				submenu: [
					{ label: "New Chat", accelerator: "Command+N", click: command("create.session") },
					{ label: "Close Chat", enabled: hasSession, click: command("chat.close") },
					{ label: "Chat Detail", enabled: hasSession, click: command("details.session") },
					{ type: "separator" },
					{ label: "Clear Chat", enabled: hasSession, click: command("chat.clear") },
					{ label: "Pin to Top", enabled: hasSession, click: command("pin.toggle") },
				],
			},
			{
				label: "View",
				submenu: [
					{ label: "Command Palette…", accelerator: "Command+P", click: command("palette.open") },
					{ type: "separator" },
					{ label: "Skills & MCP", click: command("skills.open") },
					{ label: "Manage Access…", accelerator: "Command+Shift+P", click: command("palette.access") },
					{ type: "separator" },
					{ label: "Tasks", enabled: hasSession, click: command("tasks.open") },
					{ label: "Schedules", enabled: hasSession, click: command("schedule.open") },
					{ type: "separator" },
					{ role: "togglefullscreen" },
				],
			},
			{
				label: "Edit",
				submenu: [
					{ role: "undo" },
					{ role: "redo" },
					{ type: "separator" },
					{ role: "cut" },
					{ role: "copy" },
					{ role: "paste" },
					{ role: "pasteAndMatchStyle" },
					{ type: "separator" },
					{ role: "selectAll" },
				],
			},
			{
				label: "Window",
				submenu: [
					{ role: "minimize" },
					{ role: "zoom" },
					{ type: "separator" },
					{ role: "front" },
					{ type: "separator" },
					{
						label: "Toggle Developer Tools",
						accelerator: "Alt+Command+I",
						click: (_item, window) => {
							const target = window instanceof BrowserWindow ? window : BrowserWindow.getAllWindows()[0];
							target?.webContents.toggleDevTools();
						},
					},
				],
			},
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	}

	/** A system banner. A platform that refuses it is logged, never rerouted into the in-app tray. */
	private _notify(message: { readonly title: string; readonly body: string; readonly subtitle?: string; readonly session?: string }): void {
		const { title, body, subtitle, session } = message;
		if (!Notification.isSupported()) {
			console.warn("system notifications are not supported; dropped:", title);
			return;
		}
		const notification = new Notification({ title, body, ...(subtitle === undefined ? {} : { subtitle }) });
		notification.on("click", () => {
			if (session !== undefined) this._reveal(session);
		});
		notification.on("failed", (_event, error) => {
			console.error(`system notification refused (${error}):`, title);
		});
		notification.show();
	}

	/** A click on a banner brings the window forward and switches to the session the banner was about. */
	private _reveal(session: string): void {
		for (const sender of this._windows) {
			if (sender.isDestroyed()) continue;
			const window = BrowserWindow.fromWebContents(sender);
			if (!window) continue;
			if (window.isMinimized()) window.restore();
			window.show();
			window.focus();
			break;
		}
		void this._backend.selection.select(session);
	}

	private async _notifyRunEnd(session: string, error?: string): Promise<void> {
		try {
			const row = await this._backend.sessions.get(session).row();
			const spoken = row.lastMessageKind === "assistant" || row.lastMessageKind === "send_message" ? (row.lastMessage ?? "") : "";
			const body = error || spoken || "Click to view the conversation";
			this._notify({ title: `${session} · ${error ? "run ended with an error" : "finished"}`, body: body.slice(0, 140), session });
		} catch (failure) {
			console.error("run-end notification failed:", failure);
		}
	}

	private async _read(params: Params<"read">): Promise<Result<"read">> {
		const session = await this._backend.sessions.ensure(params.session);
		const readAt = (await session.row()).lastMessageAt ?? Date.now();
		await session.markRead(readAt);
		return { readAt };
	}

	private async _select(params: Params<"select">): Promise<Result<"select">> {
		return { selected: await this._backend.selection.select(params.session) };
	}

	private async _invoke(params: Params<"invoke">, sender: WebContents): Promise<Result<"invoke">> {
		try {
			const context = {
				dialog: this._dialogFor(sender),
				sessions: this._backend.sessions,
				...(params.session ? { session: await this._backend.sessions.ensure(params.session) } : {}),
				...(params.args === undefined ? {} : { args: params.args }),
			};
			if (!params.confirmed) {
				const confirm = await this._backend.actions.confirm(params.action, context);
				if (confirm) return { ok: true, confirm };
			}
			const outcome = await this._backend.actions.run(params.action, context);
			if (outcome && "kind" in outcome) return { ok: true, command: outcome };
			if (outcome && "data" in outcome) return { ok: true, data: outcome.data };
			return { ok: true };
		} catch (error) {
			return { ok: false, error: reason(error) };
		}
	}

	private async _answer(params: Params<"answer">): Promise<Result<"answer">> {
		this._settle(params.id, params.value);
		return {};
	}

	private async _slots(params: Params<"slots">): Promise<Result<"slots">> {
		const session = params.session ? this._backend.sessions.get(params.session) : null;
		return { items: await this._backend.sessions.slots(params.point, session) };
	}

	private async _welcome(): Promise<Result<"welcome">> {
		return { items: this._ordered<WelcomeItem>(WELCOME_ITEMS_POINT) };
	}

	private async _contributions(params: Params<"contributions">): Promise<Result<"contributions">> {
		const point = this._backend.contributions.get<ContributionItem>(params.point);
		const items = point.all().map((item) => ({
			id: item.id,
			title: item.title,
			...(item.icon ? { icon: item.icon } : {}),
			...(item.action ? { action: item.action } : {}),
			...(item.order === undefined ? {} : { order: item.order }),
		}));
		return { items: items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)) };
	}

	private async _pickDirectory(params: Params<"pickDirectory">, sender: WebContents): Promise<Result<"pickDirectory">> {
		const window = BrowserWindow.fromWebContents(sender);
		const options: OpenDialogOptions = {
			properties: ["openDirectory"],
			...(params.startingFolder ? { defaultPath: params.startingFolder } : {}),
		};
		const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
		const path = result.filePaths[0];
		return result.canceled || path === undefined ? {} : { path };
	}

	private async _layout(): Promise<Result<"layout">> {
		return this._backend.layout.state();
	}

	private async _layoutSet(params: Params<"layoutSet">): Promise<Result<"layoutSet">> {
		return this._backend.layout.setLayout(params.layout);
	}
}
