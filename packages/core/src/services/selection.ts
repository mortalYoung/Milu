import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createServiceId, Emitter, type Event, type Service } from "@milu/di";

import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";
import { ISessionService } from "./sessions.ts";
import type { SessionService } from "./sessions.ts";

interface SelectionRecord {
	readonly selected: string | null;
}

export class SelectionService implements Service {
	readonly onChange: Event<string | null>;

	private readonly _emitter = new Emitter<string | null>();
	private readonly _file: string;
	private _selected: string | null = null;

	constructor(
		@ISessionService private readonly _sessionService: SessionService,
		@IConfigService private readonly _configService: ConfigService,
	) {
		this.onChange = this._emitter.event;
		this._file = join(this._configService.root, "selection.json");
	}

	async initialize(): Promise<void> {
		const saved = await this._read();
		if (saved === undefined || saved === null) return;
		this._selected = (await this._sessionService.names()).includes(saved) ? saved : null;
	}

	get selected(): string | null {
		return this._selected;
	}

	async reconcile(names: readonly string[]): Promise<void> {
		if (this._selected === null || names.includes(this._selected)) return;
		this._selected = null;
		await this._write(null);
		this._emitter.fire(null);
	}

	async select(name: string | null): Promise<string | null> {
		if (name !== null) {
			const session = await this._sessionService.ensure(name);
			await session.markRead(Date.now());
		}
		this._selected = name;
		await this._write(name);
		this._emitter.fire(name);
		return name;
	}

	dispose(): void {
		this._emitter.dispose();
	}

	private async _read(): Promise<string | null | undefined> {
		try {
			const parsed = JSON.parse(await readFile(this._file, "utf8")) as { selected?: unknown };
			return typeof parsed.selected === "string" ? parsed.selected : null;
		} catch {
			return undefined;
		}
	}

	private async _write(selected: string | null): Promise<void> {
		const record: SelectionRecord = { selected };
		await writeFile(this._file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	}
}

export const ISelectionService = createServiceId<SelectionService>("SelectionService");
