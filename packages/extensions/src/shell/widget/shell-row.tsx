import type { SlotProps, ViewItem } from "@milu/window/api";
import { ChevronDown, Terminal } from "lucide-react";
import { useState } from "react";

interface RowData {
	readonly item: ViewItem;
}

const CARD = "mt-5 self-end max-w-full rounded-md border px-[15px] py-[10px] font-mono text-[14px] leading-[1.5]";
const OUTPUT = "mt-1.5 mb-0 max-h-[320px] overflow-auto border-t border-line pt-1.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words text-muted";

export function ShellRow(props: SlotProps) {
	const { item } = props.data as RowData;
	const [open, setOpen] = useState(true);
	const shell = item.shell;
	const running = shell?.status === "running";
	const failed = shell?.status === "error";
	const foldable = shell !== undefined && !running && shell.output !== "";
	const tone = failed ? "border-signal/45 bg-signal/10 text-ink" : "border-line bg-hover text-ink";

	return (
		<div className={`${CARD} ${tone}`} data-entry={item.id} aria-busy={running || undefined}>
			<button
				type="button"
				className={`flex w-full items-center gap-2 border-0 bg-transparent p-0 text-left ${foldable ? "cursor-pointer" : "cursor-default"}`}
				aria-expanded={foldable ? open : undefined}
				onClick={foldable ? () => setOpen(!open) : undefined}
			>
				<Terminal size={13} className={`shrink-0 ${failed ? "text-signal" : "text-accent-amber"}`} />
				<span className="min-w-0 flex-1 truncate">$ {item.text}</span>
				{failed ? <span className="shrink-0 font-mono text-[10px] text-signal">exit {shell?.exitCode}</span> : null}
				<span className="flex w-3 shrink-0 items-center justify-center" aria-hidden={foldable ? undefined : true}>
					{running ? (
						<span className="work-dot" />
					) : foldable ? (
						<ChevronDown size={11} className={`text-muted-soft transition-transform duration-[120ms] ${open ? "" : "-rotate-90"}`} />
					) : null}
				</span>
			</button>
			{open && !running && shell && shell.output !== "" ? <pre className={OUTPUT}>{shell.output}</pre> : null}
		</div>
	);
}

export default ShellRow;
