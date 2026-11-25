import { ChevronDown } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { ProviderMark } from "../provider-marks.tsx";

export const MODEL_PANEL =
	"z-[70] w-[344px] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_color-mix(in_srgb,var(--ink)_14%,transparent)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.23,1,0.32,1)_both] data-[state=closed]:animate-[menu-out_120ms_cubic-bezier(0.23,1,0.32,1)_both] motion-reduce:animate-none";
const ROW =
	"grid h-8 w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-[6px] px-2 text-left transition-colors duration-100 motion-reduce:transition-none";
const LABEL = "font-mono text-[9px] tracking-[0.14em] text-muted-soft uppercase";

export interface ModelRow {
	readonly key: string;
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly contextWindow?: number;
	readonly cost?: { readonly input: number; readonly output: number };
}

export function modelRowsOf(groups: readonly { readonly provider: string; readonly models: readonly Omit<ModelRow, "key" | "provider">[] }[]): ModelRow[] {
	return groups.flatMap((group) => group.models.map((model) => ({ key: `${group.provider}:${model.id}`, provider: group.provider, ...model })));
}

function sizeOf(value: number | undefined): string {
	if (value === undefined) return "—";
	if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`.replace(".0M", "M");
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

function priceOf(cost: ModelRow["cost"]): string {
	return cost === undefined ? "—" : `$${cost.input}/${cost.output}`;
}

function useBottomFade(): [RefObject<HTMLDivElement | null>, string] {
	const ref = useRef<HTMLDivElement | null>(null);
	const [below, setBelow] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (element === null) return;
		let frame = 0;
		const measure = (): void => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				setBelow(element.scrollTop + element.clientHeight < element.scrollHeight - 2);
			});
		};
		measure();
		element.addEventListener("scroll", measure, { passive: true });
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const mutations = new MutationObserver(measure);
		mutations.observe(element, { subtree: true, childList: true, characterData: true });
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", measure);
			resize.disconnect();
			mutations.disconnect();
		};
	}, []);

	return [ref, below ? "edge-fade has-below" : ""];
}

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly provider?: string | null;
	readonly label: string;
	readonly effort?: string;
};

export const ModelPill = forwardRef<HTMLButtonElement, PillProps>(function ModelPill(props, ref) {
	const { provider, label, effort, className, ...rest } = props;
	const empty = provider === null || provider === undefined;
	return (
		<button
			ref={ref}
			type="button"
			{...rest}
			className={`${empty ? "text-muted-soft" : "text-muted-soft hover:text-ink"} group inline-flex h-[26px] min-w-0 max-w-[240px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2 transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover data-[state=open]:text-ink motion-reduce:transition-none ${className ?? ""}`}
		>
			{empty ? null : <ProviderMark provider={provider} size={13} className="text-ink-soft" />}
			<span className={`${empty ? "text-muted-soft" : "models-pill-label text-ink-soft"} truncate font-mono text-[11px]`}>{label}</span>
			{effort === undefined || effort === "" ? null : <span className="models-pill-effort shrink-0 font-mono text-[11px] text-muted">· {effort}</span>}
			<ChevronDown size={11} className="shrink-0 opacity-45 transition-transform duration-100 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
		</button>
	);
});

export function ModelPanel(props: {
	readonly rows: readonly ModelRow[];
	readonly selected: { readonly provider: string; readonly modelId?: string } | null;
	readonly onPick: (row: ModelRow) => void;
	readonly efforts?: readonly string[];
	readonly effort?: string;
	readonly onEffort?: (level: string) => void;
	readonly autoFocus?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement | null>(null);
	const [list, fade] = useBottomFade();

	useEffect(() => {
		if (props.autoFocus === false) return;
		const frame = requestAnimationFrame(() => input.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [props.autoFocus]);

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (needle === "") return props.rows;
		return props.rows.filter((row) => `${row.name} ${row.id} ${row.provider}`.toLowerCase().includes(needle));
	}, [props.rows, query]);

	const sections = useMemo(() => {
		const out: { label: string; rows: ModelRow[] }[] = [];
		for (const row of visible) {
			const last = out.at(-1);
			if (last === undefined || last.label !== row.provider) out.push({ label: row.provider, rows: [row] });
			else last.rows.push(row);
		}
		return out;
	}, [visible]);

	const flat = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
	const cursor = Math.min(active, Math.max(0, flat.length - 1));

	const key = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((index) => Math.min(index + 1, flat.length - 1));
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((index) => Math.max(index - 1, 0));
		}
		if (event.key === "Enter") {
			const row = flat[cursor];
			if (row === undefined) return;
			event.preventDefault();
			props.onPick(row);
		}
	};

	return (
		<div onKeyDown={key}>
			<div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
				<input
					ref={input}
					value={query}
					onChange={(event) => {
						setQuery(event.currentTarget.value);
						setActive(0);
					}}
					placeholder="Filter models"
					aria-label="Filter models"
					spellCheck={false}
					autoComplete="off"
					className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[12.5px] text-ink outline-none placeholder:text-muted-soft"
				/>
				<span className="shrink-0 rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted-soft">esc</span>
			</div>
			<div role="listbox" aria-label="Models" ref={list} className={`${fade} max-h-[302px] overflow-y-auto px-1.5 pb-1.5`}>
				{flat.length === 0 ? <p className="m-0 px-2 py-4 text-center font-mono text-[11.5px] text-muted-soft">no model matches “{query.trim()}”</p> : null}
				{sections.map((section) => (
					<div key={section.label} className="[&+&]:mt-1">
						<div className={`${LABEL} sticky top-0 z-[1] -mx-1.5 border-b border-line-soft bg-surface px-3.5 pt-2 pb-1`}>{section.label}</div>
						{section.rows.map((row) => {
							const selected = props.selected !== null && props.selected.provider === row.provider && props.selected.modelId === row.id;
							const index = flat.indexOf(row);
							return (
								<button
									key={row.key}
									type="button"
									role="option"
									aria-selected={selected}
									data-active={index === cursor}
									className={`${ROW} ${selected ? "" : index === cursor ? "bg-hover" : ""}`}
									style={selected ? { backgroundColor: "var(--selected)" } : undefined}
									onMouseMove={() => setActive(index)}
									onClick={() => props.onPick(row)}
								>
									<ProviderMark provider={row.provider} size={13} className="text-ink-soft" />
									<span className={`truncate font-sans text-[12.5px] text-ink ${selected ? "font-medium" : ""}`}>{row.name}</span>
									{row.contextWindow === undefined && row.cost === undefined ? null : (
										<span className="shrink-0 font-mono text-[10.5px] text-muted tabular-nums">
											{[sizeOf(row.contextWindow), priceOf(row.cost)].filter((part) => part !== "—").join(" · ")}
										</span>
									)}
								</button>
							);
						})}
					</div>
				))}
			</div>
			{props.efforts === undefined || props.efforts.length === 0 ? null : (
				<div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
					<span className={LABEL}>effort</span>
					<div className="ml-auto inline-flex items-center gap-px rounded-[7px] bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] p-0.5">
						{props.efforts.map((level) => (
							<button
								key={level}
								type="button"
								aria-pressed={level === props.effort}
								className={`h-[22px] cursor-pointer rounded-[5px] border-0 bg-transparent px-[7px] font-mono text-[10.5px] transition-colors duration-100 motion-reduce:transition-none ${
									level === props.effort ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:text-ink"
								}`}
								onClick={() => props.onEffort?.(level)}
							>
								{level}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
