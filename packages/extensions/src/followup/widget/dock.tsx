import type { FollowUpItem } from "@milu/protocol";
import type { SlotProps } from "@milu/window/api";
import { Trash } from "lucide-react";
import { useEffect, useState } from "react";

interface FollowUpData {
	readonly session?: string;
}

const SOURCE: Record<FollowUpItem["source"], string> = { you: "", scheduled: "scheduled", peer: "peer", skill: "skill" };

export function FollowUpDock(props: SlotProps) {
	const session = (props.data as FollowUpData | null)?.session ?? "";
	const [queued, setQueued] = useState<{ readonly session: string; readonly items: readonly FollowUpItem[] }>({ session: "", items: [] });
	const [busy, setBusy] = useState<string | null>(null);
	const items = queued.session === session ? queued.items : [];

	useEffect(() => {
		if (!session) return;
		let live = true;
		const subscription = props.host.connection.onLive((event) => {
			if (event.type === "followup" && event.session === session) setQueued({ session, items: event.items });
		});
		void props.host.actions
			.request<{ items: readonly FollowUpItem[] }>("followup.list", session)
			.then((result) => {
				if (live) setQueued({ session, items: result?.items ?? [] });
			})
			.catch(() => undefined);
		return () => {
			live = false;
			subscription.dispose();
		};
	}, [props.host, session]);

	if (items.length === 0) return null;

	const drop = (id: string): void => setQueued((current) => (current.session === session ? { session, items: current.items.filter((item) => item.id !== id) } : current));

	const cancel = async (item: FollowUpItem): Promise<void> => {
		setBusy(item.id);
		try {
			await props.host.actions.invoke("followup.cancel", session, { id: item.id });
			drop(item.id);
		} catch {}
		setBusy(null);
	};

	const edit = async (item: FollowUpItem): Promise<void> => {
		setBusy(item.id);
		try {
			await props.host.actions.invoke("followup.cancel", session, { id: item.id });
			drop(item.id);
			props.host.transcript.setDraft(session, item.text);
		} catch {}
		setBusy(null);
	};

	return <Card items={items} busy={busy} onCancel={(item) => void cancel(item)} onEdit={(item) => void edit(item)} />;
}

function Card(props: {
	readonly items: readonly FollowUpItem[];
	readonly busy: string | null;
	readonly onCancel: (item: FollowUpItem) => void;
	readonly onEdit: (item: FollowUpItem) => void;
}) {
	const [shown, setShown] = useState(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setShown(true));
		return () => cancelAnimationFrame(frame);
	}, []);

	return (
		<div
			className={`relative z-0 mx-auto -mb-4 grid w-[calc(100%_-_24px)] transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
				shown ? "translate-y-0 opacity-100" : "translate-y-[7px] opacity-0"
			}`}
		>
			<div className="max-h-[118px] overflow-y-auto rounded-t-[10px] border-[0.5px] border-line bg-chrome px-[7px] pt-[5px] pb-[18px]">
				{props.items.map((item) => (
					<div className="group flex items-center gap-2 rounded-[4px] pr-[2px] pl-[6px] hover:bg-hover" key={item.id}>
						<button
							type="button"
							className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-[6px] text-left font-sans text-[12.5px] leading-[1.35] text-ink-soft group-hover:text-ink"
							title={item.text}
							disabled={props.busy === item.id}
							onClick={() => props.onEdit(item)}
						>
							{item.text}
						</button>
						{SOURCE[item.source] === "" ? null : (
							<span className="shrink-0 rounded-[3px] border-[0.5px] border-line px-1 py-px font-mono text-[9px] tracking-[0.08em] text-muted uppercase">
								{SOURCE[item.source]}
							</span>
						)}
						<button
							type="button"
							className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-hover hover:text-signal focus-visible:opacity-100 disabled:cursor-default motion-reduce:transition-none"
							aria-label="Cancel queued message"
							disabled={props.busy === item.id}
							onClick={() => props.onCancel(item)}
						>
							<Trash size={12} strokeWidth={1.5} />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
