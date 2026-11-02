import { ChevronDown, Pencil } from "lucide-react";
import type { ReactNode } from "react";

export const FIELD =
	"h-8 w-full rounded-md border border-line bg-surface px-2.5 font-sans text-[13px] text-ink outline-none transition-colors duration-100 placeholder:text-muted focus-visible:border-ink";

export const BUTTON = "h-8 shrink-0 cursor-pointer rounded-md px-2.5 font-sans text-[12px] font-medium transition-colors duration-100 disabled:cursor-default disabled:opacity-40";

export const BUTTON_PRIMARY = `${BUTTON} bg-ink text-canvas hover:bg-ink/90`;

export const BUTTON_GHOST = `${BUTTON} border border-line text-ink-soft hover:bg-hover hover:text-ink`;

export const LINK = "inline-flex min-h-6 cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-[10px] text-muted transition-colors duration-100 hover:text-ink";

export function Switch(props: { checked: boolean; onChange: (next: boolean) => void; ariaLabel: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={props.checked}
			aria-label={props.ariaLabel}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-100 after:absolute after:inset-[-4px] after:rounded-full after:content-[''] ${props.checked ? "border-ink bg-ink" : "border-line bg-ink/25"}`}
			onClick={() => props.onChange(!props.checked)}
		>
			<span className={`block size-4 rounded-full bg-canvas shadow-sm transition-transform duration-100 ${props.checked ? "translate-x-4" : "translate-x-0.5"}`} />
		</button>
	);
}

export function SheetRow(props: { rowKey: string; title: ReactNode; description: ReactNode; control: ReactNode; panel?: ReactNode; inline?: ReactNode }) {
	return (
		<div data-row-key={props.rowKey} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 gap-y-2 border-t border-line-soft py-4">
			<div className="min-w-0">
				<div className="flex items-center gap-2 font-sans text-[13px] leading-tight font-medium text-ink">{props.title}</div>
				<div className="mt-0.5 max-w-[56ch] font-sans text-[12px] leading-snug text-muted">{props.description}</div>
			</div>
			<div className="flex min-h-7 items-center justify-end gap-2">{props.control}</div>
			{props.inline === undefined ? null : <div className="col-span-2">{props.inline}</div>}
			{props.panel === undefined ? null : <div className="col-span-2">{props.panel}</div>}
		</div>
	);
}

export function SheetPanel(props: { label: string; children: ReactNode }) {
	return (
		<div className="mt-1 rounded-[10px] border border-line bg-canvas p-3.5">
			<div className="mb-2.5 flex items-center gap-2 font-mono text-[9.5px] tracking-[0.05em] text-muted">
				<span>{props.label}</span>
				<span className="ml-auto tracking-[0.04em] text-muted-soft">esc</span>
			</div>
			{props.children}
		</div>
	);
}

export function ValueButton(props: { value: string; mono?: boolean; mode?: "panel" | "edit"; expanded?: boolean; onClick: () => void }) {
	const editing = props.mode === "edit";
	const Icon = editing ? Pencil : ChevronDown;
	return (
		<button
			type="button"
			aria-expanded={editing ? undefined : props.expanded}
			onClick={props.onClick}
			className={`group -my-1 inline-flex min-h-7 max-w-[300px] cursor-pointer items-center gap-1.5 rounded-[5px] px-1 py-1 text-right font-sans text-[12.5px] leading-tight text-ink-soft transition-colors duration-100 hover:bg-hover hover:text-ink ${props.expanded ? "text-ink" : ""}`}
		>
			<span className={`truncate ${props.mono ? "font-mono text-[11.5px] tracking-[-0.01em]" : ""}`}>{props.value}</span>
			<Icon
				size={editing ? 12 : 11}
				className={`shrink-0 transition-[opacity,transform] duration-100 ${editing ? "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" : `opacity-40 group-hover:opacity-75 ${props.expanded ? "rotate-180" : ""}`}`}
			/>
		</button>
	);
}

export function InlineChoices<T extends string | number>(props: {
	value: T;
	options: readonly { value: T; label: string; mono?: boolean }[];
	onChange: (value: T) => void;
	ariaLabel: string;
}) {
	return (
		<div
			className="inline-flex items-center gap-0.5 rounded-[8px] p-0.5"
			style={{ background: "color-mix(in srgb, var(--ink) 4%, transparent)" }}
			role="group"
			aria-label={props.ariaLabel}
		>
			{props.options.map((option) => {
				const active = option.value === props.value;
				return (
					<button
						key={String(option.value)}
						type="button"
						aria-pressed={active}
						onClick={() => props.onChange(option.value)}
						className={`h-[26px] cursor-pointer rounded-[6px] px-2 leading-none whitespace-nowrap transition-colors duration-100 ${
							option.mono ? "font-mono text-[10.5px] tracking-[-0.01em]" : "font-sans text-[11.5px]"
						} ${active ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:bg-hover hover:text-ink"}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
