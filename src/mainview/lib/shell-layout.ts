import { DOCK_DETAIL_MIN, DOCK_MIN, LIST_MAX, LIST_MIN, PANE_MIN, WORKBENCH_MIN } from "./dock";
import { clampPaneWidth, GRIP_WIDTH } from "./grip";

export type ListMode = "flow" | "collapsed" | "overlay";
export type DockMode = "flow" | "overlay" | "closed";

export interface ShellLayout {
	list: { mode: ListMode; width: number };
	dock: { mode: DockMode; width: number; pane: boolean };
	/** 工作台这一列能拿到的宽（一行最多这么宽；度量由 CSS 的 --transcript-measure 再封顶） */
	workbench: number;
}

/** 一个区「在流里」要占的宽：自己的宽 + 它右边那条 grip */
const inFlow = (width: number) => (width > 0 ? width + GRIP_WIDTH : 0);

/** 列表和详情两瓣并排装得下吗；装不下时列表让位，由详情占满这一列 */
const fitsPane = (width: number) => width >= PANE_MIN + DOCK_DETAIL_MIN;

/**
 * 宽度规则的唯一出处。
 *
 * 工作台是主人（地板 WORKBENCH_MIN）。窗口变窄时按固定顺序让路：
 * 1. 先吃工作台的余量（它高于地板的部分）；
 * 2. 再削列表 240 → LIST_MIN，再削 dock 560 → DOCK_MIN；
 * 3. 都到底还放不下 ⇒ 先让 dock 离场，再让列表离场（腾出的空间从大到小）；
 *    离场就是关掉，用户当场再打开时才是浮层 —— 浮层不占宽，它盖在工作台上。
 * 所以在流里的每个区都只是"被挤到自己为止"，谁也不把邻居偷改掉。
 */
export function shellLayout(input: { row: number; listWidth: number; listOpen: boolean; listOverride: boolean; dockOpen: boolean; dockWidth: number }): ShellLayout {
	const row = input.row;
	const listPref = clampPaneWidth(input.listWidth, LIST_MIN, LIST_MAX);
	const dockPref = Math.max(DOCK_MIN, input.dockWidth);
	// 还没量到行宽（首帧／pane 未在屏上）：按目标宽度摊开，别让任何一列先闪一下浮层
	if (row <= 0) {
		return {
			list: { mode: input.listOpen ? "flow" : "collapsed", width: listPref },
			dock: { mode: input.dockOpen ? "flow" : "closed", width: dockPref, pane: fitsPane(dockPref) },
			workbench: 0,
		};
	}

	/* 一列能不能在流里，看的是「另一列的最小 + 它自己的最小 + 工作台地板」。
	   让路顺序：先吃工作台的余量，再削列表到 LIST_MIN，再削 dock 到 DOCK_MIN；
	   都削到底还放不下，就先让 dock 离场（腾出的空间最大），再让列表离场。
	   离场是「关掉」，用户当场再打开时才是浮层。 */
	const listCanFlow = input.listOpen && row >= LIST_MIN + GRIP_WIDTH + WORKBENCH_MIN;
	const dockCanFlow = input.dockOpen && row >= DOCK_MIN + GRIP_WIDTH + WORKBENCH_MIN + (listCanFlow ? LIST_MIN + GRIP_WIDTH : 0);

	/* 在流里的两列先按偏好摆，工作台的余量天然排在第一位；不够就按上面的顺序削。
	   账按「用户打开着的区」算：dock 浮在屏上时也照它的最小宽占着账 —— 所以窗口还窄着的时候
	   列表一直保持紧凑形态，dock 一离场，腾出来的地方整块归工作台，不会跳回来又把列表撑开。 */
	const workbenchWith = (list: number, dock: number) => row - inFlow(list) - inFlow(dock);
	const squeeze = (list: number, dock: number) => {
		let l = list;
		let d = dock;
		// 不在流里的那一列（0）不参与，别把它"削"出来
		if (l > 0 && workbenchWith(l, d) < WORKBENCH_MIN) l = Math.max(LIST_MIN, l - (WORKBENCH_MIN - workbenchWith(l, d)));
		if (d > 0 && workbenchWith(l, d) < WORKBENCH_MIN) d = Math.max(DOCK_MIN, d - (WORKBENCH_MIN - workbenchWith(l, d)));
		return { list: l, dock: d };
	};
	const placed = squeeze(input.listOpen ? listPref : 0, input.dockOpen ? dockPref : 0);

	const listMode: ListMode = !input.listOpen ? "collapsed" : listCanFlow ? "flow" : input.listOverride ? "overlay" : "collapsed";
	const dockMode: DockMode = !input.dockOpen ? "closed" : dockCanFlow ? "flow" : "overlay";
	const list = listMode === "flow" ? placed.list : 0;
	const dock = dockMode === "flow" ? placed.dock : 0;

	/* 只有「在流里」的列吃宽；浮层一点都不占 —— 它盖在工作台上。
	   盖完工作台剩不到地板，就把这一块整个盖住：窄窗里一次只读一面，不留一条缝。 */
	const workbench = Math.max(WORKBENCH_MIN, workbenchWith(list, dock));
	const sheet = (own: number, floor: number) => {
		const width = Math.min(own, Math.max(floor, workbench - GRIP_WIDTH));
		return width + WORKBENCH_MIN > workbench ? workbench : width;
	};

	return {
		list: { mode: listMode, width: listMode === "overlay" ? sheet(listPref, LIST_MIN) : listMode === "flow" ? placed.list : listPref },
		dock: {
			mode: dockMode,
			width: dockMode === "overlay" ? sheet(dockPref, DOCK_MIN) : dockMode === "flow" ? placed.dock : dockPref,
			pane: fitsPane(dockMode === "flow" ? placed.dock : dockPref),
		},
		workbench,
	};
}
