import { type ReactNode, useEffect, useRef, useState } from "react";
import { registerSurfaceRoot } from "../lib/active-surface";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { GRIP_WIDTH } from "../lib/grip";
import { DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS, usePresence } from "../lib/presence";
import type { SurfaceId } from "../lib/surfaces";
import { isInteractive } from "../lib/utils";
import { DockGrip } from "./DockGrip";

const COLUMN_MIN = 420;
const CODE_MIN = 460;
const PIN_MIN = COLUMN_MIN + CODE_MIN + GRIP_WIDTH;

export interface DockListControls {
	pinned: boolean;
	canPin: boolean;
	togglePin: () => void;
	listOpen: boolean;
	openList: (anchor?: { x: number; y: number }) => void;
}

export function DockShell(props: {
	panelId: string;
	open: boolean;
	side: "left" | "right";
	class?: string;
	width: number;
	min: number;
	max: number;
	resizeLabel: string;
	onResize: (px: number) => void;
	onCommit: () => void;
	pinned: boolean;
	onTogglePin: () => void;
	columnWidth: number | null;
	setColumnWidth: (width: number | null) => void;
	commitColumnWidth: () => void;
	detail?: { open: boolean; render: (leaving: boolean, list: DockListControls) => ReactNode };
	children: ReactNode;
	surface?: SurfaceId;
}) {
	const drawer = usePresence(props.open, DOCK_EXIT_MS);
	const viewer = usePresence(props.open && (props.detail?.open ?? false), DOCK_POPOVER_EXIT_MS);
	const [listOpen, setListOpen] = useState(false);
	const [listAnchor, setListAnchor] = useState<{ x: number; y: number } | null>(null);
	const [rowWidth, setRowWidth] = useState(0);
	const dockEl = useRef<HTMLDivElement>(null);
	const rowObserver = useRef<ResizeObserver | null>(null);
	const detachSurface = useRef<(() => void) | null>(null);

	const detailOpen = props.open && (props.detail?.open ?? false);
	const floating = props.pinned && listOpen && viewer.visible;
	const canPin = rowWidth >= PIN_MIN;
	const columnHost = () => dockEl.current?.parentElement ?? null;

	/* the floating list lands where it was clicked, clamped inside the dock */
	function anchorStyle(): React.CSSProperties {
		const dock = dockEl.current;
		if (!floating || !listAnchor || !dock) return {};
		const maxLeft = Math.max(8, dock.clientWidth - props.width - 8);
		return { left: Math.min(Math.max(8, listAnchor.x), maxLeft), top: Math.max(8, listAnchor.y), right: "auto" };
	}

	function halfWidth() {
		const row = columnHost();
		if (!row) return 0;
		return Math.round((row.clientWidth - GRIP_WIDTH) / 2);
	}

	function columnWidthNow() {
		const row = columnHost();
		const dock = dockEl.current;
		if (!row || !dock) return props.columnWidth ?? 0;
		const rowBox = row.getBoundingClientRect();
		const dockBox = dock.getBoundingClientRect();
		return props.side === "right" ? dockBox.left - rowBox.left : rowBox.right - dockBox.right;
	}

	const columnMax = Math.max(COLUMN_MIN, rowWidth - CODE_MIN - GRIP_WIDTH);

	function bindRoot(el: HTMLDivElement | null) {
		dockEl.current = el;
		rowObserver.current?.disconnect();
		rowObserver.current = null;
		detachSurface.current?.();
		detachSurface.current = el && props.surface ? registerSurfaceRoot(el, props.surface) : null;
		if (!el) return;
		queueMicrotask(() => {
			const row = el.parentElement;
			if (!row || !el.isConnected) return;
			const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
			observer.observe(row);
			rowObserver.current = observer;
			setRowWidth(row.clientWidth);
		});
	}

	useEffect(() => () => rowObserver.current?.disconnect(), []);

	useEffect(() => {
		if (!props.pinned || !detailOpen) setListOpen(false);
	}, [props.pinned, detailOpen]);

	useEffect(() => {
		if (!props.open) return;
		if (props.pinned && !detailOpen) props.onTogglePin();
	}, [props.open, props.pinned, detailOpen, props]);

	useEffect(() => {
		if (!floating) return;
		const onPointerDown = (event: PointerEvent) => {
			if ((event.target as HTMLElement | null)?.closest(".dock-pane")) return;
			setListOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [floating]);

	useEscapeLayer({
		id: `${props.panelId}.list`,
		order: ESCAPE_ORDER.dockList,
		isOpen: () => props.open && props.pinned && listOpen && viewer.visible,
		close: () => setListOpen(false),
	});

	const list: DockListControls = {
		pinned: props.pinned,
		canPin,
		togglePin: () => props.onTogglePin(),
		listOpen: floating,
		openList: (anchor) => {
			setListAnchor(anchor ?? null);
			setListOpen(true);
		},
	};

	if (!drawer.visible) return null;

	return (
		<div
			className={`dock side-${props.side}${props.class ? ` ${props.class}` : ""}${drawer.leaving ? " leaving" : ""}`}
			ref={bindRoot}
			tabIndex={-1}
			onClick={(event) => {
				if (isInteractive(event.target)) return;
				event.currentTarget.focus();
			}}
		>
			{props.pinned && viewer.visible && (
				<DockGrip
					class="dock-grip-split"
					host={columnHost}
					width={columnWidthNow}
					min={COLUMN_MIN}
					max={columnMax}
					side={props.side === "right" ? "left" : "right"}
					label="Resize the chat column"
					half={halfWidth}
					onResize={props.setColumnWidth}
					onCommit={props.commitColumnWidth}
				/>
			)}
			{viewer.visible && props.detail?.render(viewer.leaving, list)}
			{!props.pinned && viewer.visible && (
				<DockGrip
					class="dock-grip-pane"
					host={() => dockEl.current}
					width={() => props.width}
					min={props.min}
					max={props.max}
					side={props.side}
					label={props.resizeLabel}
					half={halfWidth}
					onResize={props.onResize}
					onCommit={props.onCommit}
				/>
			)}
			<div className={"dock-pane" + (floating ? " floating" : "")} style={{ width: `${props.width}px`, ...anchorStyle() }}>
				{props.children}
			</div>
		</div>
	);
}
