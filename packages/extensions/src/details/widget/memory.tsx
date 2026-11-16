import { ChevronRight } from "lucide-react";

import type { MemorySummary } from "../../memory/snapshot.ts";
import { CARD, EYEBROW, SUMMARY } from "../chrome.ts";
import { Skeleton } from "./skeleton.tsx";

export function MemorySection(props: { memory: MemorySummary | null; loading?: boolean; onOpen: () => void }) {
	const memory = props.memory;

	const line = (() => {
		if (!memory) return props.loading ? <Skeleton width={150} height={10} /> : "—";
		if (memory.active === 0 && memory.sops === 0 && memory.personaRev === null) return "nothing remembered yet";
		const parts = [`${memory.active} ${memory.active === 1 ? "memory" : "memories"}`];
		if (memory.sops > 0) parts.push(`${memory.sops} SOPs`);
		if (memory.personaRev !== null) parts.push(`persona rev ${memory.personaRev}`);
		return parts.join(" · ");
	})();

	return (
		<section className={CARD}>
			<button
				type="button"
				className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2.5 text-left hover:bg-hover"
				onClick={props.onOpen}
				title="Open memory"
			>
				<span className={EYEBROW}>Memory</span>
				<span className={SUMMARY}>{line}</span>
				{memory && memory.conflicts > 0 ? <span className="shrink-0 font-mono text-[10px] text-signal">{memory.conflicts} conflicting</span> : null}
				{memory && memory.truncated > 0 ? <span className="shrink-0 font-mono text-[10px] text-muted-soft">{memory.truncated} truncated</span> : null}
				{memory?.pending.pending ? <span className="shrink-0 font-mono text-[10px] text-muted">{memory.pending.rounds} rounds queued</span> : null}
				<ChevronRight size={14} className="shrink-0 text-muted-soft" />
			</button>
		</section>
	);
}
