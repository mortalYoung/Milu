import { ChevronDown, ChevronRight, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ScheduleItem, ScheduleRunItem } from "../../shared/rpc";
import { parseScheduleInput } from "../../shared/schedule-when";
import { rpc } from "../lib/rpc";
import { type AxisNode, buildScheduleAxis, clockTime } from "../lib/schedule-axis";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { TextFieldInput, TextFieldLabel, TextFieldTextArea } from "./ui/text-field";
import { Tip } from "./ui/tooltip";

const EYEBROW = "font-sans text-[12px] font-semibold uppercase tracking-[0.12em] text-muted";
const CARD = "border border-line bg-surface rounded-md";

type Editor = { mode: "create" } | { mode: "edit"; item: ScheduleItem };

const STATUS_TEXT: Record<ScheduleRunItem["status"], string> = {
	done: "ok",
	failed: "failed",
	missed: "missed",
	skipped: "skipped",
	dispatched: "running",
};

function statusClass(status: ScheduleRunItem["status"]): string {
	if (status === "failed") return "text-signal";
	if (status === "missed") return "text-accent-amber";
	if (status === "done") return "text-muted";
	return "text-muted-soft";
}

export function ScheduleSection(props: { partner: string; sandbox?: string }) {
	const [open, setOpen] = useState(true);
	const [items, setItems] = useState<ScheduleItem[] | null>(null);
	const [history, setHistory] = useState<ScheduleRunItem[]>([]);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [stamp, setStamp] = useState(() => Date.now());

	useEffect(() => {
		let cancelled = false;
		const load = () => {
			void rpc.request.schedule_list({ name: props.partner }).then((res) => {
				if (cancelled) return;
				setItems(res.items);
				setHistory(res.history);
				setStamp(Date.now());
			});
		};
		setItems(null);
		setExpanded(null);
		setError(null);
		load();
		const onUpdate = ({ partner }: { partner: string }) => {
			if (partner === props.partner) load();
		};
		rpc.addMessageListener("schedule_update", onUpdate);
		return () => {
			cancelled = true;
			rpc.removeMessageListener("schedule_update", onUpdate);
		};
	}, [props.partner]);

	const runs = useMemo(() => {
		const byRun = new Map<string, ScheduleRunItem>();
		for (const record of history) byRun.set(record.runId, record);
		return [...byRun.values()].sort((a, b) => (b.dispatchedAt ?? b.scheduledAt) - (a.dispatchedAt ?? a.scheduledAt));
	}, [history]);
	const axis = useMemo(() => (items ? buildScheduleAxis(items, runs, stamp) : null), [items, runs, stamp]);
	const last = runs.find((record) => record.status !== "dispatched") ?? null;
	const summary =
		axis && items
			? [`${axis.active} active`, axis.next != null ? `next ${clockTime(axis.next)}` : "nothing scheduled", last ? `last ${STATUS_TEXT[last.status]}` : null]
					.filter(Boolean)
					.join(" · ")
			: "—";

	async function runNow(item: ScheduleItem) {
		setError(null);
		const res = await rpc.request.schedule_run({ name: props.partner, id: item.id });
		if (!res.ok) setError(res.error ?? "could not start it");
	}

	async function toggle(item: ScheduleItem) {
		setError(null);
		const res = await rpc.request.schedule_update({ name: props.partner, id: item.id, patch: { enabled: item.status !== "active" } });
		if (!res.ok) setError(res.error ?? "could not change it");
	}

	async function remove(item: ScheduleItem) {
		await rpc.request.schedule_delete({ name: props.partner, id: item.id });
		setConfirming(null);
		setExpanded(null);
	}

	function renderNode(node: AxisNode) {
		const item = node.item;
		const isOpen = expanded === item.id;
		const facts: string[] = [];
		if (node.paused) facts.push(item.status === "finished" ? "finished" : "paused", item.describe);
		else if (node.kind === "span") facts.push(`every ${item.describe.replace(/^every /, "")}`, `${node.runs.length} runs today`);
		else if (node.next)
			facts.push(
				node.retrying ? `retrying · ${clockTime(node.at)}` : `next · ${clockTime(node.at)}`,
				item.status === "paused" ? "paused" : `every ${item.describe.replace(/^daily |^every |^once · /, "")}`,
			);
		else {
			const run = node.runs[0];
			if (run) {
				facts.push(STATUS_TEXT[run.status]);
				if (run.error) facts.push(run.error);
			}
		}
		const className =
			"sch-slot" +
			(node.next ? " is-next" : "") +
			(node.kind === "span" ? " is-span" : "") +
			(node.runs.some((run) => run.status === "failed") ? " is-fail" : "") +
			(node.runs.some((run) => run.status === "missed") ? " is-miss" : "");

		return (
			<div className={className} key={node.key}>
				<span className="sch-at">{node.paused ? "—" : node.kind === "span" ? clockTime(node.spanFrom ?? node.at) : clockTime(node.at)}</span>
				<span className="sch-spine">
					<i />
				</span>
				<span className="sch-body">
					<button type="button" className="sch-row" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : item.id)}>
						<span className="sch-title">{item.title || item.display}</span>
						<span className="sch-facts">
							<span className={node.runs[0] ? statusClass(node.runs[0].status) : node.retrying ? "text-signal" : "text-muted"}>{facts.join(" · ")}</span>
						</span>
					</button>
					<span className="sch-actions">
						<Tip label={item.status === "active" ? "Run now" : "Paused"}>
							<button type="button" className="sch-icon" aria-label="Run now" onClick={() => void runNow(item)}>
								<Play size={10} />
							</button>
						</Tip>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button type="button" className="sch-icon" aria-label="Schedule actions">
									<span className="text-[11px] leading-none">⋯</span>
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-40">
								<DropdownMenuItem className="font-sans text-[12px]" onSelect={() => void toggle(item)}>
									{item.status === "active" ? <Pause size={12} /> : <Play size={12} />}
									{item.status === "active" ? "Pause" : "Resume"}
								</DropdownMenuItem>
								<DropdownMenuItem className="font-sans text-[12px]" onSelect={() => setEditor({ mode: "edit", item })}>
									Edit schedule & prompt
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem className="font-sans text-[12px] text-signal" onSelect={() => setConfirming(item.id)}>
									<Trash2 size={12} />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</span>
					{isOpen && (
						<div className="sch-detail">
							<p className="sch-prompt">{item.text}</p>
							<div className="sch-meta">
								<span className="font-mono">{item.describe}</span>
								<span className="text-muted-soft">·</span>
								<span className="font-mono">{item.runCount} runs</span>
								{props.sandbox ? <span className="font-mono text-muted-soft">· {props.sandbox}</span> : null}
							</div>
							{runs.filter((record) => record.scheduleId === item.id).length > 0 && (
								<ul className="sch-runs">
									{runs
										.filter((record) => record.scheduleId === item.id)
										.slice(0, 5)
										.map((record) => (
											<li key={record.runId}>
												<span className="font-mono tabular-nums">{clockTime(record.dispatchedAt ?? record.scheduledAt)}</span>
												<span className={statusClass(record.status)}>{STATUS_TEXT[record.status]}</span>
												<span className="text-muted-soft font-mono">{record.trigger}</span>
												{record.error ? <span className="text-signal min-w-0 truncate">{record.error}</span> : null}
											</li>
										))}
								</ul>
							)}
							{confirming === item.id ? (
								<div className="sch-confirm">
									<span>Delete this schedule?</span>
									<Button size="sm" variant="destructive" onClick={() => void remove(item)}>
										Delete
									</Button>
									<Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
										Cancel
									</Button>
								</div>
							) : null}
						</div>
					)}
				</span>
			</div>
		);
	}

	return (
		<div className={CARD}>
			<div className="card-head flex w-full items-center gap-2 rounded-t-[5px] px-3 py-2.5">
				<button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
					<span className={EYEBROW}>Scheduled</span>
					<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{summary}</span>
					{open ? <ChevronDown size={14} className="shrink-0 text-muted-soft" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
				</button>
				<Tip label="New schedule">
					<button type="button" className="sch-icon" aria-label="New schedule" onClick={() => setEditor({ mode: "create" })}>
						<Plus size={11} />
					</button>
				</Tip>
			</div>

			{open && (
				<div className="flex flex-col gap-2 border-t border-line p-3">
					{error ? <p className="font-sans text-[12px] text-signal">{error}</p> : null}
					{items == null ? null : items.length === 0 ? (
						<div className="flex flex-col gap-1">
							<p className="font-sans text-[12px] text-ink">Nothing scheduled</p>
							<button type="button" className="text-left font-sans text-[12px] text-muted hover:text-ink" onClick={() => setEditor({ mode: "create" })}>
								Try “每天 9:00 汇总这个仓库的 open issues”
							</button>
						</div>
					) : (
						<div className="sch-axis">
							{axis?.groups.map((group) => (
								<div className="sch-group" key={group.key}>
									<div className="sch-day">
										<span>{group.label}</span>
										<span className="text-muted-soft">{group.collapsed ? `${group.count} entries` : ""}</span>
									</div>
									{group.nodes.map(renderNode)}
									{group.folded > 0 ? <div className="sch-folded">… {group.folded} earlier</div> : null}
								</div>
							))}
							<div className="sch-now">
								<span className="sch-at">{clockTime(stamp)}</span>
								<span className="sch-now-line" />
							</div>
						</div>
					)}
				</div>
			)}

			{editor && <ScheduleEditor partner={props.partner} sandbox={props.sandbox} editor={editor} onClose={() => setEditor(null)} />}
		</div>
	);
}

function ScheduleEditor(props: { partner: string; sandbox?: string; editor: Editor; onClose: () => void }) {
	const editing = props.editor.mode === "edit" ? props.editor.item : null;
	const [when, setWhen] = useState(editing?.display ?? "");
	const [text, setText] = useState(editing?.text ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const parsed = useMemo(() => parseScheduleInput(when), [when]);
	const ready = !parsed.error && text.trim().length > 0;

	async function save() {
		if (!ready) return;
		setBusy(true);
		setError(null);
		const res = editing
			? await rpc.request.schedule_update({ name: props.partner, id: editing.id, patch: { when: parsed.when, text } })
			: await rpc.request.schedule_create({ name: props.partner, when: parsed.when, text });
		setBusy(false);
		if (!res.ok) {
			setError(res.error ?? "could not save");
			return;
		}
		props.onClose();
	}

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent size={{ w: 560 }} className="bg-surface text-ink p-0 gap-0">
				<DialogTitle className="sr-only">{editing ? "Edit schedule" : "New schedule"}</DialogTitle>
				<div className="flex flex-col gap-3 p-5">
					<p className={EYEBROW}>{editing ? "Edit schedule" : "New schedule"}</p>
					<div className="flex flex-col gap-1.5">
						<TextFieldLabel htmlFor="sch-when">When</TextFieldLabel>
						<TextFieldInput
							id="sch-when"
							variant="quiet"
							value={when}
							placeholder="每天 9:00 · 每 15 分钟 · 每周五 17:30 · 2026-10-20 09:00"
							onChange={(event) => setWhen(event.target.value)}
						/>
						<p className={"font-mono text-[12px] " + (parsed.error ? "text-signal" : "text-muted")}>{parsed.error ?? parsed.echo}</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<TextFieldLabel htmlFor="sch-text">What it should do</TextFieldLabel>
						<TextFieldTextArea
							id="sch-text"
							className="min-h-[96px]"
							value={text}
							placeholder="汇总这个仓库的 open issues，写成一篇日报"
							onChange={(event) => setText(event.target.value)}
						/>
						<p className="font-sans text-[12px] text-muted">
							{props.sandbox
								? `Runs unattended with the current permission (${props.sandbox}); anything needing approval is skipped and reported.`
								: "Runs unattended; anything needing approval is skipped and reported."}
						</p>
					</div>
					{error ? <p className="font-sans text-[12px] text-signal">{error}</p> : null}
					<div className="flex justify-end gap-2">
						<Button variant="ghost" onClick={props.onClose}>
							Cancel
						</Button>
						<Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
							{editing ? "Save" : "Create"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
