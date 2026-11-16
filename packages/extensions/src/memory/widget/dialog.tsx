import { LOG_EVENTS } from "@milu/protocol";
import type { DialogProps } from "@milu/window/api";
import { useCallback, useEffect, useState } from "react";

import type { MemorySnapshot } from "../snapshot.ts";
import type { MemoryTrace } from "../store.ts";
import { ActivityPane } from "./activity.tsx";
import { AtomsPane } from "./atoms.tsx";
import { DocsPane } from "./docs.tsx";
import { RunsPane } from "./runs.tsx";

export interface MemoryDialogData {
	readonly partner: string;
}

const TABS = [
	{ id: "atoms", label: "atoms" },
	{ id: "docs", label: "SOPs & persona" },
	{ id: "runs", label: "runs" },
	{ id: "activity", label: "activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB = "flex cursor-pointer items-center gap-1.5 border-b-[1.5px] bg-transparent px-2 font-mono text-[10px] tracking-[0.06em] uppercase";
const BUTTON = "inline-flex h-[22px] shrink-0 cursor-pointer items-center rounded-[4px] border-[0.5px] px-2 font-mono text-[10px] tracking-[0.04em]";

export default function MemoryDialog(props: DialogProps) {
	const data = props.data as Partial<MemoryDialogData> | undefined;
	const partner = data?.partner ?? null;
	const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<TabId>("atoms");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		if (!partner) return;
		try {
			const next = await props.host.actions.request<MemorySnapshot>("memory.collect", partner);
			if (next) setSnapshot(next);
			setError(null);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	}, [partner, props.host]);

	useEffect(() => {
		if (!partner) return;
		let cancelled = false;
		void props.host.actions
			.request<MemorySnapshot>("memory.collect", partner)
			.then((next) => {
				if (!cancelled && next) setSnapshot(next);
			})
			.catch((failure: unknown) => {
				if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
			});
		return () => {
			cancelled = true;
		};
	}, [partner, props.host]);

	useEffect(() => {
		if (!partner) return;
		const subscription = props.host.connection.onEntry(({ session, entry }) => {
			if (session !== partner) return;
			const record = entry.entry;
			if (record.type !== "custom") return;
			if (record.customType !== LOG_EVENTS.memoryRunStart && record.customType !== LOG_EVENTS.memoryRunEnd) return;
			void load();
		});
		return () => subscription.dispose();
	}, [partner, props.host, load]);

	const loadTrace = useCallback(
		async (runId: string): Promise<MemoryTrace | null> => {
			if (!partner) return null;
			try {
				const next = await props.host.actions.request<MemoryTrace>("memory.transcript", partner, runId);
				setError(null);
				return next ?? null;
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : String(failure));
				return null;
			}
		},
		[partner, props.host],
	);

	const organize = async () => {
		if (!partner || busy) return;
		setBusy(true);
		try {
			await props.host.actions.invoke("memory.run", partner, "organize");
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const running = snapshot?.running[0] ?? null;
	const counts: Record<string, number | null> = snapshot
		? {
				atoms: snapshot.counts.active,
				docs: snapshot.sops.length + (snapshot.persona === null ? 0 : 1),
				runs: snapshot.runsTotal,
				activity: null,
			}
		: { atoms: 0, docs: 0, runs: 0, activity: null };

	const state = running ? `${running.stage} · running` : snapshot?.enabled === false ? "off" : snapshot?.pending.pending ? `${snapshot.pending.rounds} rounds queued` : "idle";

	return (
		<div className="flex h-[min(700px,calc(100vh-48px))] w-[min(960px,calc(100vw-48px))] flex-col overflow-hidden rounded-[10px] border border-line-strong bg-canvas font-sans text-ink">
			<header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b-[0.5px] border-line pr-12 pl-5">
				<span className="grid size-7 shrink-0 place-items-center rounded-[5px] bg-ink text-[14px] leading-none font-bold text-canvas">
					{(partner ?? "?").trim().charAt(0).toUpperCase() || "?"}
				</span>
				<div className="flex min-w-0 flex-col">
					<p className="m-0 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Memory</p>
					<h1 className="m-0 text-[15px] leading-[1.25] font-semibold text-ink">{partner ?? "unknown"}</h1>
				</div>
				<span className="flex-1" />
				<span
					className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[4px] border-[0.5px] border-line px-[7px] font-mono text-[10px] tracking-[0.04em] tabular-nums ${
						running ? "text-ink-soft" : "text-muted"
					}`}
				>
					<span className={`size-[5px] rounded-full ${running ? "animate-pulse bg-accent-teal" : snapshot?.pending.pending ? "bg-accent-amber" : "bg-line-strong"}`} />
					{state}
				</span>
				<button type="button" className={`${BUTTON} border-line bg-transparent text-ink-soft hover:border-line-strong hover:bg-hover hover:text-ink`} onClick={() => void load()}>
					Refresh
				</button>
				<button
					type="button"
					disabled={busy || running !== null}
					className={`${BUTTON} border-ink bg-ink text-canvas hover:border-ink-soft hover:bg-ink-soft disabled:cursor-default disabled:opacity-45`}
					onClick={() => void organize()}
				>
					{busy ? "organizing…" : "Organize now"}
				</button>
			</header>

			<nav className="flex h-[34px] shrink-0 items-stretch gap-0.5 border-b-[0.5px] border-line px-5">
				{TABS.map((entry) => {
					const selected = entry.id === tab;
					return (
						<button
							type="button"
							key={entry.id}
							aria-selected={selected}
							onClick={() => setTab(entry.id)}
							className={`${TAB} -mb-px ${selected ? "border-b-ink text-ink" : "border-b-transparent text-muted hover:text-ink"}`}
						>
							{entry.label}
							{counts[entry.id] === null ? null : <span className={`tabular-nums ${selected ? "text-ink-soft" : "text-muted-soft"}`}>{counts[entry.id]}</span>}
						</button>
					);
				})}
			</nav>

			{error ? (
				<p className="mx-5 mt-2 rounded-[4px] border-[0.5px] border-[color-mix(in_srgb,var(--signal)_40%,transparent)] px-2 py-1.5 font-mono text-[10px] text-signal">{error}</p>
			) : null}

			{snapshot === null ? (
				<div className="flex flex-1 items-center justify-center font-mono text-[10px] text-muted" aria-busy="true">
					reading memory…
				</div>
			) : tab === "atoms" ? (
				<AtomsPane snapshot={snapshot} />
			) : tab === "docs" ? (
				<DocsPane snapshot={snapshot} />
			) : tab === "runs" ? (
				<RunsPane host={props.host} snapshot={snapshot} loadTrace={loadTrace} />
			) : (
				<ActivityPane snapshot={snapshot} />
			)}
		</div>
	);
}
