/**
 * ConversationList — the letter directory on the left.
 * Header "Letters" + a round create button; rows = initial-letter avatar + name/time + preview;
 * hover ellipsis opens a DropdownMenu; right-click ContextMenu (delete); delete-confirmation Dialog.
 */
import { Info, MoreVertical, Plus, Trash2 } from "lucide-solid";
import { createSignal } from "solid-js";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface PartnerItem {
	name: string;
	responsibilities?: string;
	tones?: string;
	createdAt: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Directory time: today → "10:42"; otherwise → "JUL 28" */
function convTime(ts: number): string {
	const d = new Date(ts);
	if (d.toDateString() === new Date().toDateString()) {
		return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function PartnerAvatar(props: { partner: PartnerItem; selected: boolean }) {
	// Selected row = warm-ink solid initial; others = paper-outlined initial
	const cls = props.selected ? "avatar-ink" : "avatar-paper";
	return (
		<span class={`conv-avatar ${cls}`}>
			<span class="avatar-initial">{props.partner.name.charAt(0)}</span>
		</span>
	);
}

function DeleteMenuItem(props: { onSelect: () => void }) {
	return (
		<DropdownMenuItem onSelect={props.onSelect} class="text-ink">
			<Trash2 size={13} />
			<span>Delete</span>
		</DropdownMenuItem>
	);
}

export function ConversationList(props: {
	partners: PartnerItem[];
	selected: string | null;
	/** Agent running (the selected row's preview slot shows the working indicator). */
	busy: () => boolean;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
}) {
	const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
	// The row whose menu is currently open: the ellipsis stays visible while the menu is open
	const [openMenu, setOpenMenu] = createSignal<string | null>(null);
	// The instant a menu closes, WebKit can let the click bleed through to the row underneath — a time guard intercepts it
	let menuClosedAt = 0;

	return (
		<aside class="w-60 shrink-0 h-full bg-paper border-r border-hairline flex flex-col pl-3 pt-4">
			{/* Directory header: Letters + round create button */}
			<div class="conv-list-head">
				<span class="conv-list-title">Letters</span>
				<Tooltip>
					<TooltipTrigger>
						<Button variant="default" size="icon" class="size-[26px] rounded-full" title="Add Partner" onClick={props.onAddPartner}>
							<Plus size={13} />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add Partner</TooltipContent>
				</Tooltip>
			</div>

			<div class="conv-list-search">
				<input class="conv-list-input" type="text" placeholder="Search correspondence…" spellcheck={false} />
			</div>

			{props.partners.length === 0 && <div class="px-1 py-3 text-[12px] text-muted">No partners yet</div>}

			<div class="flex flex-col gap-[2px]">
				{props.partners.map((partner) => (
					<div
						class={"conv-item group" + (props.selected === partner.name ? " selected" : "")}
						onClick={() => {
							// A click within <200ms of the menu closing is menu click-through; do not select
							if (Date.now() - menuClosedAt < 200) return;
							props.onSelect(partner.name);
						}}
						// Right-click = open the same anchored menu (same position as the ellipsis)
						onContextMenu={(e) => {
							e.preventDefault();
							setOpenMenu(partner.name);
						}}
					>
						<PartnerAvatar partner={partner} selected={props.selected === partner.name} />
						<span class="conv-main">
							<span class="conv-name-row">
								<span class="conv-name">{partner.name}</span>
								<span class="conv-time">{convTime(partner.createdAt)}</span>
							</span>
							<span class="conv-preview">
								{props.busy() && props.selected === partner.name ? (
									<span class="conv-preview-dots" title="Working…">
										<span class="work-dot" />
										<span class="work-dot" />
										<span class="work-dot" />
									</span>
								) : (
									(partner.responsibilities?.split("\n").find((l) => l.trim()) ?? "") || "—"
								)}
							</span>
						</span>
						{/* Ellipsis appears on hover; click or right-click both open the same menu; stays visible while the menu is open */}
						<DropdownMenu
							open={openMenu() === partner.name}
							onOpenChange={(open) => {
								if (!open) menuClosedAt = Date.now();
								setOpenMenu(open ? partner.name : null);
							}}
						>
							<DropdownMenuTrigger
								class={"conv-ellipsis" + (openMenu() === partner.name ? " opacity-100" : " opacity-0 group-hover:opacity-100")}
								title="More"
								onClick={(e) => e.stopPropagation()}
							>
								<MoreVertical size={14} />
							</DropdownMenuTrigger>
							{/* Menu item clicks bubble up to the row as row clicks; stopping pointerdown is not enough, stop the click itself */}
							<DropdownMenuContent onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
								<DropdownMenuItem class="text-ink" onSelect={() => props.onViewDetails(partner.name)}>
									<Info size={13} />
									<span>View details</span>
								</DropdownMenuItem>
								<DeleteMenuItem onSelect={() => setConfirmDelete(partner.name)} />
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				))}
			</div>

			{/* Delete-confirmation dialog */}
			<Dialog open={confirmDelete() != null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
				<DialogContent class="w-[320px]">
					<DialogHeader>
						<DialogTitle>Delete partner</DialogTitle>
						<DialogDescription>Delete "{confirmDelete()}"? This removes its profile folder.</DialogDescription>
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
