import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { registerSurfaceRoot } from "../lib/active-surface";
import { DOCK_EXIT_MS, usePresence } from "../lib/presence";
import type { SurfaceId } from "../lib/surfaces";
import { isInteractive } from "../lib/utils";

export interface DockListControls {
	open: boolean;
	/** 这一列还放得下列表吗（放不下时给不出开关 —— 收了也没地方再摊开） */
	fits: boolean;
	toggle: () => void;
}

/** 列表的开关：家在列表自己的 head 上；列表收起后它改住在内容 head 的左端（和侧栏那个按钮同一个写法）。 */
export function DockListToggle(props: { open: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="dock-btn"
			aria-expanded={props.open}
			aria-label={props.open ? "Collapse the list" : "Show the list"}
			title={props.open ? "Collapse the list" : "Show the list"}
			onClick={props.onToggle}
		>
			{props.open ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
		</button>
	);
}

export function DockShell(props: {
	panelId: string;
	open: boolean;
	/** flow = 在流里的一列（自己的宽，可拖）；overlay = 贴边浮层（不推挤信纸，一次只给一面） */
	mode: "flow" | "overlay";
	/** 这一列装得下「列表 + 详情」两瓣吗；装不下列表就让位 */
	pane: boolean;
	width: number;
	paneWidth: number;
	listTitle: string;
	listOpen: boolean;
	onToggleList: () => void;
	class?: string;
	detail?: { open: boolean; render: (leaving: boolean, list: DockListControls) => ReactNode };
	children: ReactNode;
	surface?: SurfaceId;
}) {
	/* 换面板时，旧那一列还在（150ms 交叉淡出）：此时新列不去动画自己的宽度，
	   否则两份宽度相加会让 workbench 先涨后缩。浮层没有宽度可以让，也就不参与这段。 */
	const floating = props.mode === "overlay";
	const [arriving] = useState(() => !floating && (typeof document === "undefined" || document.querySelectorAll(".dock").length === 0));
	const drawer = usePresence(props.open, DOCK_EXIT_MS);
	/* 有没有可以让位的详情，决定列表是不是这一列的全部 */
	const detailOpen = props.open && (props.detail?.open ?? false);
	const viewer = usePresence(props.open && (props.detail?.open ?? false), DOCK_EXIT_MS);
	const dockEl = useRef<HTMLDivElement>(null);
	const detachSurface = useRef<(() => void) | null>(null);

	function bindRoot(el: HTMLDivElement | null) {
		dockEl.current = el;
		detachSurface.current?.();
		detachSurface.current = el && props.surface ? registerSurfaceRoot(el, props.surface) : null;
	}

	if (!drawer.visible) return null;

	/* 在流里：列表和详情并排（装不下时列表让位）；浮层里：一次只给一面 ——
	   列表与详情轮流占满这一列，「回到列表」的开关就在详情自己的 head 上（P-71）。 */
	const faceList = !detailOpen || (floating ? props.listOpen : props.listOpen && props.pane);
	const collapsed = detailOpen && !faceList;
	const paneWidth = floating ? (faceList ? props.width : 0) : detailOpen ? (faceList ? props.paneWidth : 0) : props.width;
	/* 详情在退场时也得在屏上把淡出演完 —— 只有浮层换面才是当场换 */
	const showDetail = viewer.visible && (floating ? !props.listOpen : true);
	const list: DockListControls = { open: props.listOpen, fits: floating || props.pane, toggle: props.onToggleList };

	return (
		<div
			className={`dock${props.class ? ` ${props.class}` : ""}${floating ? " floating" : ""}${arriving ? " arriving" : ""}${drawer.leaving ? " leaving" : ""}${drawer.leaving && props.width > 0 ? " out" : ""}`}
			ref={bindRoot}
			style={{ width: `${props.width}px` }}
			tabIndex={-1}
			onClick={(event) => {
				if (isInteractive(event.target)) return;
				event.currentTarget.focus();
			}}
		>
			<div className={"dock-pane" + (collapsed ? " collapsed" : "")} style={{ width: `${paneWidth}px` }} inert={collapsed}>
				<div className="dock-list-head">
					<span className="dock-list-title">{props.listTitle}</span>
					{detailOpen && list.fits && <DockListToggle open onToggle={props.onToggleList} />}
				</div>
				{props.children}
			</div>
			{showDetail && props.detail?.render(viewer.leaving, list)}
		</div>
	);
}
