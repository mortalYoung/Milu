import { createStore } from "zustand/vanilla";
import type { Dock } from "./dock";
import { type ListMode, type ShellLayout, shellLayout } from "./shell-layout";

const LIST_KEY = "chatlist.collapsed";

/**
 * 侧栏的状态：偏好（持久）、手动换回的浮层（临时）、量到的行宽，外加一个给外壳看的有效形态。
 * 宽度规则只在这里读一次 —— App 看形态，ChatView 看整张表。
 */
export function createShell(options: { dock: () => Dock }) {
	const store = createStore<{ row: number; listOpen: boolean; listOverride: boolean; listMode: ListMode }>()(() => ({
		row: 0,
		listOpen: localStorage.getItem(LIST_KEY) !== "1",
		listOverride: false,
		listMode: "collapsed",
	}));

	function layoutAt(row: number): ShellLayout {
		const { listOpen, listOverride } = store.getState();
		const dock = options.dock();
		const dockState = dock.store.getState();
		const panel = dock.panel();
		return shellLayout({
			row,
			listWidth: dockState.listWidth,
			listOpen,
			listOverride,
			dockOpen: panel === "explorer" || panel === "git",
			dockWidth: dockState.dockWidth,
		});
	}

	const layout = () => layoutAt(store.getState().row);

	function setRow(row: number) {
		if (store.getState().row === row) return;
		store.setState({ row });
	}

	/** 形态给外壳读（macOS 的红绿灯那块要不要跟画布走）—— 只在真的变了的时候写 */
	function publishListMode(mode: ListMode) {
		if (store.getState().listMode !== mode) store.setState({ listMode: mode });
	}

	/* 看不见 ⇒ 要它出来；看得见 ⇒ 收起来。装不下时「要出来」的形态是浮层，不是另一种偏好。
	   浮层一次只留一个：列表要浮起来，就先让浮着的 dock 让位（反过来是 dock 的 onOpen 管的）。 */
	function toggleList() {
		const before = layout();
		const listOpen = before.list.mode === "collapsed";
		if (listOpen && before.dock.mode === "overlay") options.dock().close();
		localStorage.setItem(LIST_KEY, listOpen ? "0" : "1");
		store.setState({ listOpen, listOverride: listOpen });
	}

	/** 选了信、或别处关了：只撤浮层，不动偏好 —— 窗口还是窄的话它自然回到收起 */
	function dismissListOverlay() {
		if (store.getState().listOverride) store.setState({ listOverride: false });
	}

	return { store, layout, setRow, publishListMode, toggleList, dismissListOverlay };
}

export type Shell = ReturnType<typeof createShell>;
