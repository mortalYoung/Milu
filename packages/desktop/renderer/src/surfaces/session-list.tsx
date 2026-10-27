import type { ContributionItem, SessionRow } from "@milu/protocol";
import { activityAt, byPinThenRecency, filterSessions, formatHotkey, type Host, Kbd, KbdGroup, listTime, previewFor, type SurfaceProps, workspaceLabel } from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon, IconByName, MoreVerticalIcon, PanelLeftCloseIcon, SearchIcon } from "../components/icons.tsx";
import { MiluWordmark } from "../components/MiluWordmark.tsx";
import { Menu, MenuContent, MenuItems, MenuTrigger } from "../components/row-menu.tsx";

function Row(props: {
	host: Host;
	session: SessionRow;
	selected: boolean;
	writing: boolean;
	unread: boolean;
	leaf?: boolean;
	childCount?: number;
	expanded?: boolean;
	onSelect: () => void;
	onToggle?: () => void;
	onRun: (item: ContributionItem) => void;
}) {
	const { session } = props;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuClosedAt = useRef(0);

	return (
		<div
			className={`group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover${props.selected ? " bg-selected" : ""}${props.leaf ? " ml-5" : ""}`}
			role="button"
			tabIndex={0}
			aria-current={props.selected ? "true" : undefined}
			onClick={() => {
				if (Date.now() - menuClosedAt.current < 200) return;
				props.onSelect();
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				setMenuOpen(true);
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				props.onSelect();
			}}
		>
			<span
				className={`flex size-7 shrink-0 items-center justify-center rounded-full font-serif text-[14px] font-semibold leading-none ${
					props.selected ? "bg-ink text-canvas" : "border border-line bg-surface text-ink"
				}`}
			>
				<span className="block translate-y-[0.1em] leading-none">{session.name.charAt(0)}</span>
			</span>
			<span className="flex min-w-0 flex-1 flex-col leading-tight">
				<span className="flex min-w-0 items-baseline justify-between gap-2">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate font-serif text-[16px] font-semibold text-ink">{session.name}</span>
						{props.childCount ? (
							<button
								type="button"
								className="inline-flex h-[15px] shrink-0 cursor-pointer items-center gap-0.5 rounded-full border border-line bg-transparent px-[5px] font-mono text-[10px] leading-none text-muted transition-colors hover:bg-hover hover:text-ink aria-expanded:text-ink"
								aria-expanded={props.expanded}
								aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.childCount} fork${props.childCount === 1 ? "" : "s"} of ${session.name}`}
								onClick={(event) => {
									event.stopPropagation();
									props.onToggle?.();
								}}
							>
								{props.expanded ? <ChevronDownIcon size={9} /> : <ChevronRightIcon size={9} />}
								{props.childCount}
							</button>
						) : null}
					</span>
					<span className="whitespace-nowrap font-sans text-[12px] tracking-[0.03em] text-muted">{activityAt(session) ? listTime(activityAt(session)) : ""}</span>
				</span>
				<span className="mt-0.5 flex min-w-0 items-center gap-2 font-sans text-[13px] text-muted">
					<span className="min-w-0 flex-1 truncate">
						{props.writing ? (
							<span className="inline-flex items-center gap-[3px] pt-[3px]">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</span>
						) : (
							previewFor(session) || "—"
						)}
					</span>
					{props.unread ? (
						<Tip label="new messages">
							<span className="inline-block size-1.5 shrink-0 rounded-full bg-signal" />
						</Tip>
					) : null}
				</span>
				{session.workspace ? (
					<span className="mt-[3px] flex min-w-0 items-center gap-[3px] font-mono text-[10px] text-muted-soft [&>svg]:shrink-0">
						{session.workspaceKind === "worktree" ? <FolderTreeIcon size={10} /> : null}
						<span className="truncate">{workspaceLabel(session)}</span>
					</span>
				) : null}
			</span>
			<Menu
				open={menuOpen}
				onOpenChange={(open) => {
					if (!open) menuClosedAt.current = Date.now();
					setMenuOpen(open);
				}}
			>
				<MenuTrigger asChild>
					<button
						type="button"
						className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-[color-mix(in_srgb,var(--chrome)_80%,transparent)] text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100"
						aria-label={`More actions for ${session.name}`}
						onClick={(event) => event.stopPropagation()}
					>
						<MoreVerticalIcon size={14} />
					</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItems items={session.menu ?? []} onRun={props.onRun} />
				</MenuContent>
			</Menu>
		</div>
	);
}

export function SessionListSurface(props: SurfaceProps) {
	const { host } = props;
	const rows = useStore(host.sessions.store, (state) => state.rows);
	const selected = useStore(host.selection.store, (state) => state.selected);
	const searchOpen = useStore(host.workbench.store, (state) => state.searchOpen);
	const headerItems = useStore(host.header.store, (state) => state.items);
	const footerItems = useStore(host.footer.store, (state) => state.items);
	const bindings = useStore(host.hotkeys.store, (state) => state.bindings);

	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [edges, setEdges] = useState({ above: false, below: false });
	const searchRef = useRef<HTMLInputElement>(null);
	const rowsRef = useRef<HTMLDivElement>(null);

	const start = (item: ContributionItem, session: string): void => {
		if (item.action) void run(item, session);
	};

	const run = async (item: ContributionItem, session: string): Promise<void> => {
		if (!item.action) return;
		await host.actions.invoke(item.action, session, item.args);
		await host.sessions.refresh();
	};
	const closeSearch = () => {
		host.workbench.setSearch(false);
		setQuery("");
	};

	useEffect(() => {
		if (!searchOpen) return;
		searchRef.current?.focus();
		searchRef.current?.select();
	}, [searchOpen]);

	useEffect(() => {
		const element = rowsRef.current;
		if (!element) return;
		const measure = () =>
			setEdges({
				above: element.scrollTop > 2,
				below: element.scrollTop + element.clientHeight < element.scrollHeight - 2,
			});
		measure();
		element.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			element.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [rows, query, expanded]);

	const roots = useMemo(() => rows.filter((session) => !session.forkedFrom || !rows.some((each) => each.name === session.forkedFrom)).sort(byPinThenRecency), [rows]);
	const leavesByRoot = useMemo(() => {
		const map = new Map<string, SessionRow[]>();
		for (const session of rows) {
			if (!session.forkedFrom) continue;
			const list = map.get(session.forkedFrom) ?? [];
			list.push(session);
			map.set(session.forkedFrom, list);
		}
		for (const list of map.values()) list.sort(byPinThenRecency);
		return map;
	}, [rows]);

	const searching = query.trim() !== "";
	const matched = useMemo(() => new Set(filterSessions(rows, query).map((session) => session.name)), [rows, query]);
	const visibleRoots = useMemo(() => {
		if (!searching) return roots;
		return roots.filter((root) => matched.has(root.name) || (leavesByRoot.get(root.name) ?? []).some((leaf) => matched.has(leaf.name)));
	}, [roots, leavesByRoot, matched, searching]);

	const selectedParent = rows.find((session) => session.name === selected)?.forkedFrom;
	const pinnedRoots = searching ? [] : visibleRoots.filter((root) => root.pinned === true);
	const restRoots = searching ? visibleRoots : visibleRoots.filter((root) => root.pinned !== true);

	const toggle = (name: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	const renderRoot = (root: SessionRow) => {
		const leaves = leavesByRoot.get(root.name) ?? [];
		const isExpanded = root.name === selectedParent || expanded.has(root.name) || (searching && leaves.some((leaf) => matched.has(leaf.name)));
		return (
			<div key={root.name}>
				<Row
					host={host}
					session={root}
					selected={selected === root.name}
					writing={root.running}
					unread={(root.lastMessageAt ?? 0) > (root.readAt ?? 0)}
					childCount={leaves.length}
					expanded={isExpanded}
					onSelect={() => {
						host.workbench.showView(null);
						void host.selection.select(root.name);
					}}
					onToggle={() => toggle(root.name)}
					onRun={(item) => start(item, root.name)}
				/>
				{isExpanded
					? leaves.map((leaf) => (
							<Row
								key={leaf.name}
								host={host}
								session={leaf}
								selected={selected === leaf.name}
								writing={leaf.running}
								unread={(leaf.lastMessageAt ?? 0) > (leaf.readAt ?? 0)}
								leaf
								onSelect={() => {
									host.workbench.showView(null);
									void host.selection.select(leaf.name);
								}}
								onRun={(item) => start(item, leaf.name)}
							/>
						))
					: null}
			</div>
		);
	};

	return (
		<div className="flex h-full min-h-0 flex-col px-3">
			<div className="flex h-[52px] flex-none items-center justify-end gap-2 pl-[76px] [-webkit-app-region:drag]">
				<div className={`flex h-8 min-w-0 flex-1 items-center rounded-md border transition-colors duration-150 ${searchOpen ? "border-line bg-surface" : "border-transparent"}`}>
					<Tip label="Search sessions (⌘F)">
						<button
							type="button"
							className="grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-soft transition-colors duration-100 hover:bg-hover hover:text-ink [-webkit-app-region:no-drag]"
							aria-expanded={searchOpen}
							aria-label={searchOpen ? "Close search" : "Search sessions"}
							onClick={() => (searchOpen ? closeSearch() : host.workbench.setSearch(true))}
						>
							<SearchIcon />
						</button>
					</Tip>
					<span className={`flex min-w-0 flex-1 items-center overflow-hidden pr-2 transition-[max-width] duration-150 ${searchOpen ? "max-w-full" : "max-w-0"}`}>
						<input
							ref={searchRef}
							className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[14px] text-ink outline-none placeholder:text-muted"
							type="text"
							placeholder="Search sessions"
							aria-label="Search sessions"
							spellCheck={false}
							tabIndex={searchOpen ? 0 : -1}
							aria-hidden={searchOpen ? undefined : true}
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							onBlur={() => query === "" && host.workbench.setSearch(false)}
							onKeyDown={(event) => {
								if (event.nativeEvent.isComposing) return;
								if (event.key !== "Escape") return;
								event.preventDefault();
								if (query === "") closeSearch();
								else setQuery("");
							}}
						/>
					</span>
				</div>
				{headerItems.map((item) => (
					<Tip key={item.id} label={item.title}>
						<button
							type="button"
							className="grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-soft transition-colors duration-100 hover:bg-hover hover:text-ink [-webkit-app-region:no-drag]"
							aria-label={item.title}
							onClick={() => void host.actions.invoke(item.action ?? "")}
						>
							<IconByName name={item.icon} size={14} />
						</button>
					</Tip>
				))}
				<Tip label="Hide session list (⌘B)">
					<button
						type="button"
						className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-soft transition-colors duration-100 hover:bg-hover hover:text-ink [-webkit-app-region:no-drag]"
						aria-label="Hide session list"
						onClick={() => host.columns.closeList()}
					>
						<PanelLeftCloseIcon size={16} />
					</button>
				</Tip>
			</div>

			<div className="flex h-11 flex-none items-center gap-3 border-b border-line text-ink">
				<img className="size-[26px] shrink-0 rounded-[6px]" src="/pixel_milu.png" alt="" />
				<MiluWordmark class="h-5 w-auto shrink-0" />
			</div>

			<div className="flex min-h-0 flex-1 flex-col pt-2">
				{rows.length === 0 ? <div className="px-2 py-1 text-[13px] text-muted">no sessions yet</div> : null}

				{searching && rows.length > 0 && visibleRoots.length === 0 ? (
					<div className="px-1 py-3">
						<p className="m-0 text-[13px] text-ink-soft">No sessions match</p>
						<p className="m-0 mt-1 font-mono text-[10px] text-muted">
							<button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[inherit] hover:text-ink" onClick={() => setQuery("")}>
								clear the filter
							</button>
						</p>
					</div>
				) : null}

				<div className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""}`} ref={rowsRef}>
					{
						<>
							{pinnedRoots.length > 0 ? <div className="px-2 pt-4 pb-1.5 font-sans text-[10px] font-semibold tracking-[0.16em] text-muted-soft uppercase">Pinned</div> : null}
							{pinnedRoots.map(renderRoot)}
							{pinnedRoots.length > 0 && restRoots.length > 0 ? <div className="h-2.5 shrink-0" aria-hidden="true" /> : null}
							{restRoots.map(renderRoot)}
						</>
					}
				</div>
			</div>

			{footerItems.length === 0 ? null : (
				<div className="shrink-0 pt-1 pb-2">
					{footerItems.map((item) => {
						const binding = bindings.find((each) => each.id === item.action);
						const keys = binding ? formatHotkey(binding.hotkey, host.hotkeys.platform) : "";
						return (
							<Tip key={item.id} label={item.title}>
								<button
									type="button"
									className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-ink transition-colors duration-100 hover:bg-hover [-webkit-app-region:no-drag]"
									aria-label={item.title}
									onClick={() => void host.actions.invoke(item.action ?? "")}
								>
									<IconByName name={item.icon} size={15} />
									{keys === "" ? null : (
										<KbdGroup className="ml-auto">
											{keys.split("").map((key, index) => (
												<Kbd key={index}>{key}</Kbd>
											))}
										</KbdGroup>
									)}
								</button>
							</Tip>
						);
					})}
				</div>
			)}
		</div>
	);
}
