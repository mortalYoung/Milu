import { createServiceId, type Service } from "@milu/di";
import type { SlotItem } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import { type ColumnsService, IColumnsService } from "./columns.ts";
import { type SelectionService, ISelectionService } from "./selection.ts";
import { type SlotsService, ISlotsService } from "./slots.ts";

export const DOCK_VIEWS_POINT = "dock.views";

const VISIBLE_KEY = "milu.dock.visible";
const ACTIVE_KEY = "milu.dock.active";
const NO_VIEWS: readonly SlotItem[] = [];

export interface DockTab {
	readonly key: string;
	readonly title: string;
	readonly icon?: string;
	readonly component: string;
	readonly data?: unknown;
	readonly pinned: boolean;
}

export interface DockState {
	readonly visible: boolean;
	readonly active: string | null;
	readonly opened: readonly DockTab[];
}

export function dockTabs(views: readonly SlotItem[], opened: readonly DockTab[]): readonly DockTab[] {
	return [
		...views.map((item) => ({
			key: item.id,
			title: item.title ?? item.id,
			...(item.icon === undefined ? {} : { icon: item.icon }),
			component: item.component,
			...(item.data === undefined ? {} : { data: item.data }),
			pinned: true,
		})),
		...opened,
	];
}

export class DockService implements Service {
	readonly store = createStore<DockState>()(() => ({
		visible: localStorage.getItem(VISIBLE_KEY) === "1",
		active: localStorage.getItem(ACTIVE_KEY),
		opened: [],
	}));

	private readonly _disposables: { dispose(): void }[] = [];
	private _dockMode: string | null = null;

	constructor(
		@ISlotsService private readonly _slots: SlotsService,
		@ISelectionService private readonly _selection: SelectionService,
		@IColumnsService private readonly _columns: ColumnsService,
	) {}

	initialize(): void {
		const stopSelection = this._selection.store.subscribe(() => {
			this.closeAll();
			void this._slots.load(DOCK_VIEWS_POINT, this._session()).catch(() => undefined);
		});
		const stopSlots = this._slots.store.subscribe(() => this.sync());
		const stopColumns = this._columns.store.subscribe(() => {
			const mode = this._columns.store.getState().columns.dock.mode;
			const previous = this._dockMode;
			this._dockMode = mode;
			if (previous === "flow" && mode === "overlay" && this.store.getState().visible) this.toggle();
		});
		this._dockMode = this._columns.store.getState().columns.dock.mode;
		this._disposables.push({ dispose: stopSelection }, { dispose: stopSlots }, { dispose: stopColumns });
		this.sync();
	}

	views(): readonly SlotItem[] {
		return this._slots.store.getState().points[DOCK_VIEWS_POINT] ?? NO_VIEWS;
	}

	tabs(): readonly DockTab[] {
		return dockTabs(this.views(), this.store.getState().opened);
	}

	toggle(): void {
		const state = this.store.getState();
		this.store.setState({ ...state, visible: !state.visible }, true);
		this.sync();
	}

	toggleView(key: string): void {
		const state = this.store.getState();
		if (state.visible && state.active === key) {
			this.toggle();
			return;
		}
		if (this.tabs().some((tab) => tab.key === key)) {
			this.select(key);
			return;
		}
		void this.refresh().then(() => {
			if (this.tabs().some((tab) => tab.key === key)) this.select(key);
		});
	}

	async refresh(): Promise<void> {
		await this._slots.load(DOCK_VIEWS_POINT, this._session()).catch(() => undefined);
		this.sync();
	}

	select(key: string): void {
		const state = this.store.getState();
		if (state.active === key && state.visible) return;
		this.store.setState({ ...state, active: key, visible: true }, true);
		this.sync();
	}

	open(tab: Omit<DockTab, "pinned">): void {
		const state = this.store.getState();
		const known = state.opened.some((each) => each.key === tab.key);
		this.store.setState({ ...state, opened: known ? state.opened : [...state.opened, { ...tab, pinned: false }], active: tab.key, visible: true }, true);
		this.sync();
	}

	close(key: string): void {
		const state = this.store.getState();
		if (!state.opened.some((each) => each.key === key)) return;
		this.store.setState({ ...state, opened: state.opened.filter((each) => each.key !== key) }, true);
		this.sync();
	}

	closeAll(): void {
		const state = this.store.getState();
		if (state.opened.length === 0) return;
		this.store.setState({ ...state, opened: [] }, true);
		this.sync();
	}

	sync(): void {
		const state = this.store.getState();
		const tabs = this.tabs();
		const active = tabs.some((tab) => tab.key === state.active) ? state.active : (tabs[0]?.key ?? null);
		if (active !== state.active) this.store.setState({ ...state, active }, true);
		localStorage.setItem(ACTIVE_KEY, active ?? "");
		localStorage.setItem(VISIBLE_KEY, state.visible ? "1" : "0");
		this._columns.setDockAvailable(tabs.length > 0 && state.visible);
	}

	dispose(): void {
		for (const disposable of this._disposables) disposable.dispose();
		this._disposables.length = 0;
		this.store.setState({ visible: true, active: null, opened: [] }, true);
	}

	private _session(): string | undefined {
		const selected = this._selection.store.getState().selected;
		return selected === "" ? undefined : selected;
	}
}

export const IDockService = createServiceId<DockService>("DockService");
