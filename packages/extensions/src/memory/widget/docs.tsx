import { useState } from "react";

import type { MemorySnapshot, MemorySnapshotSop } from "../snapshot.ts";

const SECT_LABEL = "m-0 h-4 text-[9px] font-semibold tracking-[0.12em] text-muted uppercase";
const SECT = "m-0 text-[9px] font-semibold tracking-[0.12em] text-muted uppercase";
const PROSE = "m-0 font-sans text-[12px] leading-[1.65] text-ink-soft whitespace-pre-wrap [overflow-wrap:anywhere]";

function Reader(props: { sop: MemorySnapshotSop }) {
	const { sop } = props;
	return (
		<div className="min-h-0 flex-1 overflow-y-auto rounded-[5px] border-[0.5px] border-line bg-surface px-3.5 pt-2.5 pb-4 [scrollbar-gutter:stable]">
			<h3 className="m-0 font-serif text-[18px] leading-[1.25] font-medium text-ink">{sop.title}</h3>
			<p className="mt-px mb-2 flex flex-wrap gap-2 font-mono text-[9px] tabular-nums text-muted">
				<span>{sop.id}</span>
				<span>rev {sop.rev}</span>
				<span>confidence {sop.confidence.toFixed(2)}</span>
				<span>updated {sop.updated}</span>
				<span>{sop.sources.length} sources</span>
			</p>
			<p className={SECT}>Purpose</p>
			<p className={PROSE}>{sop.purpose || "—"}</p>
			<p className={`${SECT} mt-2.5`}>When</p>
			<p className={PROSE}>{sop.when || "—"}</p>
			<p className={`${SECT} mt-2.5`}>Procedure</p>
			<p className={PROSE}>{sop.procedure || "—"}</p>
			<p className={`${SECT} mt-2.5`}>Checklist</p>
			<p className={PROSE}>{sop.checklist || "—"}</p>
			<p className={`${SECT} mt-2.5`}>Pitfalls</p>
			<p className={PROSE}>{sop.pitfalls || "—"}</p>
			<p className={`${SECT} mt-2.5`}>Evidence</p>
			{sop.evidence.length === 0 ? (
				<p className={PROSE}>—</p>
			) : (
				<div className="font-mono text-[9px] tabular-nums text-muted">
					{sop.evidence.map((item) => (
						<div className="flex gap-2 border-b-[0.5px] border-[color-mix(in_srgb,var(--line)_60%,transparent)] py-px" key={item.atomId}>
							<span className="w-[82px] shrink-0 text-link">{item.atomId}</span>
							<span className="shrink-0">{item.date}</span>
							<span className="min-w-0 [overflow-wrap:anywhere]">{item.note}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Persona(props: { persona: NonNullable<MemorySnapshot["persona"]> }) {
	return (
		<div className="rounded-[5px] border-[0.5px] border-line bg-surface px-2.5 py-2">
			<p className="m-0 font-mono text-[9px] tabular-nums text-muted">
				rev {props.persona.rev} · updated {props.persona.updated} · {props.persona.sources.length} entries
			</p>
			<p className="mt-1.5 mb-0 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Relationship</p>
			<p className="mt-1 mb-0 font-sans text-[11px] leading-[1.6] text-ink-soft whitespace-pre-wrap [overflow-wrap:anywhere]">{props.persona.relationship || "—"}</p>
			<p className="mt-1.5 mb-0 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Taste</p>
			<p className="mt-1 mb-0 font-sans text-[11px] leading-[1.6] text-ink-soft whitespace-pre-wrap [overflow-wrap:anywhere]">{props.persona.taste || "—"}</p>
		</div>
	);
}

export function DocsPane(props: { snapshot: MemorySnapshot }) {
	const [picked, setPicked] = useState<string | null>(null);
	const fallback = props.snapshot.sops[0]?.id ?? null;
	const active = props.snapshot.sops.find((sop) => sop.id === (picked ?? fallback)) ?? null;

	return (
		<div className="grid min-h-0 flex-1 grid-cols-[288px_minmax(0,1fr)] gap-2.5 px-5 pt-2.5 pb-3.5">
			<div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto [scrollbar-gutter:stable]">
				<p className={SECT_LABEL}>
					SOPs · {props.snapshot.sops.length} of {props.snapshot.limits.maxSops}
				</p>
				{props.snapshot.sops.length === 0 ? (
					<p className="m-0 font-mono text-[10px] text-muted">no SOPs yet</p>
				) : (
					<div className="flex flex-col">
						{props.snapshot.sops.map((sop) => {
							const selected = active?.id === sop.id;
							return (
								<button
									type="button"
									key={sop.id}
									aria-current={selected ? "true" : undefined}
									onClick={() => setPicked(sop.id)}
									className={`flex h-10 w-full cursor-pointer items-center gap-2 border-l-2 bg-transparent px-2 text-left ${
										selected ? "border-l-ink bg-hover" : "border-l-transparent hover:bg-hover"
									}`}
								>
									<span className={`min-w-0 flex-1 truncate font-sans text-[12px] ${selected ? "text-ink" : "text-ink-soft"}`}>{sop.title}</span>
									<span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-soft">rev {sop.rev}</span>
								</button>
							);
						})}
					</div>
				)}
				<p className={`${SECT_LABEL} mt-2`}>Persona</p>
				{props.snapshot.persona ? <Persona persona={props.snapshot.persona} /> : <p className="m-0 font-mono text-[10px] text-muted">no persona yet</p>}
			</div>
			{active ? (
				<Reader sop={active} />
			) : (
				<div className="grid min-h-0 flex-1 place-items-center rounded-[5px] border-[0.5px] border-line bg-surface font-mono text-[10px] text-muted">no SOP selected</div>
			)}
		</div>
	);
}
