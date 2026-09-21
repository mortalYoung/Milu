import { type ReactNode, useEffect, useRef, useState } from "react";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { GRIP_WIDTH } from "../lib/grip";
import { DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS, usePresence } from "../lib/presence";
import { DockGrip } from "./DockGrip";

const LETTER_MIN = 420;
const CODE_MIN = 460;
const PIN_MIN = LETTER_MIN + CODE_MIN + GRIP_WIDTH;

export interface DockListControls {
	pinned: boolean;
	canPin: boolean;
	togglePin: () => void;
	listOpen: boolean;
	openList: () => void;
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
	letterWidth: number | null;
	setLetterWidth: (width: number | null) => void;
	commitLetterWidth: () => void;
	detail?: { open: boolean; render: (leaving: boolean, list: DockListControls) => ReactNode };
	title: ReactNode;
	onClose: () => void;
	children: ReactNode;
	onRoot?: (el: HTMLDivElement) => void;
}) {
	const drawer = usePresence(props.open, DOCK_EXIT_MS);
	const viewer = usePresence(props.open && (props.detail?.open ?? false), DOCK_POPOVER_EXIT_MS);
	const [listOpen, setListOpen] = useState(false);
	const [rowWidth, setRowWidth] = useState(0);
	const dockEl = useRef<HTMLDivElement>(null);
	const rowObserver = useRef<ResizeObserver | null>(null);

	const detailOpen = props.open && (props.detail?.open ?? false);
	const floating = props.pinned && listOpen && viewer.visible;
	const canPin = rowWidth >= PIN_MIN;
	const letterHost = () => dockEl.current?.parentElement ?? null;

	function letterWidthNow() {
		const row = letterHost();
		const dock = dockEl.current;
		if (!row || !dock) return props.letterWidth ?? 0;
		const rowBox = row.getBoundingClientRect();
		const dockBox = dock.getBoundingClientRect();
		return props.side === "right" ? dockBox.left - rowBox.left : rowBox.right - dockBox.right;
	}

	const letterMax = Math.max(LETTER_MIN, rowWidth - CODE_MIN - GRIP_WIDTH);

	function bindRoot(el: HTMLDivElement | null) {
		dockEl.current = el;
		rowObserver.current?.disconnect();
		rowObserver.current = null;
		if (!el) return;
		props.onRoot?.(el);
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
		openList: () => setListOpen(true),
	};

	if (!drawer.visible) return null;

	return (
		<div className={`dock side-${props.side}${props.class ? ` ${props.class}` : ""}${drawer.leaving ? " leaving" : ""}`} ref={bindRoot}>
			{props.pinned && viewer.visible && (
				<DockGrip
					class="dock-grip-split"
					host={letterHost}
					width={letterWidthNow}
					min={LETTER_MIN}
					max={letterMax}
					side={props.side === "right" ? "left" : "right"}
					label="Resize the letter column"
					onResize={props.setLetterWidth}
					onCommit={props.commitLetterWidth}
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
					onResize={props.onResize}
					onCommit={props.onCommit}
				/>
			)}
			<div className={"dock-pane" + (floating ? " floating" : "")} style={{ width: `${props.width}px` }}>
				{!floating && (
					<div className="dock-head">
						<span className="dock-title">{props.title}</span>
						{!props.pinned && (
							<button type="button" className="dock-close" title="Close" onClick={props.onClose}>
								×
							</button>
						)}
					</div>
				)}
				{props.children}
			</div>
		</div>
	);
}
