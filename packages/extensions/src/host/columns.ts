import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

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

export interface ColumnsState {
	readonly columns: Columns;
	readonly row: number;
	readonly listOpen: boolean;
	readonly listOverride: boolean;
	readonly listWidth: number;
	readonly dockWidth: number;
	readonly dockOpen: boolean;
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

function initial(): ColumnsState {
	const listOpen = localStorage.getItem(LIST_OPEN_KEY) !== "0";
	const listWidth = stored(LIST_WIDTH_KEY, LIST_DEFAULT, LIST_MIN, LIST_MAX);
	const dockWidth = stored(DOCK_WIDTH_KEY, DOCK_DEFAULT, DOCK_MIN, Number.POSITIVE_INFINITY);
	return {
		columns: shellLayout({ row: 0, listWidth, listOpen, listOverride: false, dockOpen: false, dockWidth }),
		row: 0,
		listOpen,
		listOverride: false,
		listWidth,
		dockWidth,
		dockOpen: false,
	};
}

export class ColumnsService implements Service {
	readonly store = createStore<ColumnsState>()(initial);

	initialize(): void {
		this._apply();
	}

	setRow(row: number): void {
		const state = this.store.getState();
		if (row === state.row) return;
		this.store.setState((current) => ({ ...current, row }), true);
		if (state.listOverride) {
			const next = shellLayout({ row, listWidth: state.listWidth, listOpen: true, listOverride: false, dockOpen: state.dockOpen, dockWidth: state.dockWidth });
			if (next.list.mode === "flow") this.store.setState((current) => ({ ...current, listOverride: false }), true);
		}
		this._apply();
	}

	setDockAvailable(open: boolean): void {
		if (open === this.store.getState().dockOpen) return;
		this.store.setState((current) => ({ ...current, dockOpen: open }), true);
		this._apply();
	}

	toggleList(): void {
		const state = this.store.getState();
		const open = state.columns.list.mode !== "collapsed";
		this.store.setState((current) => ({ ...current, listOpen: !open }), true);
		this.store.setState((current) => ({ ...current, listOverride: current.listOpen && !this._fitsList() }), true);
		this._apply();
	}

	closeList(): void {
		this.store.setState((current) => ({ ...current, listOpen: false, listOverride: false }), true);
		localStorage.setItem(LIST_OPEN_KEY, "0");
		this._apply();
	}

	setListWidth(width: number): void {
		const listWidth = clamp(width, LIST_MIN, LIST_MAX);
		this.store.setState((current) => ({ ...current, listWidth }), true);
		localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(listWidth)));
		this._apply();
	}

	resetListWidth(): number {
		this.setListWidth(LIST_DEFAULT);
		return this.store.getState().listWidth;
	}

	setDockWidth(width: number): void {
		const dockWidth = Math.max(DOCK_MIN, width);
		this.store.setState((current) => ({ ...current, dockWidth }), true);
		localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(dockWidth)));
		this._apply();
	}

	resetDockWidth(): number {
		const laid = this.store.getState().columns;
		this.setDockWidth(laid.workbench > 0 ? Math.round((laid.workbench + laid.dock.width) / 2) : DOCK_DEFAULT);
		return this.store.getState().dockWidth;
	}

	layoutFor(widths: { readonly list?: number; readonly dock?: number }): Columns {
		const state = this.store.getState();
		return shellLayout({
			row: state.row,
			listWidth: widths.list ?? state.listWidth,
			listOpen: state.listOpen,
			listOverride: state.listOverride,
			dockOpen: state.dockOpen,
			dockWidth: widths.dock ?? state.dockWidth,
		});
	}

	gripLimits(kind: "list" | "dock"): { readonly min: number; readonly max: number } {
		const state = this.store.getState();
		const laid = state.columns;
		const listFlow = laid.list.mode === "flow" ? LIST_MIN + GRIP_WIDTH : 0;
		const dockFlow = laid.dock.mode === "flow" ? DOCK_MIN + GRIP_WIDTH : 0;
		const room = state.row - GRIP_WIDTH - WORKBENCH_MIN;

		if (kind === "list") {
			const max = Math.max(LIST_MIN, laid.list.width, state.row === 0 ? LIST_MAX : Math.min(LIST_MAX, room - dockFlow));
			return { min: LIST_MIN, max };
		}
		const max = Math.max(DOCK_MIN, laid.dock.width, state.row === 0 ? laid.dock.width : room - listFlow);
		return { min: DOCK_MIN, max };
	}

	dispose(): void {}

	private _fitsList(): boolean {
		const state = this.store.getState();
		return (
			shellLayout({ row: state.row, listWidth: state.listWidth, listOpen: true, listOverride: false, dockOpen: state.dockOpen, dockWidth: state.dockWidth }).list.mode === "flow"
		);
	}

	private _apply(): void {
		const state = this.store.getState();
		localStorage.setItem(LIST_OPEN_KEY, state.listOpen ? "1" : "0");
		const columns = shellLayout({
			row: state.row,
			listWidth: state.listWidth,
			listOpen: state.listOpen,
			listOverride: state.listOverride,
			dockOpen: state.dockOpen,
			dockWidth: state.dockWidth,
		});
		this.store.setState((current) => ({ ...current, columns }), true);
	}
}

export const ColumnsServiceId = createServiceId<ColumnsService>("ColumnsService");
