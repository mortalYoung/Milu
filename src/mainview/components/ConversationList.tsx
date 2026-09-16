/**
 * ConversationList — the letter directory on the left.
 * Header "Letters" + a round create button; rows = initial-letter avatar + name/time + preview;
 * hover ellipsis opens a DropdownMenu; right-click ContextMenu; delete-confirmation Dialog.
 * Roots can expand to show one level of fork leaves.
 */
import { ArrowUpFromLine, ChevronDown, ChevronRight, Copy, CopyPlus, Files, GitFork, Info, MoreVertical, Plus, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { ChatPreviewKind } from "../../shared/rpc";
import { convTime, previewFor } from "../lib/chat-preview";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
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

export interface PartnerItem {
	name: string;
	persona?: string;
	createdAt: number;
	/** Absolute path of the partner's storage root. */
	path: string;
	/** Root chats omit this; fork chats point to the root chat they hang under. */
	forkedFrom?: string;
	/** Last visible message (chat-list preview); undefined when the chat is empty. */
	lastMessage?: string;
	/** Timestamp of the last visible message. */
	lastMessageAt?: number;
	/** What the last visible row was — a message, or an activity row (command/skill/shell). */
	lastMessageKind?: ChatPreviewKind;
	/** Per-partner read watermark (persisted): messages after this timestamp are unread. */
	readAt?: number;
	/** The partner's working directory, when one is set. */
	workspace?: string | null;
	writing?: boolean;
}

const byRecency = (a: PartnerItem, b: PartnerItem) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);

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

function DeleteMenuItem(props: { onSelect: () => void }) {
	return (
		<DropdownMenuItem onSelect={props.onSelect} class="px-2 py-1 text-[13px] gap-1.5 text-seal focus:text-seal hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10">
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
	const [openMenu, setOpenMenu] = createSignal(false);
	const menuItemClass = "px-2 py-1 text-[13px] gap-1.5 text-ink focus:text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10";
	// The instant a menu closes, WebKit can let the click bleed through to the row underneath — a time guard intercepts it
	let menuClosedAt = 0;

	return (
		<div
			class={"conv-item group" + (props.selected ? " selected" : "") + (props.leaf ? " ml-5" : "")}
			onClick={() => {
				// A click within <200ms of the menu closing is menu click-through; do not select
				if (Date.now() - menuClosedAt < 200) return;
				props.onSelect();
			}}
			// Right-click = open the same anchored menu (same position as the ellipsis)
			onContextMenu={(e) => {
				e.preventDefault();
				setOpenMenu(true);
			}}
		>
			<Avatar name={partner.name} variant={props.selected ? "ink" : "paper"} />
			<span class={"conv-main" + (props.hasChildren ? " pr-14" : "")}>
				<span class="conv-name-row">
					<span class="conv-name">{partner.name}</span>
					<span class="conv-time">{convTime(partner.lastMessageAt ?? partner.createdAt)}</span>
				</span>
				<span class="conv-preview">
					<span class="conv-preview-main">
						{props.working ? (
							<span class="conv-preview-dots" title="Working…">
								<span class="work-dot" />
								<span class="work-dot" />
								<span class="work-dot" />
							</span>
						) : (
							previewFor(partner) || "—"
						)}
					</span>
					<Show when={props.unread}>
						<span class="conv-unread-dot" title="new messages" />
					</Show>
				</span>
			</span>
			{/* Ellipsis appears on hover; click or right-click both open the same menu; stays visible while the menu is open */}
			<DropdownMenu
				open={openMenu()}
				onOpenChange={(open) => {
					if (!open) menuClosedAt = Date.now();
					setOpenMenu(open);
				}}
			>
				<DropdownMenuTrigger class={"conv-ellipsis" + (openMenu() ? " opacity-100" : " opacity-0 group-hover:opacity-100")} title="More" onClick={(e) => e.stopPropagation()}>
					<MoreVertical size={14} />
				</DropdownMenuTrigger>
				{/* Menu item clicks bubble up to the row as row clicks; stopping pointerdown is not enough, stop the click itself */}
				<DropdownMenuContent onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} class="min-w-44 p-1">
					<DropdownMenuItem class={menuItemClass} onSelect={() => props.onViewDetails()}>
						<Info size={13} class="text-body-muted" />
						<span>View details</span>
					</DropdownMenuItem>
					{isFork && (
						<DropdownMenuItem class={menuItemClass} disabled={props.working} onSelect={() => props.onPromote()}>
							<ArrowUpFromLine size={13} class="text-body-muted" />
							<span>Promote</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator class="my-0.5" />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger class="px-2 py-1 text-[13px] gap-1.5 text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10">
							<CopyPlus size={13} class="text-body-muted" />
							<span>Duplicate</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent class="min-w-44 p-1">
							<DropdownMenuItem class={menuItemClass} disabled={props.working} onSelect={() => props.onDuplicate()}>
								<Files size={13} class="text-body-muted" />
								<span>duplicated</span>
							</DropdownMenuItem>
							<DropdownMenuItem class={menuItemClass} disabled={props.working || isFork} onSelect={() => props.onFork()}>
								<GitFork size={13} class="text-body-muted" />
								<span>forked as children</span>
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator class="my-0.5" />
					<DropdownMenuItem class={menuItemClass} onSelect={() => copyText(partner.path)}>
						<Copy size={13} class="text-body-muted" />
						<span>Copy Path</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator class="my-0.5" />
					<DeleteMenuItem onSelect={props.onDelete} />
				</DropdownMenuContent>
			</DropdownMenu>
			{props.hasChildren && (
				<button
					type="button"
					class={
						"absolute right-8 top-1/2 -translate-y-1/2 size-5 flex items-center justify-center rounded text-muted hover:text-ink transition-opacity " +
						(props.expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100")
					}
					title={props.expanded ? "Collapse forks" : "Expand forks"}
					aria-label={props.expanded ? "Collapse forks" : "Expand forks"}
					onClick={(e) => {
						e.stopPropagation();
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
	/** Whether the given partner has messages newer than its read watermark. */
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
	const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

	// A selected fork stays visible: expand its root whenever selection points at a leaf.
	createEffect(() => {
		const selected = props.selected;
		if (!selected) return;
		const parent = props.partners.find((p) => p.name === selected)?.forkedFrom;
		if (parent && !expanded().has(parent)) {
			setExpanded((prev) => new Set(prev).add(parent));
		}
	});

	const roots = createMemo(() => props.partners.filter((p) => !p.forkedFrom).sort(byRecency));
	const leavesByRoot = createMemo(() => {
		const map = new Map<string, PartnerItem[]>();
		for (const partner of props.partners) {
			if (partner.forkedFrom) {
				const list = map.get(partner.forkedFrom) ?? [];
				list.push(partner);
				map.set(partner.forkedFrom, list);
			}
		}
		for (const list of map.values()) list.sort(byRecency);
		return map;
	});

	const deleteForkCount = () => (confirmDelete() ? props.partners.filter((p) => p.forkedFrom === confirmDelete()).length : 0);

	return (
		<aside class="w-60 shrink-0 h-full bg-paper border-r border-hairline flex flex-col pl-3 pt-3">
			<div class="conv-list-search">
				<input class="conv-list-input" type="text" placeholder="Search correspondence…" spellcheck={false} />
				<Tooltip>
					<TooltipTrigger>
						<Button variant="default" size="icon" class="size-[26px] rounded-full electrobun-webkit-app-region-no-drag" title="Add Partner (⌘N)" onClick={props.onAddPartner}>
							<Plus size={13} />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add Partner (⌘N)</TooltipContent>
				</Tooltip>
			</div>

			{props.partners.length === 0 && <div class="px-1 py-3 text-[12px] text-muted">No partners yet</div>}

			<div class="flex flex-col gap-[2px]">
				{roots().map((root) => {
					const leaves = leavesByRoot().get(root.name) ?? [];
					const isExpanded = expanded().has(root.name);
					return (
						<>
							<ChatRow
								partner={root}
								selected={props.selected === root.name}
								working={status.workingFor(root.name)}
								unread={props.unread(root.name)}
								hasChildren={leaves.length > 0}
								expanded={isExpanded}
								onSelect={() => props.onSelect(root.name)}
								onToggle={() => {
									setExpanded((prev) => {
										const next = new Set(prev);
										if (next.has(root.name)) next.delete(root.name);
										else next.add(root.name);
										return next;
									});
								}}
								onViewDetails={() => props.onViewDetails(root.name)}
								onDuplicate={() => props.onDuplicate(root.name)}
								onFork={() => props.onFork(root.name)}
								onPromote={() => props.onPromote(root.name)}
								onDelete={() => setConfirmDelete(root.name)}
							/>
							{isExpanded &&
								leaves.map((leaf) => (
									<ChatRow
										partner={leaf}
										selected={props.selected === leaf.name}
										working={status.workingFor(leaf.name)}
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
						</>
					);
				})}
			</div>

			{/* Delete-confirmation dialog */}
			<Dialog open={confirmDelete() != null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
				<DialogContent class="w-[320px]">
					<DialogHeader>
						<DialogTitle>Delete partner</DialogTitle>
						<DialogDescription>
							{deleteForkCount() > 0
								? `Delete "${confirmDelete()}" and ${deleteForkCount()} fork(s)? This removes their profile folders.`
								: `Delete "${confirmDelete()}"? This removes its profile folder.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (confirmDelete()) props.onDelete(confirmDelete()!);
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
