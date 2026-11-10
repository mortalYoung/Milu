import { composerDataKey } from "@milu/protocol";
import { useComposerData, type WidgetProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { ProviderMark } from "../../provider-marks.tsx";
import type { ModelWidgetData } from "../index.ts";

const PANEL =
	"z-50 w-[344px] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_color-mix(in_srgb,var(--ink)_14%,transparent)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.23,1,0.32,1)_both] data-[state=closed]:animate-[menu-out_120ms_cubic-bezier(0.23,1,0.32,1)_both] motion-reduce:animate-none";
const ROW =
	"grid h-8 w-full cursor-pointer grid-cols-[12px_14px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-[6px] px-2 text-left transition-colors duration-100 motion-reduce:transition-none";
const LABEL = "font-mono text-[9px] tracking-[0.14em] text-muted-soft uppercase";

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

interface Row {
	readonly key: string;
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly contextWindow?: number;
	readonly cost?: { readonly input: number; readonly output: number };
}

function sizeOf(value: number | undefined): string {
	if (value === undefined) return "—";
	if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`.replace(".0M", "M");
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

function priceOf(cost: Row["cost"]): string {
	return cost === undefined ? "—" : `$${cost.input}/${cost.output}`;
}

function ModelsPlaceholder(props: { readonly error: boolean }) {
	const label = props.error ? "Model unavailable" : "Loading model";
	return (
		<Tip label={label}>
			<span className="grid h-[26px] w-[26px] shrink-0 place-items-center" aria-busy={props.error ? undefined : true} aria-label={label}>
				<span className={`size-[14px] rounded-full border-2 ${props.error ? "border-dashed border-line" : "animate-pulse border-line motion-reduce:animate-none"}`} />
			</span>
		</Tip>
	);
}

export function ModelsWidget(props: WidgetProps) {
	const { data, status } = useComposerData<ModelWidgetData | null>(props.host, composerDataKey("composer.right", "models"));
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement | null>(null);
	const [list, fade] = useBottomFade();

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => input.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open]);

	const rows = useMemo<Row[]>(() => {
		if (!data) return [];
		return data.groups.flatMap((group) => group.models.map((model) => ({ key: `${group.provider}:${model.id}`, provider: group.provider, ...model })));
	}, [data]);

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (needle === "") return rows;
		return rows.filter((row) => `${row.name} ${row.id} ${row.provider}`.toLowerCase().includes(needle));
	}, [rows, query]);

	const sections = useMemo(() => {
		const out: { label: string; rows: Row[] }[] = [];
		for (const row of visible) {
			const last = out.at(-1);
			if (last === undefined || last.label !== row.provider) out.push({ label: row.provider, rows: [row] });
			else last.rows.push(row);
		}
		return out;
	}, [visible]);

	const flat = useMemo(() => sections.flatMap((section) => section.rows), [sections]);

	if (!data) {
		if (status === "ready") return null;
		return <ModelsPlaceholder error={status === "error"} />;
	}

	const { host } = props;

	const choose = async (args: unknown): Promise<void> => {
		const session = host.selection.store.getState().selected;
		await host.actions.invoke(args && typeof args === "object" && "level" in args ? "model.effort" : "model.set", session, args);
		await host.sessions.refresh();
		await host.composerData.refresh(session);
	};

	const pick = (row: Row): void => {
		setOpen(false);
		void choose({ provider: row.provider, modelId: row.id });
	};

	const cursor = Math.min(active, Math.max(0, flat.length - 1));
	const resolved = data.resolved;
	const current = resolved === null ? "pick a model" : data.label;

	return (
		<Popover.Root
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setQuery("");
					setActive(0);
				}
				setOpen(next);
			}}
		>
			<Popover.Trigger asChild>
				<button
					type="button"
					aria-label={resolved === null ? "Pick a model" : `Model ${data.label}, effort ${data.effort}`}
					className="inline-flex h-[26px] max-w-[240px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2 text-muted-soft transition-colors duration-100 hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink motion-reduce:transition-none"
				>
					{resolved === null ? null : <ProviderMark provider={resolved.provider} size={13} className="text-ink-soft" />}
					<span className={`truncate font-mono text-[11px] ${resolved === null ? "text-muted-soft" : "text-ink-soft"}`}>{current}</span>
					{resolved === null || data.effort === "" ? null : <span className="shrink-0 font-mono text-[11px] text-muted">· {data.effort}</span>}
					<ChevronDown size={11} className={`shrink-0 opacity-45 transition-transform duration-100 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					align="end"
					sideOffset={8}
					collisionPadding={8}
					className={PANEL}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						input.current?.focus();
					}}
					onKeyDown={(event) => {
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
							pick(row);
						}
					}}
				>
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
									const selected = resolved !== null && resolved.provider === row.provider && resolved.modelId === row.id;
									const index = flat.indexOf(row);
									return (
										<button
											key={row.key}
											type="button"
											role="option"
											aria-selected={selected}
											data-active={index === cursor}
											className={`${ROW} ${index === cursor ? "bg-selected" : "hover:bg-hover"}`}
											onMouseMove={() => setActive(index)}
											onClick={() => pick(row)}
										>
											<span className="grid place-items-center text-ink">{selected ? <Check size={12} /> : null}</span>
											<ProviderMark provider={row.provider} size={13} className="text-ink-soft" />
											<span className="truncate font-sans text-[12.5px] text-ink">{row.name}</span>
											<span className="shrink-0 font-mono text-[10.5px] text-muted tabular-nums">
												{sizeOf(row.contextWindow)} · {priceOf(row.cost)}
											</span>
										</button>
									);
								})}
							</div>
						))}
					</div>
					{data.efforts.length === 0 ? null : (
						<div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
							<span className={LABEL}>effort</span>
							<div className="ml-auto inline-flex items-center gap-px rounded-[7px] bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] p-0.5">
								{data.efforts.map((level) => (
									<button
										key={level}
										type="button"
										aria-pressed={level === data.effort}
										className={`h-[22px] cursor-pointer rounded-[5px] border-0 bg-transparent px-[7px] font-mono text-[10.5px] transition-colors duration-100 motion-reduce:transition-none ${
											level === data.effort ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:text-ink"
										}`}
										onClick={() => void choose({ level })}
									>
										{level}
									</button>
								))}
							</div>
						</div>
					)}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

export default ModelsWidget;
