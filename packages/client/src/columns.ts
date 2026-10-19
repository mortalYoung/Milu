import { createServiceId, type Service } from "@milu/di";

import { Store } from "./store.ts";

export const GRIP_WIDTH = 7;
export const LIST_MIN = 200;
export const LIST_MAX = 480;
export const LIST_DEFAULT = 240;
export const DOCK_MIN = 360;
export const DOCK_DEFAULT = 560;
export const WORKBENCH_MIN = 420;

export type ListMode = "flow" | "collapsed" | "overlay";
export type DockMode = "flow" | "overlay" | "closed";

export interface Columns {
	readonly list: { readonly mode: ListMode; readonly width: number };
	readonly dock: { readonly mode: DockMode; readonly width: number };
	readonly workbench: number;
}

const LIST_WIDTH_KEY = "milu.layout.list";
const LIST_OPEN_KEY = "milu.layout.listOpen";
const DOCK_WIDTH_KEY = "milu.layout.dock";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function stored(key: string, fallback: number, min: number, max: number): number {
	const value = Number(localStorage.getItem(key));
	return Number.isFinite(value) && value > 0 ? clamp(value, min, max) : fallback;
}

const inFlow = (width: number) => (width > 0 ? width + GRIP_WIDTH : 0);

export function shellLayout(input: { row: number; listWidth: number; listOpen: boolean; listOverride: boolean; dockOpen: boolean; dockWidth: number }): Columns {
	const row = input.row;
	const listPref = clamp(input.listWidth, LIST_MIN, LIST_MAX);
	const dockPref = Math.max(DOCK_MIN, input.dockWidth);

	if (row <= 0) {
		return {
			list: { mode: input.listOpen ? "flow" : "collapsed", width: listPref },
			dock: { mode: input.dockOpen ? "flow" : "closed", width: dockPref },
			workbench: 0,
		};
	}

	const listCanFlow = input.listOpen && row >= LIST_MIN + GRIP_WIDTH + WORKBENCH_MIN;
	const dockCanFlow = input.dockOpen && row >= DOCK_MIN + GRIP_WIDTH + WORKBENCH_MIN + (listCanFlow ? LIST_MIN + GRIP_WIDTH : 0);

	const workbenchWith = (list: number, dock: number) => row - inFlow(list) - inFlow(dock);
	const squeeze = (list: number, dock: number) => {
		let l = list;
		let d = dock;
		if (l > 0 && workbenchWith(l, d) < WORKBENCH_MIN) l = Math.max(LIST_MIN, l - (WORKBENCH_MIN - workbenchWith(l, d)));
		if (d > 0 && workbenchWith(l, d) < WORKBENCH_MIN) d = Math.max(DOCK_MIN, d - (WORKBENCH_MIN - workbenchWith(l, d)));
		return { list: l, dock: d };
	};
	const placed = squeeze(input.listOpen ? listPref : 0, input.dockOpen ? dockPref : 0);

	const listMode: ListMode = !input.listOpen ? "collapsed" : listCanFlow ? "flow" : input.listOverride ? "overlay" : "collapsed";
	const dockMode: DockMode = !input.dockOpen ? "closed" : dockCanFlow ? "flow" : "overlay";
	const list = listMode === "flow" ? placed.list : 0;
	const dock = dockMode === "flow" ? placed.dock : 0;
	const workbench = Math.max(WORKBENCH_MIN, workbenchWith(list, dock));
	const sheet = (own: number, floor: number) => {
		const width = Math.min(own, Math.max(floor, workbench - GRIP_WIDTH));
		return width + WORKBENCH_MIN > workbench ? workbench : width;
	};

	return {
		list: { mode: listMode, width: listMode === "overlay" ? sheet(listPref, LIST_MIN) : listMode === "flow" ? placed.list : listPref },
		dock: { mode: dockMode, width: dockMode === "overlay" ? sheet(dockPref, DOCK_MIN) : dockMode === "flow" ? placed.dock : dockPref },
		workbench,
	};
}

export class ColumnsService implements Service {
	readonly state = new Store<Columns>({ list: { mode: "flow", width: LIST_DEFAULT }, dock: { mode: "closed", width: DOCK_DEFAULT }, workbench: 0 });

	private _row = 0;
	private _listOpen = localStorage.getItem(LIST_OPEN_KEY) !== "0";
	private _listOverride = false;
	private _listWidth = stored(LIST_WIDTH_KEY, LIST_DEFAULT, LIST_MIN, LIST_MAX);
	private _dockWidth = stored(DOCK_WIDTH_KEY, DOCK_DEFAULT, DOCK_MIN, Number.POSITIVE_INFINITY);
	private _dockOpen = false;

	initialize(): void {
		this._apply();
	}

	setRow(row: number): void {
		if (row === this._row) return;
		this._row = row;
		if (!this._listOverride) {
			this._apply();
			return;
		}
		const next = shellLayout({ row, listWidth: this._listWidth, listOpen: true, listOverride: false, dockOpen: this._dockOpen, dockWidth: this._dockWidth });
		if (next.list.mode === "flow") this._listOverride = false;
		this._apply();
	}

	setDockAvailable(open: boolean): void {
		if (open === this._dockOpen) return;
		this._dockOpen = open;
		this._apply();
	}

	toggleList(): void {
		if (this.state.get().list.mode === "collapsed") this._listOpen = true;
		else this._listOpen = false;
		this._listOverride = this._listOpen && !this._fitsList();
		this._apply();
	}

	closeList(): void {
		this._listOpen = false;
		this._listOverride = false;
		localStorage.setItem(LIST_OPEN_KEY, "0");
		this._apply();
	}

	setListWidth(width: number): void {
		this._listWidth = clamp(width, LIST_MIN, LIST_MAX);
		localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(this._listWidth)));
		this._apply();
	}

	resetListWidth(): number {
		this.setListWidth(LIST_DEFAULT);
		return this._listWidth;
	}

	setDockWidth(width: number): void {
		this._dockWidth = Math.max(DOCK_MIN, width);
		localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(this._dockWidth)));
		this._apply();
	}

	resetDockWidth(): number {
		const laid = this.state.get();
		this.setDockWidth(laid.workbench > 0 ? Math.round((laid.workbench + laid.dock.width) / 2) : DOCK_DEFAULT);
		return this._dockWidth;
	}

	layoutFor(widths: { readonly list?: number; readonly dock?: number }): Columns {
		return shellLayout({
			row: this._row,
			listWidth: widths.list ?? this._listWidth,
			listOpen: this._listOpen,
			listOverride: this._listOverride,
			dockOpen: this._dockOpen,
			dockWidth: widths.dock ?? this._dockWidth,
		});
	}

	gripLimits(kind: "list" | "dock"): { readonly min: number; readonly max: number } {
		const laid = this.state.get();
		const listFlow = laid.list.mode === "flow" ? LIST_MIN + GRIP_WIDTH : 0;
		const dockFlow = laid.dock.mode === "flow" ? DOCK_MIN + GRIP_WIDTH : 0;
		const room = this._row - GRIP_WIDTH - WORKBENCH_MIN;

		if (kind === "list") {
			const max = Math.max(LIST_MIN, laid.list.width, this._row === 0 ? LIST_MAX : Math.min(LIST_MAX, room - dockFlow));
			return { min: LIST_MIN, max };
		}
		const max = Math.max(DOCK_MIN, laid.dock.width, this._row === 0 ? laid.dock.width : room - listFlow);
		return { min: DOCK_MIN, max };
	}

	dispose(): void {
		this.state.dispose();
	}

	private _fitsList(): boolean {
		return (
			shellLayout({ row: this._row, listWidth: this._listWidth, listOpen: true, listOverride: false, dockOpen: this._dockOpen, dockWidth: this._dockWidth }).list.mode === "flow"
		);
	}

	private _apply(): void {
		localStorage.setItem(LIST_OPEN_KEY, this._listOpen ? "1" : "0");
		this.state.set(
			shellLayout({
				row: this._row,
				listWidth: this._listWidth,
				listOpen: this._listOpen,
				listOverride: this._listOverride,
				dockOpen: this._dockOpen,
				dockWidth: this._dockWidth,
			}),
		);
	}
}

export const ColumnsServiceId = createServiceId<ColumnsService>("ColumnsService");
