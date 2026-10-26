import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export const FIELD =
	"h-8 w-full rounded-md border border-line bg-surface px-2.5 font-sans text-[13px] text-ink outline-none transition-colors duration-100 placeholder:text-muted focus-visible:border-ink";

export const BUTTON = "h-8 shrink-0 cursor-pointer rounded-md px-2.5 font-sans text-[12px] font-medium transition-colors duration-100 disabled:cursor-default disabled:opacity-40";

export const BUTTON_PRIMARY = `${BUTTON} bg-ink text-canvas hover:bg-ink/90`;

export const BUTTON_GHOST = `${BUTTON} border border-line text-ink-soft hover:bg-hover hover:text-ink`;

export const LINK = "cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-muted transition-colors duration-100 hover:text-ink";

export function Row(props: { title: ReactNode; description: ReactNode; modified?: boolean; stacked?: boolean; children: ReactNode }) {
	const head = (
		<div className="flex items-center gap-2">
			<span className="font-serif text-[14px] leading-tight text-ink">{props.title}</span>
			{props.modified ? (
				<span className="flex items-center gap-1.5">
					<span className="size-[5px] shrink-0 rounded-full bg-signal" />
					<span className="font-sans text-[10px] font-medium text-signal">modified</span>
				</span>
			) : null}
		</div>
	);
	const body = <div className="mt-1 font-sans text-[12px] leading-snug text-muted">{props.description}</div>;
	if (props.stacked) {
		return (
			<div className="py-3.5">
				{head}
				{body}
				<div className="mt-3">{props.children}</div>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-6 py-3.5">
			<div className="min-w-0 flex-1">
				{head}
				{body}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">{props.children}</div>
		</div>
	);
}

export function TextField(props: { value: string; onCommit: (next: string) => void; placeholder?: string; ariaLabel?: string; mono?: boolean; width?: string }) {
	return (
		<input
			key={props.value}
			defaultValue={props.value}
			className={`${FIELD} ${props.mono ? "font-mono text-[12px]" : ""} ${props.width ?? "w-[200px]"}`}
			placeholder={props.placeholder}
			aria-label={props.ariaLabel}
			spellCheck={false}
			onBlur={(event) => {
				const next = event.currentTarget.value;
				if (next !== props.value) props.onCommit(next);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					event.currentTarget.value = props.value;
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

export function NumberField(props: { value: number | undefined; onCommit: (next: number) => void; min?: number; max?: number; step?: number; ariaLabel: string }) {
	const fallback = props.value ?? 0;
	const commit = (input: HTMLInputElement) => {
		const parsed = Number(input.value);
		const next = Number.isFinite(parsed) ? Math.max(props.min ?? 0, parsed) : fallback;
		input.value = String(next);
		if (next !== fallback) props.onCommit(next);
	};
	return (
		<input
			key={fallback}
			type="number"
			defaultValue={String(fallback)}
			className={`${FIELD} w-[200px]`}
			min={props.min}
			max={props.max}
			step={props.step}
			aria-label={props.ariaLabel}
			onBlur={(event) => commit(event.currentTarget)}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					event.currentTarget.value = String(fallback);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

export function Switch(props: { checked: boolean; onChange: (next: boolean) => void; ariaLabel: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={props.checked}
			aria-label={props.ariaLabel}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-100 ${props.checked ? "border-ink bg-ink" : "border-line bg-ink/25"}`}
			onClick={() => props.onChange(!props.checked)}
		>
			<span className={`block size-4 rounded-full bg-canvas shadow-sm transition-transform duration-100 ${props.checked ? "translate-x-4" : "translate-x-0.5"}`} />
		</button>
	);
}

export function Select(props: { value: string; options: readonly { value: string; label: string }[]; onChange: (next: string) => void; ariaLabel: string; width?: string }) {
	return (
		<span className="relative inline-flex">
			<select
				className={`${FIELD} ${props.width ?? "w-[200px]"} cursor-pointer appearance-none pr-7`}
				value={props.value}
				aria-label={props.ariaLabel}
				onChange={(event) => props.onChange(event.currentTarget.value)}
			>
				{props.options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<ChevronDown size={12} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
		</span>
	);
}
