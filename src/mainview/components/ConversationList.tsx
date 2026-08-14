/**
 * ConversationList — 左侧信件目录。
 * 目录头 "Letters" + 新建圆钮;行 = 首字母头像 + 名字/时间 + 预览;
 * hover ellipsis 打开 DropdownMenu;右键 ContextMenu(删除);删除确认 Dialog。
 */
import { Info, MoreVertical, Plus, Trash2 } from "lucide-solid";
import { createSignal } from "solid-js";
import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface PartnerItem {
	name: string;
	avatar?: string;
	role?: string;
	responsibilities?: string;
	tones?: string;
	createdAt: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 目录时间:今天 → "10:42 AM";否则 → "JUL 28" */
function convTime(ts: number): string {
	const d = new Date(ts);
	if (d.toDateString() === new Date().toDateString()) {
		const h = d.getHours();
		const ampm = h >= 12 ? "PM" : "AM";
		return `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${ampm}`;
	}
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function PartnerAvatar(props: { partner: PartnerItem; selected: boolean }) {
	// 选中行 = 暖墨实底首字母;其余 = 纸面描边首字母
	const cls = props.selected ? "avatar-ink" : "avatar-paper";
	if (props.partner.avatar) {
		return <span class={`conv-avatar ${cls} text-[15px]`}>{props.partner.avatar}</span>;
	}
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
	/** agent 运行中(选中行预览槽显示工作指示)。 */
	busy: () => boolean;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
}) {
	const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
	// 当前打开菜单的行:菜单打开期间 ellipsis 保持可见
	const [openMenu, setOpenMenu] = createSignal<string | null>(null);
	// 菜单关闭瞬间 WebKit 会把点选穿透成对底下行的 click —— 时间守卫拦截
	let menuClosedAt = 0;

	return (
		<aside class="w-60 shrink-0 h-full bg-paper border-r border-hairline flex flex-col pl-3 pt-4">
			{/* 目录头:Letters + 新建圆钮 */}
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
							// 菜单刚关闭(<200ms)的点击是菜单点选穿透,不选中
							if (Date.now() - menuClosedAt < 200) return;
							props.onSelect(partner.name);
						}}
						// 右键 = 打开同一锚点菜单(与 ellipsis 位置一致)
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
									partner.role || "—"
								)}
							</span>
						</span>
						{/* hover 浮现的 ellipsis;点击或右键都打开同一菜单;菜单打开期间常显 */}
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
							<DropdownMenuContent onPointerDown={(e) => e.stopPropagation()}>
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

			{/* 删除确认弹窗 */}
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
