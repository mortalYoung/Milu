import { ArrowUpFromLine, ChevronDown, ChevronRight, Copy, CopyPlus, Files, GitFork, Info, MoreVertical, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { activityAt, convTime, previewFor } from "../lib/chat-preview";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { Show } from "../lib/jsx";
import type { PartnerItem } from "../lib/session";
import { Button } from "./Button";
import { Avatar } from "./ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type { PartnerItem };

const byRecency = (a: PartnerItem, b: PartnerItem) => activityAt(b) - activityAt(a);

function copyText(text: string) {
	const fallback = () => {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand("copy");
		} catch {
			// execCommand unavailable — nothing else to try
		}
		ta.remove();
	};
	if (navigator.clipboard?.writeText) {
		navigator.clipboard.writeText(text).catch(fallback);
	} else {
		fallback();
	}
}

const MENU_ITEM_CLASS = "px-2 py-1 text-[13px] gap-1.5 text-ink focus:text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10";

function DeleteMenuItem(props: { onSelect: () => void }) {
	return (
		<DropdownMenuItem onSelect={props.onSelect} className={MENU_ITEM_CLASS + " text-seal focus:text-seal"}>
			<Trash2 size={13} />
			<span>Delete</span>
		</DropdownMenuItem>
	);
}

function ChatRow(props: {
	partner: PartnerItem;
	selected: boolean;
	working: boolean;
	unread: boolean;
	leaf?: boolean;
	hasChildren?: boolean;
	expanded?: boolean;
	onSelect: () => void;
	onToggle?: () => void;
	onViewDetails: () => void;
	onDuplicate: () => void;
	onFork: () => void;
	onPromote: () => void;
	onDelete: () => void;
}) {
	const { partner } = props;
	const isFork = partner.forkedFrom !== undefined;
	const [openMenu, setOpenMenu] = useState(false);
	const menuClosedAt = useRef(0);

	return (
		<div
			className={"conv-item group" + (props.selected ? " selected" : "") + (props.leaf ? " ml-5" : "")}
			onClick={() => {
				if (Date.now() - menuClosedAt.current < 200) return;
				props.onSelect();
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				setOpenMenu(true);
			}}
		>
			<Avatar name={partner.name} variant={props.selected ? "ink" : "paper"} />
			<span className={"conv-main" + (props.hasChildren ? " pr-14" : "")}>
				<span className="conv-name-row">
					<span className="conv-name">{partner.name}</span>
					<span className="conv-time">{convTime(activityAt(partner))}</span>
				</span>
				<span className="conv-preview">
					<span className="conv-preview-main">
						{props.working ? (
							<span className="conv-preview-dots" title="Working…">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</span>
						) : (
							previewFor(partner) || "—"
						)}
					</span>
					<Show when={props.unread}>
						<span className="conv-unread-dot" title="new messages" />
					</Show>
				</span>
			</span>
			<DropdownMenu
				open={openMenu}
				onOpenChange={(open) => {
					if (!open) menuClosedAt.current = Date.now();
					setOpenMenu(open);
				}}
			>
				<DropdownMenuTrigger
					className={"conv-ellipsis" + (openMenu ? " opacity-100" : " opacity-0 group-hover:opacity-100")}
					title="More"
					onClick={(event) => event.stopPropagation()}
				>
					<MoreVertical size={14} />
				</DropdownMenuTrigger>
				<DropdownMenuContent onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="min-w-44 p-1">
					<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => props.onViewDetails()}>
						<Info size={13} className="text-body-muted" />
						<span>View details</span>
					</DropdownMenuItem>
					{isFork && (
						<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working} onSelect={() => props.onPromote()}>
							<ArrowUpFromLine size={13} className="text-body-muted" />
							<span>Promote</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator className="my-0.5" />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="px-2 py-1 text-[13px] gap-1.5 text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10">
							<CopyPlus size={13} className="text-body-muted" />
							<span>Duplicate</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="min-w-44 p-1">
							<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working} onSelect={() => props.onDuplicate()}>
								<Files size={13} className="text-body-muted" />
								<span>duplicated</span>
							</DropdownMenuItem>
							<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working || isFork} onSelect={() => props.onFork()}>
								<GitFork size={13} className="text-body-muted" />
								<span>forked as children</span>
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator className="my-0.5" />
					<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => copyText(partner.path)}>
						<Copy size={13} className="text-body-muted" />
						<span>Copy Path</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator className="my-0.5" />
					<DeleteMenuItem onSelect={props.onDelete} />
				</DropdownMenuContent>
			</DropdownMenu>
			{props.hasChildren && (
				<button
					type="button"
					className={
						"absolute right-8 top-1/2 -translate-y-1/2 size-5 flex items-center justify-center rounded text-muted hover:text-ink transition-opacity " +
						(props.expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100")
					}
					title={props.expanded ? "Collapse forks" : "Expand forks"}
					aria-label={props.expanded ? "Collapse forks" : "Expand forks"}
					onClick={(event) => {
						event.stopPropagation();
						props.onToggle?.();
					}}
				>
					{props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</button>
			)}
		</div>
	);
}

export function ConversationList(props: {
	partners: PartnerItem[];
	selected: string | null;
	unread: (name: string) => boolean;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
	onDuplicate: (name: string) => void;
	onFork: (name: string) => void;
	onPromote: (name: string) => void;
}) {
	const status = useAgentStatus();
	const writing = useStore(status.store, (state) => state.writing);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

	const workingFor = (name: string) => writing[name] ?? props.partners.find((p) => p.name === name)?.writing ?? false;

	useEffect(() => {
		const selected = props.selected;
		if (!selected) return;
		const parent = props.partners.find((p) => p.name === selected)?.forkedFrom;
		if (!parent) return;
		setExpanded((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
	}, [props.selected, props.partners]);

	const roots = useMemo(() => props.partners.filter((p) => !p.forkedFrom).sort(byRecency), [props.partners]);
	const leavesByRoot = useMemo(() => {
		const map = new Map<string, PartnerItem[]>();
		for (const partner of props.partners) {
			if (!partner.forkedFrom) continue;
			const list = map.get(partner.forkedFrom) ?? [];
			list.push(partner);
			map.set(partner.forkedFrom, list);
		}
		for (const list of map.values()) list.sort(byRecency);
		return map;
	}, [props.partners]);

	const deleteForkCount = confirmDelete ? props.partners.filter((p) => p.forkedFrom === confirmDelete).length : 0;

	const toggle = (name: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	return (
		<aside className="w-60 shrink-0 h-full bg-paper border-r border-hairline flex flex-col pl-3 pt-3">
			<div className="conv-list-search">
				<input className="conv-list-input" type="text" placeholder="Search correspondence…" spellCheck={false} />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="default" size="icon" class="size-[26px] rounded-full electrobun-webkit-app-region-no-drag" title="Add Partner (⌘N)" onClick={props.onAddPartner}>
							<Plus size={13} />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add Partner (⌘N)</TooltipContent>
				</Tooltip>
			</div>

			{props.partners.length === 0 && <div className="px-1 py-3 text-[12px] text-muted">No partners yet</div>}

			<div className="flex flex-col gap-[2px]">
				{roots.map((root) => {
					const leaves = leavesByRoot.get(root.name) ?? [];
					const isExpanded = expanded.has(root.name);
					return (
						<Fragment key={root.name}>
							<ChatRow
								partner={root}
								selected={props.selected === root.name}
								working={workingFor(root.name)}
								unread={props.unread(root.name)}
								hasChildren={leaves.length > 0}
								expanded={isExpanded}
								onSelect={() => props.onSelect(root.name)}
								onToggle={() => toggle(root.name)}
								onViewDetails={() => props.onViewDetails(root.name)}
								onDuplicate={() => props.onDuplicate(root.name)}
								onFork={() => props.onFork(root.name)}
								onPromote={() => props.onPromote(root.name)}
								onDelete={() => setConfirmDelete(root.name)}
							/>
							{isExpanded &&
								leaves.map((leaf) => (
									<ChatRow
										key={leaf.name}
										partner={leaf}
										selected={props.selected === leaf.name}
										working={workingFor(leaf.name)}
										unread={props.unread(leaf.name)}
										leaf
										onSelect={() => props.onSelect(leaf.name)}
										onViewDetails={() => props.onViewDetails(leaf.name)}
										onDuplicate={() => props.onDuplicate(leaf.name)}
										onFork={() => props.onFork(leaf.name)}
										onPromote={() => props.onPromote(leaf.name)}
										onDelete={() => setConfirmDelete(leaf.name)}
									/>
								))}
						</Fragment>
					);
				})}
			</div>

			<Dialog open={confirmDelete != null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
				<DialogContent className="w-[320px]">
					<DialogHeader>
						<DialogTitle>Delete partner</DialogTitle>
						<DialogDescription>
							{deleteForkCount > 0
								? `Delete "${confirmDelete}" and ${deleteForkCount} fork(s)? This removes their profile folders.`
								: `Delete "${confirmDelete}"? This removes its profile folder.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (confirmDelete) props.onDelete(confirmDelete);
								setConfirmDelete(null);
							}}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</aside>
	);
}
