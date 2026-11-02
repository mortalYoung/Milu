import type { PendingItem } from "@milu/protocol";
import type { SlotProps } from "@milu/window/api";
import { ArrowLeftRight, CornerDownRight, CornerUpRight, Trash } from "lucide-react";
import { useEffect, useState } from "react";

interface PendingData {
	readonly session?: string;
}

const ACTION =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted transition-colors duration-100 disabled:cursor-default";

function KindChip(props: { readonly kind: PendingItem["kind"] }) {
	const steering = props.kind === "steering";
	return (
		<span
			className={`inline-flex h-[17px] shrink-0 items-center gap-1 rounded-[3px] border-[0.5px] px-1 font-mono text-[8.5px] tracking-[0.07em] uppercase ${
				steering ? "border-accent-teal/35 text-accent-teal" : "border-line text-muted"
			}`}
			title={steering ? "steering · injected after this turn" : "follow-up · injected when the run would stop"}
		>
			{steering ? <CornerUpRight size={10} aria-hidden="true" /> : <CornerDownRight size={10} aria-hidden="true" />}
			{steering ? "steer" : "follow-up"}
		</span>
	);
}

export function PendingDock(props: SlotProps) {
	const session = (props.data as PendingData | null)?.session ?? "";
	const [queued, setQueued] = useState<{ readonly session: string; readonly items: readonly PendingItem[] }>({ session: "", items: [] });
	const [busy, setBusy] = useState<string | null>(null);
	const items = queued.session === session ? queued.items : [];

	useEffect(() => {
		if (!session) return;
		let live = true;
		const subscription = props.host.connection.onLive((event) => {
			if (event.type === "pending" && event.session === session) setQueued({ session, items: event.items });
		});
		void props.host.actions
			.request<{ items: readonly PendingItem[] }>("pending.list", session)
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

	const cancel = async (item: PendingItem): Promise<void> => {
		setBusy(item.id);
		try {
			await props.host.actions.invoke("pending.cancel", session, { id: item.id });
			drop(item.id);
		} catch {}
		setBusy(null);
	};

	const convert = async (item: PendingItem): Promise<void> => {
		setBusy(item.id);
		try {
			await props.host.actions.invoke("pending.convert", session, { id: item.id, kind: item.kind === "steering" ? "follow-up" : "steering" });
		} catch {
			drop(item.id);
		}
		setBusy(null);
	};

	const edit = async (item: PendingItem): Promise<void> => {
		setBusy(item.id);
		try {
			await props.host.actions.invoke("pending.cancel", session, { id: item.id });
			drop(item.id);
			props.host.transcript.setDraft(session, item.text);
		} catch {}
		setBusy(null);
	};

	return <Card items={items} busy={busy} onCancel={(item) => void cancel(item)} onConvert={(item) => void convert(item)} onEdit={(item) => void edit(item)} />;
}

function Card(props: {
	readonly items: readonly PendingItem[];
	readonly busy: string | null;
	readonly onCancel: (item: PendingItem) => void;
	readonly onConvert: (item: PendingItem) => void;
	readonly onEdit: (item: PendingItem) => void;
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
					<div className="group relative flex items-center gap-2 rounded-[4px] pr-[2px] pl-[6px] hover:bg-hover focus-within:bg-hover" key={item.id}>
						<KindChip kind={item.kind} />
						<button
							type="button"
							className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-[6px] text-left font-sans text-[12.5px] leading-[1.35] text-ink-soft group-hover:text-ink"
							title={item.text}
							disabled={props.busy === item.id}
							onClick={() => props.onEdit(item)}
						>
							{item.text}
						</button>
						<span className="pointer-events-none absolute inset-y-0 right-[2px] flex items-center gap-0.5 bg-[linear-gradient(to_right,transparent,color-mix(in_srgb,var(--ink)_7%,var(--chrome))_16px)] pr-1 pl-6 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none">
							<button
								type="button"
								className={`${ACTION} hover:bg-hover hover:text-ink`}
								aria-label={item.kind === "steering" ? "Send as follow-up" : "Send as steering"}
								title={item.kind === "steering" ? "Send as follow-up" : "Send as steering"}
								disabled={props.busy === item.id}
								onClick={() => props.onConvert(item)}
							>
								<ArrowLeftRight size={12} strokeWidth={1.7} />
							</button>
							<button
								type="button"
								className={`${ACTION} hover:bg-hover hover:text-signal`}
								aria-label="Cancel queued message"
								disabled={props.busy === item.id}
								onClick={() => props.onCancel(item)}
							>
								<Trash size={12} strokeWidth={1.5} />
							</button>
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
