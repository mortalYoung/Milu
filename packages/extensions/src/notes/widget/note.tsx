import { oneLine, type SlotProps, type ViewItem } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";
import { type RefObject, useEffect, useRef, useState } from "react";

interface RowData {
	readonly item: ViewItem;
	readonly open?: boolean;
	readonly onToggle?: () => void;
}

const CAPSULE = "max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-[3px] font-mono text-[10px] text-muted";
const ELLIPSIS = "mx-1 text-ink";
const DETAIL =
	"mt-1 mb-0 max-h-[320px] overflow-auto rounded-md border border-line bg-code-block-bg px-3 py-2 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-ink";

let charWidth = 0;

/** JetBrains Mono at 10px, measured once, so a preview can spend the whole row instead of a guessed character count. */
function measureChar(): number {
	if (charWidth > 0) return charWidth;
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return 6;
	context.font = "10px 'JetBrains Mono', ui-monospace, monospace";
	charWidth = context.measureText("M").width || 6;
	return charWidth;
}

function useBudget(ref: RefObject<HTMLElement | null>): number {
	const [budget, setBudget] = useState(0);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			const width = element.clientWidth;
			if (width > 0) setBudget(Math.max(16, Math.floor(width / measureChar()) - 4));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return budget;
}

/** One line, elided in the middle: the head says what it is about, the tail says where it got to. */
function middle(text: string, budget: number): { head: string; tail: string; elided: boolean } {
	const line = oneLine(text);
	if (line.length <= budget) return { head: line, tail: "", elided: false };
	const keep = budget - 1;
	return { head: line.slice(0, Math.ceil(keep / 2)), tail: line.slice(-Math.floor(keep / 2)), elided: true };
}

function Middle(props: { text: string; budget: number }) {
	const parts = props.budget === 0 ? { head: oneLine(props.text), tail: "", elided: false } : middle(props.text, props.budget);
	if (!parts.elided) return <>{parts.head}</>;
	return (
		<>
			{parts.head}
			<span className={ELLIPSIS}>…</span>
			{parts.tail}
		</>
	);
}

export function ThinkingRow(props: SlotProps) {
	const { item, open = false, onToggle } = props.data as RowData;
	const redacted = item.thinking?.redacted === true;
	const text = redacted ? "redacted" : (item.thinking?.text ?? "");
	const foldable = !redacted && text.trim() !== "";
	const live = item.live === true;
	const line = useRef<HTMLSpanElement>(null);
	const budget = useBudget(line);

	return (
		<div className="min-w-0">
			<button
				type="button"
				className={`${CAPSULE} flex w-full ${foldable ? "cursor-pointer hover:text-ink" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? onToggle : undefined}
			>
				<span className="shrink-0 text-muted-soft">thinking</span>
				<span ref={line} className="min-w-0 flex-1 truncate text-left">
					{redacted ? "redacted" : foldable ? <Middle text={text} budget={budget} /> : "…"}
				</span>
			</button>
			{open && foldable ? (
				<blockquote className="m-0 mt-1 max-h-[320px] min-w-0 overflow-y-auto border-l-2 border-line pr-1 pl-3 font-sans text-[12px] leading-[1.6] text-muted-soft">
					<Markdown port={props.host.markdown} text={text} plain={live} />
				</blockquote>
			) : null}
		</div>
	);
}

export function ToolRow(props: SlotProps) {
	const { item, open = false, onToggle } = props.data as RowData;
	const line = useRef<HTMLSpanElement>(null);
	const budget = useBudget(line);
	const tool = item.tool;
	if (!tool) return null;
	const failed = tool.status === "error";
	const running = tool.status === "running";
	const pending = tool.status === "pending";
	const tone = failed ? "border-signal/40 text-signal" : running ? "border-line-strong text-ink" : pending ? "border-dashed text-muted" : "border-line text-muted";
	const glyph = failed ? "✗" : running ? "●" : pending ? "…" : "✓";
	const foldable = (tool.args ?? "") !== "" || (tool.result ?? "") !== "";
	const args = tool.args ?? tool.summary;
	const result = running ? "loading…" : pending ? "…" : (tool.result ?? "");
	const argsBudget = budget === 0 ? 0 : Math.max(12, Math.floor((budget - 3) * 0.45));
	const resultBudget = budget === 0 ? 0 : Math.max(12, budget - 3 - argsBudget);
	return (
		<div className="min-w-0">
			<button
				type="button"
				className={`${CAPSULE} ${tone} flex w-full ${foldable ? "cursor-pointer hover:text-ink" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? onToggle : undefined}
			>
				<span className={`shrink-0 ${failed ? "text-signal" : running ? "text-accent-teal" : "text-muted-soft"}`}>{glyph}</span>
				<span className="shrink-0 font-sans text-[11px] text-ink">{tool.name}</span>
				<span ref={line} className="min-w-0 flex-1 truncate text-left">
					{args === "" ? null : <Middle text={args} budget={argsBudget} />}
					{args !== "" && result !== "" ? <span className="mx-1.5 text-line-strong">|</span> : null}
					<span className={running || pending ? "text-muted-soft" : "text-ink"}>
						<Middle text={result} budget={resultBudget} />
					</span>
				</span>
			</button>
			{open && foldable ? (
				<>
					{tool.args ? <pre className={DETAIL}>{tool.args}</pre> : null}
					{tool.result ? <pre className={`${DETAIL} mt-1`}>{tool.result}</pre> : null}
				</>
			) : null}
		</div>
	);
}

export function SayRow(props: SlotProps) {
	const { item } = props.data as RowData;
	return <Markdown port={props.host.markdown} text={item.text} className="text-[14px]" plain={item.live === true} />;
}

export function NoteFallback(props: { item: ViewItem }) {
	const { item } = props;
	const label = item.tool ? item.tool.name : "thinking";
	const text = item.tool ? item.tool.summary : oneLine(item.thinking?.text ?? "");
	return (
		<div className="min-w-0 truncate font-mono text-[10px] leading-[1.7] text-muted">
			{label} {text}
		</div>
	);
}
