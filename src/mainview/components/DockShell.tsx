import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { registerSurfaceRoot } from "../lib/active-surface";
import { DOCK_EXIT_MS, usePresence } from "../lib/presence";
import type { SurfaceId } from "../lib/surfaces";
import { isInteractive } from "../lib/utils";

export interface DockListControls {
	open: boolean;
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
	   否则两份宽度相加会让 workbench 先涨后缩。 */
	const [arriving] = useState(() => typeof document === "undefined" || document.querySelectorAll(".dock").length === 0);
	const drawer = usePresence(props.open, DOCK_EXIT_MS);
	const viewer = usePresence(props.open && (props.detail?.open ?? false), DOCK_EXIT_MS);
	const dockEl = useRef<HTMLDivElement>(null);
	const detachSurface = useRef<(() => void) | null>(null);

	function bindRoot(el: HTMLDivElement | null) {
		dockEl.current = el;
		detachSurface.current?.();
		detachSurface.current = el && props.surface ? registerSurfaceRoot(el, props.surface) : null;
	}

	if (!drawer.visible) return null;

	/* 没有详情可让位时，列表就是这一列的全部：撑满，也不给收起开关（收了没有别的可看）。 */
	const detailOpen = props.open && (props.detail?.open ?? false);
	const collapsed = detailOpen && !props.listOpen;
	const paneWidth = detailOpen ? (collapsed ? 0 : props.paneWidth) : props.width;
	const list: DockListControls = { open: props.listOpen, toggle: props.onToggleList };

	return (
		<div
			className={`dock${props.class ? ` ${props.class}` : ""}${arriving ? " arriving" : ""}${drawer.leaving ? " leaving" : ""}${drawer.leaving && props.width > 0 ? " out" : ""}`}
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
					{detailOpen && <DockListToggle open onToggle={props.onToggleList} />}
				</div>
				{props.children}
			</div>
			{viewer.visible && props.detail?.render(viewer.leaving, list)}
		</div>
	);
}
