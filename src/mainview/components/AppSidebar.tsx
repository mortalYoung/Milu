import {
	ArrowUpFromLine,
	ChevronDown,
	ChevronRight,
	Copy,
	CopyPlus,
	Files,
	FolderOpen,
	FolderTree,
	GitFork,
	Info,
	MoreVertical,
	PanelLeftClose,
	Search,
	Settings,
	SquarePen,
	Trash2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import miluMark from "../../../assets/milu.png";
import { registerSurfaceRoot } from "../lib/active-surface";
import { activityAt, filterPartners, listTime, previewFor } from "../lib/chat-preview";
import { copyText } from "../lib/clipboard";
import { formatWorkspacePath } from "../lib/composer-input";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { useFindHandler } from "../lib/find";
import { imeGuard } from "../lib/ime";
import { Show } from "../lib/jsx";
import { useScrollEdges } from "../lib/scroll-edges";
import type { PartnerItem } from "../lib/session";
import { SURFACE } from "../lib/surfaces";
import { isInteractive } from "../lib/utils";
import { zoomOnDoubleClick } from "../lib/zoom";
import { Button } from "./Button";
import { MiluWordmark } from "./MiluWordmark";
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
import { Kbd, KbdGroup } from "./ui/kbd";
import { Tip, Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type { PartnerItem };

const byRecency = (a: PartnerItem, b: PartnerItem) => activityAt(b) - activityAt(a);

const SKELETON_ROWS = 5;

const MENU_ITEM_CLASS = "px-2 py-1 text-[14px] gap-1.5 text-ink focus:text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10";

function DeleteMenuItem(props: { onSelect: () => void }) {
	return (
		<DropdownMenuItem onSelect={props.onSelect} className={MENU_ITEM_CLASS + " text-signal focus:text-signal"}>
			<Trash2 size={13} />
			<span>Delete</span>
		</DropdownMenuItem>
	);
}

/** A row's workspace label: the repo's name (a linked worktree says so with its icon), or the path when it is not a repo. */
function workspaceLabel(partner: PartnerItem): string {
	if (partner.workspace && (partner.workspaceKind === "worktree" || partner.workspaceKind === "repo") && partner.workspaceRepo) return partner.workspaceRepo;
	return formatWorkspacePath(partner.workspace ?? "", 30);
}

/** One place a row sends a folder. The entries are whatever this machine actually has — the list is
 *  probed once at startup, so the menu never offers an app that isn't installed. */
export interface OpenTargets {
	editors: { id: string; name: string }[];
	finder: boolean;
}

function OpenSub(props: { label: string; path: string | null; targets: OpenTargets; onOpenPath: (path: string, editorId?: string, via?: "default" | "finder") => void }) {
	if (!props.path) return null;
	const path = props.path;
	const open = (via?: "default" | "finder", editorId?: string) => props.onOpenPath(path, editorId, via);
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="px-2 py-1 text-[14px] gap-1.5 text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10">
				<FolderOpen size={13} className="text-muted" />
				<span>{props.label}</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="min-w-44 p-1">
				<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => open("default")}>
					<span>Open with default</span>
				</DropdownMenuItem>
				{props.targets.finder && (
					<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => open("finder")}>
						<span>Open with Finder</span>
					</DropdownMenuItem>
				)}
				{props.targets.editors.map((editor) => (
					<DropdownMenuItem className={MENU_ITEM_CLASS} key={editor.id} onSelect={() => open(undefined, editor.id)}>
						<span>Open with {editor.name}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
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
	onOpenPath: (path: string, editorId?: string, via?: "default" | "finder") => void;
	openTargets: OpenTargets;
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
			<Avatar name={partner.name} variant={props.selected ? "ink" : "surface"} />
			<span className="conv-main">
				<span className="conv-name-row">
					<span className="conv-name-wrap">
						<span className="conv-name">{partner.name}</span>
						{props.childCount != null && props.childCount > 0 && (
							<Tip label={props.expanded ? "Collapse forks" : "Expand forks"}>
								<button
									type="button"
									className="conv-fork-count"
									aria-expanded={props.expanded}
									aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.childCount} fork${props.childCount === 1 ? "" : "s"} of ${partner.name}`}
									onClick={(event) => {
										event.stopPropagation();
										props.onToggle?.();
									}}
								>
									{props.expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
									{props.childCount}
								</button>
							</Tip>
						)}
					</span>
					<span className="conv-time">{listTime(activityAt(partner))}</span>
				</span>
				<span className="conv-preview">
					<span className="conv-preview-main">
						{props.working ? (
							<span className="conv-preview-dots">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</span>
						) : (
							previewFor(partner) || "—"
						)}
					</span>
					<Show when={props.unread}>
						<Tip label="new messages">
							<span className="conv-unread-dot" />
						</Tip>
					</Show>
				</span>
				<Show when={partner.workspace}>
					<Tip label={partner.workspace ?? ""}>
						<span className="conv-ws">
							{partner.workspaceKind === "worktree" && <FolderTree size={10} />}
							<span className="truncate">{workspaceLabel(partner)}</span>
						</span>
					</Tip>
				</Show>
			</span>
			<DropdownMenu
				open={openMenu}
				onOpenChange={(open) => {
					if (!open) menuClosedAt.current = Date.now();
					setOpenMenu(open);
				}}
			>
				<Tip label="More">
					<DropdownMenuTrigger
						className={"conv-ellipsis" + (openMenu ? " opacity-100" : " opacity-0 group-hover:opacity-100")}
						aria-label={`More actions for ${partner.name}`}
						onClick={(event) => event.stopPropagation()}
					>
						<MoreVertical size={14} />
					</DropdownMenuTrigger>
				</Tip>
				<DropdownMenuContent side="right" align="start" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="min-w-44 p-1">
					<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => props.onViewDetails()}>
						<Info size={13} className="text-muted" />
						<span>View details</span>
					</DropdownMenuItem>
					{isFork && (
						<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working} onSelect={() => props.onPromote()}>
							<ArrowUpFromLine size={13} className="text-muted" />
							<span>Promote</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator className="my-0.5" />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="px-2 py-1 text-[14px] gap-1.5 text-ink hover:bg-ink/10 focus:bg-ink/10 data-[highlighted]:bg-ink/10">
							<CopyPlus size={13} className="text-muted" />
							<span>Duplicate</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="min-w-44 p-1">
							<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working} onSelect={() => props.onDuplicate()}>
								<Files size={13} className="text-muted" />
								<span>duplicated</span>
							</DropdownMenuItem>
							<DropdownMenuItem className={MENU_ITEM_CLASS} disabled={props.working || isFork} onSelect={() => props.onFork()}>
								<GitFork size={13} className="text-muted" />
								<span>forked as children</span>
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator className="my-0.5" />
					<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => copyText(partner.path)}>
						<Copy size={13} className="text-muted" />
						<span>Copy directory path</span>
					</DropdownMenuItem>
					{partner.workspace && (
						<DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => copyText(partner.workspace ?? "")}>
							<Copy size={13} className="text-muted" />
							<span>Copy workspace path</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator className="my-0.5" />
					<OpenSub label="Open workspace" path={partner.workspace ?? null} targets={props.openTargets} onOpenPath={props.onOpenPath} />
					<OpenSub label="Open storage" path={partner.storage ?? null} targets={props.openTargets} onOpenPath={props.onOpenPath} />
					<DropdownMenuSeparator className="my-0.5" />
					<DeleteMenuItem onSelect={props.onDelete} />
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export function AppSidebar(props: {
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
	onToggleList: () => void;
	onOpenSettings: () => void;
	onOpenPath: (path: string, editorId?: string, via?: "default" | "finder") => void;
	openTargets: OpenTargets;
}) {
	const status = useAgentStatus();
	const writing = useStore(status.store, (state) => state.writing);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchTip, setSearchTip] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const listEdges = useScrollEdges([props.partners, query, expanded, props.loading]);
	const attachRoot = useCallback((element: HTMLElement | null) => {
		if (!element) return;
		return registerSurfaceRoot(element, SURFACE.chatList);
	}, []);
	const imeRef = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!imeRef.current) imeRef.current = imeGuard(setQuery);
	const ime = imeRef.current;

	const workingFor = (name: string) => writing[name] ?? props.partners.find((p) => p.name === name)?.writing ?? false;

	const closeSearch = () => {
		setSearchOpen(false);
		setQuery("");
	};

	useEffect(() => {
		if (!searchOpen) return;
		searchRef.current?.focus();
		searchRef.current?.select();
	}, [searchOpen]);

	useEscapeLayer({
		id: `${SURFACE.chatList}.search`,
		order: ESCAPE_ORDER.chatListSearch,
		isOpen: () => searchOpen,
		close: closeSearch,
	});

	useFindHandler(SURFACE.chatList, () => {
		const input = searchRef.current;
		if (!input || input.closest("[inert]")) return false;
		if (searchOpen) {
			input.focus();
			input.select();
			return true;
		}
		setSearchOpen(true);
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
		<aside
			className="sidebar"
			ref={attachRoot}
			tabIndex={-1}
			onClick={(event) => {
				/* the search box and the rows keep their own focus */
				if (isInteractive(event.target)) return;
				event.currentTarget.focus();
			}}
		>
			<div className="sidebar-windowbar electrobun-webkit-app-region-drag" onDoubleClick={zoomOnDoubleClick}>
				<div className={"conv-search" + (searchOpen ? " open" : "")}>
					<Tooltip delayDuration={150} open={searchOpen ? false : searchTip} onOpenChange={setSearchTip}>
						<TooltipTrigger asChild>
							<button
								type="button"
								className="conv-icon-btn electrobun-webkit-app-region-no-drag"
								aria-expanded={searchOpen}
								aria-label={searchOpen ? "Close search" : "Search chats"}
								onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
							>
								<Search size={14} />
							</button>
						</TooltipTrigger>
						<TooltipContent>Search chats (⌘F)</TooltipContent>
					</Tooltip>
					<span className="conv-search-slide">
						<input
							ref={searchRef}
							className="conv-list-input electrobun-webkit-app-region-no-drag"
							type="text"
							placeholder="Search chats"
							aria-label="Search chats"
							spellCheck={false}
							tabIndex={searchOpen ? 0 : -1}
							aria-hidden={searchOpen ? undefined : true}
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							onBlur={() => query === "" && setSearchOpen(false)}
							onKeyDown={(event) => {
								if (event.nativeEvent.isComposing || ime.composing) return;
								if (event.key !== "Escape") return;
								event.preventDefault();
								if (query === "") closeSearch();
								else setQuery("");
							}}
							onCompositionStart={ime.onStart}
							onCompositionEnd={(event) => ime.onEnd(event.nativeEvent, event.currentTarget)}
						/>
					</span>
				</div>
				<Tip label="Create (⌘N)">
					<button type="button" className="conv-icon-btn electrobun-webkit-app-region-no-drag" aria-label="Create a chat" onClick={props.onAddPartner}>
						<SquarePen size={14} />
					</button>
				</Tip>
				<Tip label="Hide chat list (⌘B)">
					<button type="button" className="sidebar-toggle electrobun-webkit-app-region-no-drag" aria-label="Hide chat list" onClick={props.onToggleList}>
						<PanelLeftClose size={16} />
					</button>
				</Tip>
			</div>

			<div className="sidebar-brand">
				<img className="brand-mark" src={miluMark} alt="" />
				<MiluWordmark class="sidebar-wordmark" />
			</div>

			<div className="sidebar-body">
				{props.partners.length === 0 && !props.loading && <div className="px-2 pt-1 text-[13px] text-muted">no chats yet</div>}

				{searching && props.partners.length > 0 && visibleRoots.length === 0 && (
					<div className="px-1 py-3">
						<p className="font-sans text-[13px] text-ink-soft">No chats match</p>
						<p className="mt-1 font-mono text-[10px] text-muted">
							<button type="button" className="cursor-pointer hover:text-ink" onClick={() => setQuery("")}>
								clear the filter
							</button>
							· ⌘P searches everything
						</p>
					</div>
				)}

				<div className={"conv-rows" + (listEdges.above ? " has-above" : "") + (listEdges.below ? " has-below" : "")} ref={listEdges.ref}>
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
											onOpenPath={props.onOpenPath}
											openTargets={props.openTargets}
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
													onOpenPath={props.onOpenPath}
													openTargets={props.openTargets}
												/>
											))}
									</Fragment>
								);
							})}
				</div>
			</div>

			<Tip label="Settings">
				<button type="button" className="sidebar-foot" aria-label="Settings" onClick={props.onOpenSettings}>
					<Settings size={15} />
					<KbdGroup className="ml-auto">
						<Kbd>⌘</Kbd>
						<Kbd>,</Kbd>
					</KbdGroup>
				</button>
			</Tip>

			<Dialog open={confirmDelete != null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
				<DialogContent size={{ w: 320 }}>
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
