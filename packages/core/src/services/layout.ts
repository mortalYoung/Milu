import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { Layout, LayoutState, SurfaceDeclaration } from "@milu/protocol";

import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";

const FILE = "ui.json";

const SURFACES: readonly SurfaceDeclaration[] = [
	{ id: "milu.session-list", slot: "sidebar", order: 10 },
	{ id: "milu.transcript", slot: "main", order: 10 },
];

function ordered(surfaces: readonly SurfaceDeclaration[]): SurfaceDeclaration[] {
	return [...surfaces].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
}

export class LayoutService implements Service {
	readonly onChange: Event<LayoutState>;

	private readonly _file: string;
	private readonly _emitter = new Emitter<LayoutState>();
	private readonly _declared = new Map<string, SurfaceDeclaration>();
	private _layout: Layout = {};

	constructor(@IConfigService private readonly _configService: ConfigService) {
		this._file = join(this._configService.root, FILE);
		this.onChange = this._emitter.event;
		for (const surface of SURFACES) this._declared.set(surface.id, surface);
	}

	async initialize(): Promise<void> {
		const saved = await this._read();
		this._layout = this._merge(saved);
		await this._write();
	}

	state(): LayoutState {
		return { surfaces: ordered([...this._declared.values()]), layout: this._layout };
	}

	declare(surface: SurfaceDeclaration): { dispose(): void } {
		if (this._declared.has(surface.id)) throw new Error(`surface "${surface.id}" is already declared`);
		this._declared.set(surface.id, surface);
		this._layout = this._merge(this._layout);
		void this._write();
		this._emitter.fire(this.state());
		return {
			dispose: () => {
				if (!this._declared.delete(surface.id)) return;
				this._layout = this._merge(this._layout);
				void this._write();
				this._emitter.fire(this.state());
			},
		};
	}

	async setLayout(layout: Layout): Promise<LayoutState> {
		const known = new Set(this._declared.keys());
		const next: Record<string, readonly string[]> = {};
		for (const [slot, ids] of Object.entries(layout)) {
			const kept = ids.filter((id) => known.has(id) && this._declared.get(id)?.slot === slot);
			if (kept.length > 0) next[slot] = kept;
		}
		this._layout = this._merge(next);
		await this._write();
		this._emitter.fire(this.state());
		return this.state();
	}

	dispose(): void {
		this._emitter.dispose();
	}

	private _merge(saved: Layout): Layout {
		const next: Record<string, string[]> = {};
		const placed = new Set<string>();

		for (const [slot, ids] of Object.entries(saved)) {
			for (const id of ids) {
				const declaration = this._declared.get(id);
				if (!declaration || declaration.slot !== slot || placed.has(id)) continue;
				(next[slot] ??= []).push(id);
				placed.add(id);
			}
		}

		for (const declaration of ordered([...this._declared.values()])) {
			if (placed.has(declaration.id)) continue;
			(next[declaration.slot] ??= []).push(declaration.id);
			placed.add(declaration.id);
		}

		return next;
	}

	private async _read(): Promise<Layout> {
		try {
			const parsed = JSON.parse(await readFile(this._file, "utf8")) as { slots?: unknown };
			if (typeof parsed.slots !== "object" || parsed.slots === null) return {};
			const layout: Record<string, readonly string[]> = {};
			for (const [slot, ids] of Object.entries(parsed.slots as Record<string, unknown>)) {
				if (!Array.isArray(ids)) continue;
				layout[slot] = ids.filter((id): id is string => typeof id === "string");
			}
			return layout;
		} catch {
			return {};
		}
	}

	private async _write(): Promise<void> {
		await mkdir(dirname(this._file), { recursive: true });
		const tmp = `${this._file}.tmp`;
		await writeFile(tmp, `${JSON.stringify({ slots: this._layout }, null, 2)}\n`, "utf8");
		await rename(tmp, this._file);
	}
}

export const ILayoutService = createServiceId<LayoutService>("LayoutService");
