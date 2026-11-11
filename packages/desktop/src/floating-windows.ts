import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WindowAnchor, WindowDescriptor, WindowHost, WindowMenuItem, WindowPlacement, WindowRef } from "@milu/core";
import { BrowserWindow, Menu, screen, type WebContents } from "electron";

interface Frame {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

interface Held {
	readonly owner: string;
	readonly id: string;
	readonly window: BrowserWindow;
	readonly movable: boolean;
	frame: Frame;
}

const MIN_SIDE = 64;
const MAX_SIDE = 512;
const INSET = 24;
const FILE = "floating.json";
const TOP_LEVEL = "screen-saver";
const DRAG_MS = 220;
const LOOK_MS = 200;
const LOOK_NEAR = 40;

export interface FloatingWindowsOptions {
	readonly root: string;
	readonly preload: string;
	readonly windows: () => readonly WindowRef[];
	readonly asset: (extension: string, root: string, file: string) => Promise<string | undefined>;
	readonly boot: () => Promise<string | undefined>;
	readonly preamble?: string;
	readonly dispatch: (action: string, args: unknown) => void;
	readonly notify: (window: string, drag: "left" | "right" | null, look: number | null) => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function keyOf(owner: string, id: string): string {
	return `${owner}:${id}`;
}

function anchorOf(anchor: WindowAnchor | undefined, width: number, height: number): { x: number; y: number } {
	const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const left = workArea.x + INSET;
	const right = workArea.x + workArea.width - width - INSET;
	const top = workArea.y + INSET;
	const bottom = workArea.y + workArea.height - height - INSET;
	if (anchor === "bottom-left") return { x: left, y: bottom };
	if (anchor === "top-right") return { x: right, y: top };
	if (anchor === "top-left") return { x: left, y: top };
	if (anchor === "center") return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 2) };
	return { x: right, y: bottom };
}

function visibleAt(frame: Frame): Frame {
	const display = screen.getDisplayMatching({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
	const { workArea } = display;
	return {
		x: clamp(frame.x, workArea.x, workArea.x + workArea.width - frame.width),
		y: clamp(frame.y, workArea.y, workArea.y + workArea.height - frame.height),
		width: frame.width,
		height: frame.height,
	};
}

export class FloatingWindows implements WindowHost {
	private readonly _options: FloatingWindowsOptions;
	private readonly _held = new Map<string, Held>();
	private readonly _dragging = new Map<string, "left" | "right" | null>();
	private readonly _look = new Map<string, number | null>();
	private readonly _lastX = new Map<string, number>();
	private readonly _dragTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private _lookTimer: ReturnType<typeof setInterval> | null = null;
	private readonly _frames: Record<string, Frame>;
	private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(options: FloatingWindowsOptions) {
		this._options = options;
		this._frames = this._read();
	}

	async create(owner: string, descriptor: WindowDescriptor): Promise<WindowPlacement> {
		const declared = this._options.windows().find((each) => each.extension === owner && each.id === descriptor.window);
		if (declared === undefined) throw new Error(`window "${descriptor.window}" is not declared by "${owner}"`);
		if (declared.root === undefined) throw new Error(`window "${descriptor.window}" ships no document — "${owner}" is loaded in-process`);
		const [document, module, boot] = await Promise.all([
			this._options.asset(owner, declared.root, declared.document),
			this._options.asset(owner, declared.root, declared.module),
			this._options.boot(),
		]);
		if (document === undefined || module === undefined) throw new Error(`window "${descriptor.window}" has no servable document or module`);
		if (boot === undefined) throw new Error("this build has no window boot");

		const width = clamp(Math.round(descriptor.width), MIN_SIDE, MAX_SIDE);
		const height = clamp(Math.round(descriptor.height), MIN_SIDE, MAX_SIDE);
		const key = keyOf(owner, descriptor.id);
		await this.close(owner, descriptor.id);

		const stored = this._frames[key];
		const frame = visibleAt(stored === undefined ? { ...anchorOf(descriptor.anchor, width, height), width, height } : { ...stored, width, height });

		const window = new BrowserWindow({
			...frame,
			show: false,
			frame: false,
			resizable: false,
			transparent: true,
			hasShadow: false,
			skipTaskbar: true,
			acceptFirstMouse: true,
			fullscreenable: false,
			alwaysOnTop: true,
			webPreferences: {
				preload: this._options.preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		window.setAlwaysOnTop(true, TOP_LEVEL);
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		window.setIgnoreMouseEvents(descriptor.clickThrough !== false, { forward: true });
		if (descriptor.movable === false) window.setMovable(false);
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("console-message", (_event, level, message) => {
			if (level < 2) return;
			console.error(`[milu] window "${descriptor.id}" ${level === 3 ? "error" : "warning"}: ${message}`);
		});
		window.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`[milu] window ${descriptor.id} did not load`, code, description, url));

		const held: Held = { owner, id: descriptor.id, window, movable: descriptor.movable !== false, frame };
		this._held.set(key, held);
		window.on("moved", () => {
			this._remember(key, window);
			this._trackDrag(key, descriptor.id, window);
		});
		this._startLook();
		window.on("closed", () => {
			if (this._held.get(key)?.window === window) this._held.delete(key);
			this._cancel(key);
		});

		const query = new URLSearchParams({ extension: owner, id: descriptor.id, module, data: JSON.stringify(descriptor.data ?? null) });
		window.webContents.once("did-finish-load", () => {
			const src = `${boot}${boot.includes("?") ? "&" : "?"}${query.toString()}`;
			const steps = [
				this._options.preamble === undefined
					? null
					: `(() => { const pre = document.createElement("script"); pre.type = "module"; pre.textContent = ${JSON.stringify(this._options.preamble)}; document.head.append(pre); })();`,
				`(() => { const el = document.createElement("script"); el.type = "module"; el.src = ${JSON.stringify(src)}; document.head.append(el); })();`,
			];
			void window.webContents.executeJavaScript(steps.filter((step) => step !== null).join("\n")).catch((error: unknown) => console.error("[milu] window boot failed", error));
		});
		await window.loadURL(`${document}?${query.toString()}`);
		window.once("ready-to-show", () => window.showInactive());
		if (!window.isVisible()) window.showInactive();
		return { id: descriptor.id, ...frame };
	}

	async close(owner: string, id: string): Promise<void> {
		const key = keyOf(owner, id);
		const held = this._held.get(key);
		if (held === undefined) return;
		this._held.delete(key);
		this._cancel(key);
		this._dragging.delete(id);
		this._look.delete(id);
		this._lastX.delete(key);
		if (!held.window.isDestroyed()) held.window.close();
	}

	find(owner: string, id: string): string | undefined {
		return this._held.has(keyOf(owner, id)) ? id : undefined;
	}

	list(owner: string): readonly WindowPlacement[] {
		const out: WindowPlacement[] = [];
		for (const held of this._held.values()) if (held.owner === owner) out.push({ id: held.id, ...held.frame });
		return out;
	}

	async setClickThrough(owner: string, id: string, ignore: boolean): Promise<void> {
		const held = this._held.get(keyOf(owner, id));
		if (held === undefined || held.window.isDestroyed()) return;
		held.window.setIgnoreMouseEvents(ignore, { forward: true });
	}

	private _trackDrag(key: string, id: string, window: BrowserWindow): void {
		const [x] = window.getPosition();
		const previous = this._lastX.get(key);
		this._lastX.set(key, x);
		if (previous !== undefined && x !== previous) {
			const drag = x > previous ? "right" : "left";
			if (this._dragging.get(id) !== drag) {
				this._dragging.set(id, drag);
				this._options.notify(id, drag, this._look.get(id) ?? null);
			}
		}
		const timer = this._dragTimers.get(key);
		if (timer !== undefined) clearTimeout(timer);
		this._dragTimers.set(
			key,
			setTimeout(() => {
				this._dragTimers.delete(key);
				if ((this._dragging.get(id) ?? null) === null) return;
				this._dragging.set(id, null);
				this._options.notify(id, null, this._look.get(id) ?? null);
			}, DRAG_MS),
		);
	}

	private _startLook(): void {
		if (this._lookTimer !== null) return;
		this._lookTimer = setInterval(() => this._pollLook(), LOOK_MS);
	}

	private _pollLook(): void {
		if (this._held.size === 0) {
			if (this._lookTimer !== null) {
				clearInterval(this._lookTimer);
				this._lookTimer = null;
			}
			return;
		}
		const point = screen.getCursorScreenPoint();
		for (const held of this._held.values()) {
			if (held.window.isDestroyed()) continue;
			const [x, y] = held.window.getPosition();
			const [width, height] = held.window.getSize();
			const dx = point.x - (x + width / 2);
			const dy = point.y - (y + height / 2);
			const look = Math.hypot(dx, dy) < LOOK_NEAR ? null : Math.round((((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) / 1);
			if (this._look.get(held.id) === look) continue;
			this._look.set(held.id, look);
			this._options.notify(held.id, this._dragging.get(held.id) ?? null, look);
		}
	}

	async menu(owner: string, id: string, items: readonly WindowMenuItem[]): Promise<void> {
		const held = this._held.get(keyOf(owner, id));
		if (held === undefined || held.window.isDestroyed()) throw new Error(`window "${id}" is not open`);
		const dispatch = this._options.dispatch;
		const template = items.map((item) =>
			item.type === "separator"
				? { type: "separator" as const }
				: {
						label: item.label ?? "",
						...(item.type === "checkbox" ? { type: "checkbox" as const, checked: item.checked === true } : {}),
						click: () => {
							if (item.action !== undefined) dispatch(item.action, item.args);
						},
					},
		);
		Menu.buildFromTemplate(template).popup({ window: held.window });
	}

	async move(owner: string, id: string, x: number, y: number): Promise<void> {
		const held = this._held.get(keyOf(owner, id));
		if (held === undefined || held.window.isDestroyed()) return;
		held.window.setPosition(Math.round(x), Math.round(y));
	}

	moveBy(sender: WebContents, dx: number, dy: number): void {
		for (const held of this._held.values()) {
			if (held.window.webContents !== sender || held.window.isDestroyed()) continue;
			if (!held.movable) return;
			const [x, y] = held.window.getPosition();
			held.window.setPosition(Math.round(x + dx), Math.round(y + dy));
			return;
		}
	}

	dispose(): void {
		for (const key of Array.from(this._held.keys())) {
			const held = this._held.get(key);
			if (held !== undefined && !held.window.isDestroyed()) held.window.destroy();
		}
		this._held.clear();
		for (const timer of this._timers.values()) clearTimeout(timer);
		this._timers.clear();
	}

	private _remember(key: string, window: BrowserWindow): void {
		const held = this._held.get(key);
		if (held === undefined || window.isDestroyed()) return;
		this._cancel(key);
		this._timers.set(
			key,
			setTimeout(() => {
				this._timers.delete(key);
				if (window.isDestroyed()) return;
				const [x, y] = window.getPosition();
				const [width, height] = window.getSize();
				held.frame = { x, y, width, height };
				this._frames[key] = held.frame;
				this._write();
			}, 400),
		);
	}

	private _cancel(key: string): void {
		const timer = this._timers.get(key);
		if (timer !== undefined) clearTimeout(timer);
		this._timers.delete(key);
	}

	private _path(): string {
		return join(this._options.root, FILE);
	}

	private _read(): Record<string, Frame> {
		try {
			const value: unknown = JSON.parse(readFileSync(this._path(), "utf8"));
			if (typeof value !== "object" || value === null) return {};
			const out: Record<string, Frame> = {};
			for (const [key, frame] of Object.entries(value as Record<string, unknown>)) {
				if (typeof frame !== "object" || frame === null) continue;
				const each = frame as Record<string, unknown>;
				const numbers = [each["x"], each["y"], each["width"], each["height"]];
				if (!numbers.every((part) => typeof part === "number" && Number.isFinite(part))) continue;
				out[key] = { x: each["x"] as number, y: each["y"] as number, width: each["width"] as number, height: each["height"] as number };
			}
			return out;
		} catch {
			return {};
		}
	}

	private _write(): void {
		try {
			mkdirSync(this._options.root, { recursive: true });
			writeFileSync(this._path(), `${JSON.stringify(this._frames, null, "\t")}\n`);
		} catch (error) {
			console.error("[milu] floating window state write failed", error);
		}
	}
}
