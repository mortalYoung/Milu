import { ArrowUpFromLine, ChevronDown, ChevronRight, Copy, CopyPlus, Files, GitFork, Info, MoreVertical, Plus, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { registerSurfaceRoot } from "../lib/active-surface";
import { activityAt, convTime, filterPartners, previewFor } from "../lib/chat-preview";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useFindHandler } from "../lib/find";
import { imeGuard } from "../lib/ime";
import { Show } from "../lib/jsx";
import type { PartnerItem } from "../lib/session";
import { SURFACE } from "../lib/surfaces";
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

const SKELETON_ROWS = 5;

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
	childCount?: number;
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
			<span className="conv-main">
				<span className="conv-name-row">
					<span className="conv-name-wrap">
						<span className="conv-name">{partner.name}</span>
						{props.childCount != null && props.childCount > 0 && (
							<button
								type="button"
								className="conv-fork-count"
								aria-expanded={props.expanded}
								aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.childCount} fork${props.childCount === 1 ? "" : "s"} of ${partner.name}`}
								title={props.expanded ? "Collapse forks" : "Expand forks"}
								onClick={(event) => {
									event.stopPropagation();
									props.onToggle?.();
								}}
							>
								{props.expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
								{props.childCount}
							</button>
						)}
					</span>
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
				<DropdownMenuContent side="right" align="start" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="min-w-44 p-1">
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
		</div>
	);
}

export function ConversationList(props: {
	partners: PartnerItem[];
	loading: boolean;
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
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const attachRoot = useCallback((element: HTMLElement | null) => {
		if (!element) return;
		return registerSurfaceRoot(element, SURFACE.chatList);
	}, []);
	const imeRef = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!imeRef.current) imeRef.current = imeGuard(setQuery);
	const ime = imeRef.current;

	const workingFor = (name: string) => writing[name] ?? props.partners.find((p) => p.name === name)?.writing ?? false;

	useFindHandler(SURFACE.chatList, () => {
		const input = searchRef.current;
		if (!input || input.closest("[inert]")) return false;
		input.focus();
		input.select();
		return true;
	});

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

	const searching = query.trim() !== "";
	const matched = useMemo(() => new Set(filterPartners(props.partners, query).map((partner) => partner.name)), [props.partners, query]);
	const visibleRoots = useMemo(() => {
		if (!searching) return roots;
		return roots.filter((root) => matched.has(root.name) || (leavesByRoot.get(root.name) ?? []).some((leaf) => matched.has(leaf.name)));
	}, [roots, leavesByRoot, matched, searching]);

	const toggle = (name: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	return (
		<aside className="w-full shrink-0 h-full bg-paper flex flex-col pl-3 pt-3" ref={attachRoot} tabIndex={-1} onClick={(event) => event.currentTarget.focus()}>
			<div className="conv-list-search">
				<input
					ref={searchRef}
					className="conv-list-input"
					type="text"
					placeholder="Search correspondence…"
					spellCheck={false}
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing || ime.composing) return;
						if (event.key !== "Escape" || query === "") return;
						event.preventDefault();
						setQuery("");
					}}
					onCompositionStart={ime.onStart}
					onCompositionEnd={(event) => ime.onEnd(event.nativeEvent, event.currentTarget)}
				/>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="default" size="icon" class="size-[26px] rounded-full electrobun-webkit-app-region-no-drag" title="Add Partner (⌘N)" onClick={props.onAddPartner}>
							<Plus size={13} />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add Partner (⌘N)</TooltipContent>
				</Tooltip>
			</div>

			{props.partners.length === 0 && !props.loading && <div className="px-1 py-3 text-[12px] text-muted">No partners yet</div>}

			{searching && props.partners.length > 0 && visibleRoots.length === 0 && (
				<div className="px-1 py-3">
					<p className="font-sans text-[12px] text-ink-soft">No letter matches</p>
					<p className="mt-1 font-mono text-[10px] text-muted">
						<button type="button" className="cursor-pointer hover:text-ink" onClick={() => setQuery("")}>
							clear the filter
						</button>
						· ⌘P searches everything
					</p>
				</div>
			)}

			<div className="conv-rows">
				{props.partners.length === 0 && props.loading
					? Array.from({ length: SKELETON_ROWS }, (_, index) => (
							<div className="conv-skeleton" key={index} aria-busy="true">
								<span className="conv-skeleton-face" />
								<span className="conv-skeleton-lines">
									<span className="conv-skeleton-line" />
									<span className="conv-skeleton-line preview" />
								</span>
							</div>
						))
					: visibleRoots.map((root) => {
							const leaves = leavesByRoot.get(root.name) ?? [];
							const isExpanded = expanded.has(root.name) || (searching && leaves.some((leaf) => matched.has(leaf.name)));
							return (
								<Fragment key={root.name}>
									<ChatRow
										partner={root}
										selected={props.selected === root.name}
										working={workingFor(root.name)}
										unread={props.unread(root.name)}
										childCount={leaves.length}
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
