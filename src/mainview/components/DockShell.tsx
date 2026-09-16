import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { createPresence, DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS } from "../lib/presence";
import { DockGrip, GRIP_WIDTH } from "./DockGrip";

/** The letter column's floor, and what the detail needs beside it. Pinning needs both, plus the grip. */
const LETTER_MIN = 420;
const CODE_MIN = 460;
const PIN_MIN = LETTER_MIN + CODE_MIN + GRIP_WIDTH;

/** What a panel needs from the dock to draw its own head: pin state, and the floating list. */
export interface DockListControls {
	pinned: boolean;
	canPin: boolean;
	togglePin: () => void;
	listOpen: boolean;
	openList: () => void;
}

/**
 * The frame every docked surface shares: the edge it slides in from, the pane that holds the list,
 * the head above it, pinning, and the floating list the pin trades the pane for.
 *
 * What a panel brings is only its content — the tree or the change list, the reader or the diff —
 * and the numbers that describe them. The pane width and the pin state are the dock's own: one size,
 * one rule, wherever you dock. (Esc is not: it has one owner for the whole app, see lib/escape.ts.)
 *
 * Pinned, the dock shares the row with the letter instead of covering it, and the list stops taking
 * row width: it hides, and floats over the detail when a panel asks for it. A pinned dock keeps no
 * close button — leaving the layout is the pin's job.
 */
export function DockShell(props: {
	/** Which panel this is: the floating list publishes itself as a layer under this name. */
	panelId: string;
	open: boolean;
	side: "left" | "right";
	/** Extra hooks on the root. */
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
	/** The layer in front of the pane, kept mounted through its own exit. */
	detail?: { open: boolean; render: (leaving: boolean, list: DockListControls) => JSX.Element };
	title: JSX.Element;
	actions?: JSX.Element;
	onClose: () => void;
	/** The pane's own content, which keeps its classes, its ref and its scroll. */
	children: JSX.Element;
	/** The dock element, for panels that measure the row it lives in. */
	onRoot?: (el: HTMLDivElement) => void;
}) {
	const drawer = createPresence(() => props.open, DOCK_EXIT_MS);
	const viewer = createPresence(() => props.open && (props.detail?.open ?? false), DOCK_POPOVER_EXIT_MS);
	const [listOpen, setListOpen] = createSignal(false);
	const [rowWidth, setRowWidth] = createSignal(0);
	let dockEl: HTMLDivElement | undefined;
	let rowObserver: ResizeObserver | undefined;

	const detailOpen = () => props.open && (props.detail?.open ?? false);
	const floating = () => props.pinned && listOpen() && viewer.visible();
	const canPin = () => rowWidth() >= PIN_MIN;
	const letterHost = () => dockEl?.parentElement ?? undefined;
	// The split grip resizes the letter column, which lives outside this component: measure it from
	// the row's edge to the dock's edge rather than reaching for its DOM.
	function letterWidthNow() {
		const row = letterHost();
		if (!row || !dockEl) return props.letterWidth ?? 0;
		const rowBox = row.getBoundingClientRect();
		const dockBox = dockEl.getBoundingClientRect();
		return props.side === "right" ? dockBox.left - rowBox.left : rowBox.right - dockBox.right;
	}
	// Pinned, the list never takes row width, so the detail gets everything but the letter column.
	const letterMax = () => Math.max(LETTER_MIN, rowWidth() - CODE_MIN - GRIP_WIDTH);

	function bindRoot(el: HTMLDivElement) {
		dockEl = el;
		props.onRoot?.(el);
		rowObserver?.disconnect();
		// A ref callback runs when the element is created, before it is appended — measure on the
		// next microtask, once the row it lives in actually exists.
		queueMicrotask(() => {
			const row = el.parentElement;
			if (!row || !el.isConnected) return;
			rowObserver = new ResizeObserver(() => setRowWidth(row.clientWidth));
			rowObserver.observe(row);
			setRowWidth(row.clientWidth);
		});
	}
	onCleanup(() => rowObserver?.disconnect());

	// The floating list is transient: it goes when the detail does, when pinning ends, or on Esc.
	createEffect(() => {
		if (!props.pinned || !detailOpen()) setListOpen(false);
	});

	// A pin is the file's, not the dock's: when the file goes — Esc, its back button, another panel
	// taking the dock — the pin lets go with it, so a pinned dock is never left with nothing to release.
	// Only the open panel may release: the closed panel's shell is mounted too, and sees the same pin.
	createEffect(() => {
		if (!props.open) return;
		if (props.pinned && !detailOpen()) props.onTogglePin();
	});

	createEffect(() => {
		if (!floating()) return;
		const onPointerDown = (event: PointerEvent) => {
			if ((event.target as HTMLElement | null)?.closest(".dock-pane")) return;
			setListOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
	});

	// The pin trades the pane for a card over the detail; that card is the panel's own Esc layer.
	useEscapeLayer({
		id: `${props.panelId}.list`,
		order: ESCAPE_ORDER.dockList,
		isOpen: () => props.open && floating(),
		close: () => setListOpen(false),
	});

	const list: DockListControls = {
		get pinned() {
			return props.pinned;
		},
		get canPin() {
			return canPin();
		},
		togglePin: () => props.onTogglePin(),
		get listOpen() {
			return floating();
		},
		openList: () => setListOpen(true),
	};

	return (
		<Show when={drawer.visible()}>
			<div class={`dock side-${props.side}${props.class ? ` ${props.class}` : ""}`} classList={{ leaving: drawer.leaving() }} ref={bindRoot}>
				<Show when={props.pinned && viewer.visible()}>
					<DockGrip
						class="dock-grip-split"
						host={letterHost}
						width={letterWidthNow}
						min={LETTER_MIN}
						max={letterMax()}
						// The letter sits on the far side of the dock, so the pointer grows it the other way round.
						side={props.side === "right" ? "left" : "right"}
						label="Resize the letter column"
						onResize={props.setLetterWidth}
						onCommit={props.commitLetterWidth}
					/>
				</Show>
				<Show when={viewer.visible()}>{props.detail?.render(viewer.leaving(), list)}</Show>
				<Show when={viewer.visible()}>
					<DockGrip
						host={() => dockEl}
						width={() => props.width}
						min={props.min}
						max={props.max}
						side={props.side}
						label={props.resizeLabel}
						onResize={props.onResize}
						onCommit={props.onCommit}
					/>
				</Show>
				<div class="dock-pane" classList={{ floating: floating() }} style={{ width: `${props.width}px` }}>
					<Show when={!floating()}>
						<div class="dock-head">
							<span class="dock-title">{props.title}</span>
							{props.actions}
							<Show when={!props.pinned}>
								<button type="button" class="dock-close" title="Close" onClick={props.onClose}>
									×
								</button>
							</Show>
						</div>
					</Show>
					{props.children}
				</div>
			</div>
		</Show>
	);
}
