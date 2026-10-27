import type { SlotProps, ViewItem } from "@milu/window/api";
import { useState } from "react";

interface RowData {
	readonly item: ViewItem;
}

const CARD = "mt-5 self-end max-w-full rounded-md border px-[15px] py-[10px] font-mono text-[14px] leading-[1.5]";
const BADGE = "shrink-0 rounded-[4px] border border-signal/30 px-1 py-[1px] font-sans text-[10px] uppercase tracking-[0.08em] text-signal";
const DETAIL = "mt-1.5 mb-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words border-t border-line pt-1.5 font-mono text-[12px] leading-[1.5]";

export function CommandRow(props: SlotProps) {
	const { item } = props.data as RowData;
	const [open, setOpen] = useState(false);
	const command = item.command;
	if (!command) return null;
	const failed = command.status === "error";
	const running = command.status === "running";
	const text = command.text ?? "";
	const args = command.args ?? "";
	const foldable = text === "" && args !== "";
	const tone = failed ? "border-signal/45 bg-signal/10 text-ink" : "border-line bg-hover text-ink";
	const detail = text !== "" ? text : open ? args : "";

	return (
		<div className={`${CARD} ${tone}`} data-entry={item.id}>
			<button
				type="button"
				className={`flex w-full items-center justify-between gap-3 border-0 bg-transparent p-0 text-left ${foldable ? "cursor-pointer" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? () => setOpen(!open) : undefined}
			>
				<span className="flex min-w-0 items-center gap-2">
					<span className={BADGE}>command</span>
					<span className="truncate text-ink">{command.name}</span>
				</span>
				<span className="flex shrink-0 items-center font-sans text-[10px] uppercase tracking-[0.08em]">
					{running ? (
						<span className="flex items-center gap-1.5">
							<span className="work-dot" />
							<span className="work-dot" />
							<span className="work-dot" />
						</span>
					) : failed ? (
						<span className="text-ink-soft">error</span>
					) : (
						<span className="text-signal">✓</span>
					)}
				</span>
			</button>
			{detail === "" ? null : <pre className={`${DETAIL} ${failed ? "text-ink-soft" : "text-muted"}`}>{detail}</pre>}
		</div>
	);
}

export default CommandRow;
