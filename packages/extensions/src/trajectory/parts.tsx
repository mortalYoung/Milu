import type { TrajectoryDetail, TrajectoryTone } from "./model.ts";

export const CHIP_TONE: Partial<Record<TrajectoryTone, string>> = { system: "text-ink", change: "text-ink-soft", custom: "text-ink-soft", plain: "text-muted" };
export const CAPTION_TONE: Partial<Record<TrajectoryTone, string>> = { change: "text-ink-soft", compact: "text-ink-soft", custom: "text-ink-soft", plain: "text-ink-soft" };

export function Detail(props: { detail: TrajectoryDetail }) {
	const { detail } = props;
	const label = detail.label !== undefined && detail.label !== "" ? detail.label : null;
	const description = detail.description !== undefined && detail.description !== "" ? detail.description : null;
	const facts = detail.meta ?? [];
	const head =
		label !== null ? (
			<div className="mt-2 flex flex-col gap-1.5">
				<span className="font-mono text-[10px] text-ink-soft">{label}</span>
				{description !== null ? <span className="truncate font-mono text-[10px] text-muted">{description}</span> : null}
			</div>
		) : description !== null ? (
			<div className="mt-2 font-mono text-[10px] text-muted">{description}</div>
		) : null;
	const factsLine =
		facts.length > 0 ? (
			<div className={`mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[10px] ${detail.error ? "text-signal" : "text-muted"}`}>
				{facts.map((fact) => (
					<span key={fact}>{fact}</span>
				))}
			</div>
		) : null;
	const content = detail.content;

	if (content === undefined) {
		return (
			<>
				{head}
				{factsLine}
			</>
		);
	}
	if (content.kind === "text") {
		return (
			<>
				<div
					className={`mt-2 max-h-[220px] overflow-y-auto border-l-2 border-line pl-2.5 font-serif text-[14px] leading-[1.6] whitespace-pre-wrap ${detail.error ? "text-signal" : "text-ink-soft"}`}
				>
					{content.value}
				</div>
				{factsLine}
			</>
		);
	}
	return (
		<>
			{head}
			{factsLine}
			<pre
				className={`mt-2 max-h-[140px] overflow-auto rounded-[4px] border px-2 py-1.5 font-mono text-[10px] leading-[1.6] break-words whitespace-pre-wrap ${
					detail.error ? "border-signal/60 text-signal" : "border-line text-ink-soft"
				}`}
			>
				{content.value}
			</pre>
		</>
	);
}
