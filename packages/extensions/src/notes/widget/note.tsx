import { oneLine, type SlotProps, type ViewItem } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";

interface RowData {
	readonly item: ViewItem;
	readonly open?: boolean;
	readonly onToggle?: () => void;
}

const CAPSULE = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-[3px] font-mono text-[10px] text-muted";
const DETAIL =
	"mt-1 mb-0 max-h-[320px] overflow-auto rounded-md border border-line bg-code-block-bg px-3 py-2 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-ink";

/** The newest words, so a thinking capsule moves while the model is still writing it. */
function tail(text: string): string {
	const line = oneLine(text);
	return line.length > 80 ? `…${line.slice(-80)}` : line;
}

export function ThinkingRow(props: SlotProps) {
	const { item, open = false, onToggle } = props.data as RowData;
	const redacted = item.thinking?.redacted === true;
	const text = redacted ? "redacted" : (item.thinking?.text ?? "");
	const foldable = !redacted && text.trim() !== "";
	const live = item.live === true;

	return (
		<div className="min-w-0">
			<button
				type="button"
				className={`${CAPSULE} ${foldable ? "cursor-pointer hover:text-ink" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? onToggle : undefined}
			>
				<span className="shrink-0 text-muted-soft">thinking</span>
				<span className="min-w-0 truncate">{redacted ? "redacted" : foldable ? (live ? tail(text) : oneLine(text)) : "…"}</span>
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
	const tool = item.tool;
	if (!tool) return null;
	const failed = tool.status === "error";
	const running = tool.status === "running";
	const pending = tool.status === "pending";
	const tone = failed ? "border-signal/40 text-signal" : running ? "border-line-strong text-ink" : pending ? "border-dashed text-muted" : "border-line text-muted";
	const glyph = failed ? "✗" : running ? "●" : pending ? "…" : "✓";
	const foldable = (tool.args ?? "") !== "" || (tool.result ?? "") !== "";
	return (
		<div className="min-w-0">
			<button
				type="button"
				className={`${CAPSULE} ${tone} ${foldable ? "cursor-pointer hover:text-ink" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? onToggle : undefined}
			>
				<span className={`shrink-0 ${failed ? "text-signal" : running ? "text-accent-teal" : "text-muted-soft"}`}>{glyph}</span>
				<span className="shrink-0 font-sans text-[11px] text-ink">{tool.name}</span>
				<span className="min-w-0 truncate">{oneLine(tool.summary)}</span>
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
