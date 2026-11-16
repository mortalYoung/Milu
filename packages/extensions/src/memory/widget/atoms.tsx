import { useRef, useState, type ReactNode } from "react";

import { whenOf } from "../format.ts";
import type { MemorySnapshot, MemorySnapshotAtom } from "../snapshot.ts";
import type { MemoryKind, MemoryValue } from "../store.ts";

const KINDS: readonly MemoryKind[] = ["attribute", "preference", "event", "instruction", "reference", "update"];

const KIND_CHROME: Readonly<Record<MemoryKind, string>> = {
	attribute: "text-accent-teal border-[color-mix(in_srgb,var(--accent-teal)_38%,transparent)]",
	preference: "text-accent-amber border-[color-mix(in_srgb,var(--accent-amber)_45%,transparent)]",
	event: "text-link border-[color-mix(in_srgb,var(--link)_40%,transparent)]",
	instruction: "text-ink-soft border-line-strong",
	reference: "text-muted border-line",
	update: "text-signal border-[color-mix(in_srgb,var(--signal)_38%,transparent)]",
};

const CHUNK = 40;

const LIST = "flex flex-col overflow-hidden rounded-[5px] border-[0.5px] border-line bg-surface [&>div+div]:border-t-[0.5px] [&>div+div]:border-line";

function isSuperseded(atom: MemorySnapshotAtom): boolean {
	return atom.status === "superseded";
}

function textOf(value: MemoryValue | undefined): string {
	if (value === undefined) return "—";
	return String(value);
}

function headlineOf(atom: MemorySnapshotAtom): ReactNode {
	const facet = atom.facet;
	if (facet === undefined) return null;
	const subject = facet.subject ?? "";
	const predicate = facet.predicate ?? "";
	if (facet.old !== undefined || facet.next !== undefined) {
		return (
			<>
				<span className="text-muted">
					{subject}.{predicate}
				</span>
				<span className="px-1 text-muted-soft">→</span>
				<span className="text-muted line-through">{textOf(facet.old)}</span>
				<span className="px-1 text-muted-soft">→</span>
				<span>{textOf(facet.next)}</span>
			</>
		);
	}
	if (facet.value !== undefined) {
		return (
			<>
				<span className="text-muted">
					{subject}.{predicate}
				</span>
				<span className="px-1 text-muted-soft">=</span>
				<span>{textOf(facet.value)}</span>
			</>
		);
	}
	if (facet.direction !== undefined) {
		return (
			<>
				<span className="text-muted">
					{subject}.{predicate}
				</span>
				<span className="px-1 text-muted-soft">·</span>
				<span>{facet.direction === "prefer" ? "prefers" : "avoids"}</span>
				{facet.scope ? (
					<>
						<span className="px-1 text-muted-soft">·</span>
						<span className="text-muted">{facet.scope}</span>
					</>
				) : null}
			</>
		);
	}
	if (subject || predicate) return <span className="text-muted">{`${subject}${subject && predicate ? "." : ""}${predicate}`}</span>;
	return null;
}

function factsOf(atom: MemorySnapshotAtom): readonly (readonly [string, ReactNode])[] {
	const facet = atom.facet;
	const rows: Array<readonly [string, ReactNode]> = [];
	if (facet?.subject !== undefined) rows.push(["about", `${facet.subject}${facet.predicate === undefined ? "" : `.${facet.predicate}`}`]);
	if (facet?.value !== undefined) rows.push(["value", textOf(facet.value)]);
	if (facet?.direction !== undefined) rows.push(["preference", facet.direction === "prefer" ? "prefers" : "avoids"]);
	if (facet?.scope !== undefined) rows.push(["scope", facet.scope]);
	if (facet?.appliesTo !== undefined) rows.push(["applies to", facet.appliesTo]);
	if (facet?.old !== undefined || facet?.next !== undefined) {
		rows.push([
			"changed",
			<span className="flex flex-wrap items-baseline gap-1" key="changed">
				<span className="text-muted line-through">{textOf(facet.old)}</span>
				<span className="text-muted-soft">→</span>
				<span>{textOf(facet.next)}</span>
			</span>,
		]);
	}
	if (atom.fact?.provider !== undefined || atom.fact?.outcome !== undefined) {
		rows.push(["who", `${atom.fact?.provider ?? "—"} · ${atom.fact?.outcome ?? "—"}`]);
	}
	if (atom.supersedes !== undefined)
		rows.push([
			"replaces",
			<span className="text-link" key="replaces">
				{atom.supersedes}
			</span>,
		]);
	if (atom.supersededBy.length > 0)
		rows.push([
			"replaced by",
			<span className="text-link" key="replaced-by">
				{atom.supersededBy.join(" · ")}
			</span>,
		]);
	rows.push(["from", `${atom.sources.count} ${atom.sources.count === 1 ? "entry" : "entries"} · ${atom.sources.rawIds.join(" ")}`]);
	return rows;
}

function AtomDetail(props: { atom: MemorySnapshotAtom; recallLimit: number }) {
	return (
		<div className="flex flex-col gap-1.5 pt-2 pr-[9px] pb-3 pl-[91px]">
			<p className="m-0 font-sans text-[12px] leading-[1.65] text-ink-soft whitespace-pre-wrap [overflow-wrap:anywhere]">{props.atom.detail ?? "—"}</p>
			<dl className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-2.5 gap-y-px font-mono text-[10px]">
				{factsOf(props.atom).map(([label, value]) => (
					<div className="contents" key={label}>
						<dt className="m-0 text-muted">{label}</dt>
						<dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-ink-soft">{value}</dd>
					</div>
				))}
			</dl>
			{props.atom.overRecallCap ? (
				<p className="m-0 font-mono text-[9px] uppercase tracking-[0.04em] text-signal">the agent recalls only the first {props.recallLimit} chars of this</p>
			) : null}
		</div>
	);
}

function Conflicts(props: { conflicts: MemorySnapshot["conflicts"] }) {
	const [open, setOpen] = useState(false);
	if (props.conflicts.length === 0) return null;
	const first = props.conflicts[0];
	if (!first) return null;
	return (
		<div className="mx-5 mt-2.5 rounded-[5px] border-[0.5px] border-[color-mix(in_srgb,var(--signal)_38%,transparent)] bg-[color-mix(in_srgb,var(--signal)_5%,transparent)]">
			<button
				type="button"
				className="flex h-7 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-[9px] text-left font-mono text-[10px] text-muted"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				<span className="inline-flex h-[15px] items-center rounded-[3px] border-[0.5px] border-[color-mix(in_srgb,var(--signal)_40%,transparent)] px-1 text-[9px] tracking-[0.06em] text-signal uppercase">
					unsettled
				</span>
				<span className="text-ink-soft">
					{first.subject}.{first.predicate}
				</span>
				{props.conflicts.length > 1 ? <span>+{props.conflicts.length - 1}</span> : null}
				<span className="flex-1" />
				<span>{first.values.length} values · no update chain</span>
			</button>
			{open ? (
				<div className="flex flex-col gap-1 px-[9px] pb-2 font-mono text-[10px] text-ink-soft">
					{props.conflicts.map((conflict) => (
						<div key={`${conflict.subject}.${conflict.predicate}`}>
							<span className="text-ink">
								{conflict.subject}.{conflict.predicate}
							</span>
							{conflict.values.map((value, index) => (
								<span key={`${conflict.ids[index] ?? index}`}>
									<span className="px-1 text-muted-soft">/</span>
									<span className="text-ink">{textOf(value)}</span>
									<span className="text-muted-soft"> ({conflict.ids[index] ?? "?"})</span>
								</span>
							))}
						</div>
					))}
					<span className="text-muted">the agent treats these as unsettled until an update settles them</span>
				</div>
			) : null}
		</div>
	);
}

function Toolbar(props: {
	atoms: readonly MemorySnapshotAtom[];
	kinds: ReadonlySet<MemoryKind>;
	query: string;
	showSuperseded: boolean;
	onKinds: (next: ReadonlySet<MemoryKind>) => void;
	onQuery: (next: string) => void;
	onSuperseded: (next: boolean) => void;
}) {
	const counts = new Map<MemoryKind, number>();
	for (const atom of props.atoms) if (atom.status !== "superseded") counts.set(atom.kind, (counts.get(atom.kind) ?? 0) + 1);
	return (
		<div className="flex h-9 shrink-0 items-center gap-1.5 px-5">
			{KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => {
				const pressed = props.kinds.has(kind);
				return (
					<button
						type="button"
						key={kind}
						aria-pressed={pressed}
						onClick={() => {
							const next = new Set(props.kinds);
							if (pressed) next.delete(kind);
							else next.add(kind);
							props.onKinds(next);
						}}
						className={`inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[3px] border-[0.5px] px-1 font-mono text-[9px] tracking-[0.04em] uppercase ${
							pressed ? "border-ink bg-ink text-canvas" : "border-line bg-transparent text-muted hover:border-line-strong hover:text-ink"
						}`}
					>
						{kind}
						<span className={pressed ? "text-[color-mix(in_srgb,var(--canvas)_70%,transparent)] tabular-nums" : "text-muted-soft tabular-nums"}>{counts.get(kind) ?? 0}</span>
					</button>
				);
			})}
			<input
				className="h-5 min-w-20 flex-1 border-b-[0.5px] border-line bg-transparent px-0.5 font-mono text-[11px] text-ink outline-none placeholder:text-muted-soft focus:border-line-strong"
				placeholder="search"
				aria-label="search memories"
				value={props.query}
				onChange={(event) => props.onQuery(event.target.value)}
			/>
			<button
				type="button"
				aria-pressed={props.showSuperseded}
				onClick={() => props.onSuperseded(!props.showSuperseded)}
				className={`inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[3px] border-[0.5px] px-1 font-mono text-[9px] tracking-[0.04em] uppercase ${
					props.showSuperseded ? "border-line-strong text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
				}`}
			>
				<span
					className={`grid size-2 place-items-center rounded-[2px] border-[0.5px] text-[7px] leading-none ${
						props.showSuperseded ? "border-ink bg-ink text-canvas" : "border-line-strong text-transparent"
					}`}
				>
					✓
				</span>
				replaced
			</button>
		</div>
	);
}

export function AtomsPane(props: { snapshot: MemorySnapshot }) {
	const [kinds, setKinds] = useState<ReadonlySet<MemoryKind>>(new Set());
	const [query, setQuery] = useState("");
	const [showSuperseded, setShowSuperseded] = useState(false);
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [limit, setLimit] = useState(CHUNK);

	const list = useRef<HTMLDivElement>(null);
	const needle = query.trim().toLowerCase();
	const hiddenByKind = kinds.size > 0;
	const filtered = props.snapshot.atoms.filter((atom) => {
		if (isSuperseded(atom) && !showSuperseded) return false;
		if (hiddenByKind && !kinds.has(atom.kind)) return false;
		if (!needle) return true;
		const haystack = `${atom.summary} ${atom.detail ?? ""} ${atom.facet?.subject ?? ""} ${atom.facet?.predicate ?? ""}`.toLowerCase();
		return haystack.includes(needle);
	});
	const replaced = props.snapshot.atoms.filter(isSuperseded).length;
	const rows = filtered.slice(0, limit);
	const hidden = filtered.length - rows.length;

	const reset = () => {
		setLimit(CHUNK);
		list.current?.scrollTo({ top: 0 });
	};

	const toggle = (id: string) => {
		const next = new Set(open);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setOpen(next);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Conflicts conflicts={props.snapshot.conflicts} />
			<Toolbar
				atoms={props.snapshot.atoms}
				kinds={kinds}
				query={query}
				showSuperseded={showSuperseded}
				onKinds={(next) => {
					setKinds(next);
					reset();
				}}
				onQuery={(next) => {
					setQuery(next);
					reset();
				}}
				onSuperseded={(next) => {
					setShowSuperseded(next);
					reset();
				}}
			/>
			<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 [scrollbar-gutter:stable]" ref={list}>
				{rows.length === 0 ? (
					<p className="py-5 text-center font-mono text-[10px] text-muted">{needle || hiddenByKind ? "nothing matches" : "nothing remembered yet"}</p>
				) : (
					<div className={LIST}>
						{rows.map((atom) => {
							const isOpen = open.has(atom.id);
							const headline = headlineOf(atom);
							return (
								<div key={atom.id}>
									<button
										type="button"
										aria-expanded={isOpen}
										onClick={() => toggle(atom.id)}
										className="flex h-11 w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-[9px] text-left hover:bg-hover"
									>
										<span
											className={`inline-flex h-4 w-[72px] shrink-0 items-center justify-center rounded-[3px] border-[0.5px] font-mono text-[9px] leading-none tracking-[0.04em] uppercase ${
												KIND_CHROME[atom.kind]
											} ${isSuperseded(atom) ? "opacity-50" : ""}`}
										>
											{atom.kind}
										</span>
										<span className="flex min-w-0 flex-1 flex-col justify-center">
											{headline === null ? (
												<span className="truncate font-mono text-[11px] leading-[15px] text-ink">{atom.summary}</span>
											) : (
												<>
													<span className="truncate font-mono text-[11px] leading-[15px] text-ink">{headline}</span>
													<span className="truncate font-sans text-[11px] leading-[15px] text-muted">{atom.summary}</span>
												</>
											)}
										</span>
										<span className="w-[62px] shrink-0 text-right font-mono text-[9px] tracking-[0.04em] text-muted-soft uppercase">{atom.overRecallCap ? "truncated" : ""}</span>
										<span className="w-[38px] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-soft">{whenOf(atom.eventAt)}</span>
										<span className={`size-[5px] shrink-0 border-r border-b border-muted-soft ${isOpen ? "rotate-45" : "-rotate-45"}`} aria-hidden="true" />
									</button>
									{isOpen ? <AtomDetail atom={atom} recallLimit={props.snapshot.limits.recallDetail} /> : null}
								</div>
							);
						})}
					</div>
				)}
				{hidden > 0 ? (
					<button
						type="button"
						className="mt-1 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[5px] border-[0.5px] border-line bg-transparent font-mono text-[10px] text-muted hover:border-line-strong hover:bg-hover hover:text-ink"
						onClick={() => setLimit(limit + CHUNK)}
					>
						show {Math.min(CHUNK, hidden)} more
						<span className="text-muted-soft tabular-nums">· {hidden} left</span>
					</button>
				) : null}
			</div>
			<div className="flex h-7 shrink-0 items-center gap-2 px-5 font-mono text-[10px] text-muted">
				{replaced === 0 ? null : (
					<button
						type="button"
						className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
						onClick={() => {
							setShowSuperseded(!showSuperseded);
							reset();
						}}
					>
						{showSuperseded ? `hide ${replaced} replaced` : `${replaced} replaced · show`}
					</button>
				)}
				<span className="flex-1" />
				{filtered.length === 0 ? null : (
					<span className={hidden > 0 ? "text-muted-soft tabular-nums" : "tabular-nums"}>
						{rows.length} of {filtered.length}
					</span>
				)}
			</div>
		</div>
	);
}
