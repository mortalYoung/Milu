import type { SlotProps, ViewItem } from "@milu/window/api";
import { useState } from "react";

interface RowData {
	readonly item: ViewItem;
}

const CARD = "mt-5 self-end max-w-full rounded-md border px-[15px] py-[10px] font-mono text-[14px] leading-[1.5]";
const BADGE = "shrink-0 rounded-[4px] border px-1 py-[1px] font-mono text-[10px] uppercase tracking-[0.08em]";
const OUTPUT = "mt-1.5 mb-0 max-h-[320px] overflow-auto border-t border-line pt-1.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words text-muted";

export function ShellRow(props: SlotProps) {
	const { item } = props.data as RowData;
	const [open, setOpen] = useState(true);
	const shell = item.shell;
	const failed = shell?.exitCode !== undefined && shell.exitCode !== 0;
	const foldable = shell !== undefined && shell.output !== "";
	const tone = failed ? "border-signal/45 bg-signal/10 text-ink" : "border-line bg-hover text-ink";

	return (
		<div className={`${CARD} ${tone}`} data-entry={item.id}>
			<button
				type="button"
				className={`flex w-full items-center gap-2 border-0 bg-transparent p-0 text-left ${foldable ? "cursor-pointer" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? () => setOpen(!open) : undefined}
			>
				<span className={`${BADGE} ${failed ? "border-signal/40 text-signal" : "border-accent-amber/50 text-accent-amber"}`}>shell</span>
				<span className="min-w-0 flex-1 truncate">$ {item.text}</span>
				{failed ? <span className="shrink-0 font-mono text-[10px] text-signal">exit {shell?.exitCode}</span> : null}
				{foldable ? <span className="shrink-0 text-[10px] text-muted-soft">{open ? "⌄" : "›"}</span> : null}
			</button>
			{open && shell && shell.output !== "" ? <pre className={OUTPUT}>{shell.output}</pre> : null}
		</div>
	);
}

export default ShellRow;
