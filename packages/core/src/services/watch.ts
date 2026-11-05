import { watch, type FSWatcher } from "node:fs";

import { createServiceId, Emitter, type Event, type Service } from "@milu/di";

const DEBOUNCE_MS = 120;

interface Entry {
	readonly watcher: FSWatcher;
	timer: NodeJS.Timeout | null;
}

export class WatchService implements Service {
	readonly onChange: Event<string>;

	private readonly _emitter = new Emitter<string>();
	private readonly _entries = new Map<string, Entry>();

	constructor() {
		this.onChange = this._emitter.event;
	}

	watch(path: string): { dispose(): void } {
		const existing = this._entries.get(path);
		if (existing !== undefined) return { dispose: () => this._close(path) };
		let watcher: FSWatcher;
		try {
			watcher = watch(path);
		} catch {
			return { dispose: () => undefined };
		}
		const entry: Entry = { watcher, timer: null };
		const fire = () => {
			if (entry.timer !== null) clearTimeout(entry.timer);
			entry.timer = setTimeout(() => {
				entry.timer = null;
				this._emitter.fire(path);
			}, DEBOUNCE_MS);
		};
		watcher.on("change", fire);
		watcher.on("rename", fire);
		watcher.on("error", () => this._close(path));
		this._entries.set(path, entry);
		return { dispose: () => this._close(path) };
	}

	dispose(): void {
		for (const path of this._entries.keys()) this._close(path);
		this._emitter.dispose();
	}

	private _close(path: string): void {
		const entry = this._entries.get(path);
		if (entry === undefined) return;
		if (entry.timer !== null) clearTimeout(entry.timer);
		entry.watcher.close();
		this._entries.delete(path);
	}
}

export const IWatchService = createServiceId<WatchService>("WatchService");
