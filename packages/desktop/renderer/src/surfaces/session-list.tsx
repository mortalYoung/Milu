import type { ContributionItem, SessionRow } from "@milu/protocol";
import {
	activityAt,
	byPinThenRecency,
	filterSessions,
	formatHotkey,
	type Host,
	Kbd,
	KbdGroup,
	listTime,
	previewFor,
	type SessionListView,
	type SurfaceProps,
	workspaceLabel,
} from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { mark } from "../boot.ts";
import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon, GitForkIcon, IconByName, MoreVerticalIcon, PanelLeftCloseIcon, PinIcon, SearchIcon } from "../components/icons.tsx";
import { MiluWordmark } from "../components/MiluWordmark.tsx";
import { Menu, MenuContent, MenuItems, MenuTrigger } from "../components/row-menu.tsx";
import { SessionListSkeleton } from "../components/skeletons.tsx";

function previewText(row: SessionRow): string {
	const text = previewFor(row);
	return text.startsWith("You: ") ? text.slice(5) : text;
}

function groupLabel(key: string): string {
	const trimmed = key.replace(/[\\/]+$/, "");
	return trimmed.split(/[\\/]/).pop() ?? "";
}

function Row(props: {
	host: Host;
	session: SessionRow;
	view: SessionListView;
	selected: boolean;
	unread: boolean;
	family: string | null;
	forks: number;
	showWorkspace: boolean;
	onSelect: () => void;
	onFamily: (name: string | null) => void;
	onRun: (item: ContributionItem) => void;
}) {
	const { session, view } = props;
	const forking = session.forking === true;
	const pinned = session.pinned === true;
	const preview = forking ? "forking…" : previewText(session);
	const familyActive = props.family !== null && (session.name === props.family || session.forkedFrom === props.family);
	const when = activityAt(session) ? listTime(activityAt(session)) : "";
	const workspace = workspaceLabel(session);
	const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuClosedAt = useRef(0);
	const active = menuOpen || pointer !== null;

	const pin = pinned ? (
		<span className="inline-flex shrink-0" title="pinned">
			<PinIcon size={9} className="text-muted" />
		</span>
	) : null;
	const runningDot = session.running ? <span className="work-dot" title="running" /> : null;
	const unread = props.unread ? <span className="size-[5px] shrink-0 rounded-full bg-ink" title="new messages" /> : null;
	const workspaceNode =
		workspace === "" ? (
			<span className="text-muted-soft">-</span>
		) : (
			<span className="inline-flex min-w-0 items-center gap-[3px]" title={session.workspace ?? workspace}>
				{session.workspaceKind === "worktree" ? <FolderTreeIcon size={9} className="shrink-0" /> : null}
				<span className="truncate">{workspace}</span>
			</span>
		);
	const forkOf =
		session.forkedFrom === undefined ? null : (
			<span className="session-fork session-fork-parent" title={`fork of ${session.forkedFrom}`}>
				<GitForkIcon size={9} />
				<span className="max-w-[78px] truncate">{session.forkedFrom}</span>
			</span>
		);
	const signalList = session.signals ?? [];
	const signals =
		signalList.length > 0 ? (
			<span className="flex shrink-0 items-center gap-1">
				{signalList.map((signal) => (
					<span key={signal.id} role="img" aria-label={signal.title} title={signal.title} className="inline-flex text-muted">
						<IconByName name={signal.icon} size={9} />
					</span>
				))}
			</span>
		) : null;
	const hasMeta = props.showWorkspace;
	const forkButton =
		props.forks > 0 ? (
			<button
				type="button"
				className="session-fork"
				aria-pressed={props.family === session.name}
				aria-label={`${props.forks} ${props.forks === 1 ? "fork" : "forks"} — ${props.family === session.name ? "clear family highlight" : "highlight family"}`}
				title={`${props.forks} ${props.forks === 1 ? "fork" : "forks"} — ${props.family === session.name ? "clear family highlight" : "highlight family"}`}
				onClick={(event) => {
					event.stopPropagation();
					props.onFamily(props.family === session.name ? null : session.name);
				}}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<GitForkIcon size={9} />
				<span>{props.forks}</span>
			</button>
		) : null;
	const time = when === "" ? null : <span className="shrink-0 font-mono text-[9.5px] text-muted-soft">{when}</span>;

	const detail = (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="flex min-w-0 items-baseline gap-1.5 font-mono text-[9.5px] leading-[1.3] text-muted">
				{workspaceNode}
				<span className="ml-auto flex shrink-0 items-center gap-1.5">
					{signals}
					{runningDot}
					{pin}
					{time}
				</span>
			</span>
			<span className="mt-0.5 flex min-w-0 items-center gap-1.5">
				<span className="flex min-w-0 flex-1 items-center gap-1 font-serif text-[15px] font-semibold leading-[1.2] tracking-[-0.005em] text-ink">
					<span className="truncate">{session.name}</span>
				</span>
				{unread}
				{forkButton}
				{forkOf}
			</span>
			<span className="mt-0.5 truncate font-sans text-[12px] leading-[1.35] text-muted">{preview || "—"}</span>
		</span>
	);

	const compact = (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="flex min-w-0 items-center gap-1.5">
				<span className="flex min-w-0 max-w-[56%] items-center gap-1 font-serif text-[15px] font-semibold leading-[1.2] tracking-[-0.005em] text-ink">
					<span className="truncate">{session.name}</span>
				</span>
				<span className="min-w-0 flex-1 truncate font-sans text-[11.5px] leading-[1.35] text-muted">{preview || "—"}</span>
				{unread}
				{forkButton}
				{forkOf}
				{signals}
				{runningDot}
				{pin}
				{time}
			</span>
			{hasMeta ? (
				<span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] leading-[1.3] text-muted">{props.showWorkspace ? workspaceNode : null}</span>
			) : null}
		</span>
	);

	const groupRow = (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="flex min-w-0 items-center gap-1.5">
				<span className="flex min-w-0 max-w-[56%] items-center gap-1 font-serif text-[14.5px] font-semibold leading-[1.2] tracking-[-0.005em] text-ink">
					<span className="truncate">{session.name}</span>
				</span>
				<span className="min-w-0 flex-1 truncate font-sans text-[11.5px] leading-[1.35] text-muted">{preview || "—"}</span>
				{unread}
				{forkButton}
				{forkOf}
				{signals}
				{runningDot}
				{pin}
				{time}
			</span>
			{hasMeta ? (
				<span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] leading-[1.3] text-muted">{props.showWorkspace ? workspaceNode : null}</span>
			) : null}
		</span>
	);

	return (
		<div
			className={`group relative flex cursor-pointer gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover${forking ? " cursor-default" : ""}${props.selected ? " bg-selected" : ""}${active ? " bg-selected ring-1 ring-line-strong ring-inset" : ""}${familyActive ? " session-family" : ""}`}
			role="button"
			tabIndex={0}
			aria-disabled={forking ? true : undefined}
			aria-current={props.selected ? "true" : undefined}
			onClick={() => {
				if (forking || Date.now() - menuClosedAt.current < 200) return;
				props.onSelect();
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				setPointer({ x: event.clientX, y: event.clientY });
			}}
			onKeyDown={(event) => {
				if (forking || (event.key !== "Enter" && event.key !== " ")) return;
				event.preventDefault();
				props.onSelect();
			}}
		>
			{view === "detail" ? detail : view === "groups" ? groupRow : compact}
			<Menu
				onOpenChange={(open) => {
					setMenuOpen(open);
					if (!open) menuClosedAt.current = Date.now();
				}}
			>
				<MenuTrigger asChild>
					<button
						type="button"
						className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-[color-mix(in_srgb,var(--chrome)_80%,transparent)] text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100"
						aria-label={`More actions for ${session.name}`}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => event.stopPropagation()}
					>
						<MoreVerticalIcon size={14} />
					</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItems items={session.menu ?? []} onRun={props.onRun} />
				</MenuContent>
			</Menu>

			{pointer === null ? null : (
				<Menu
					open
					onOpenChange={(open) => {
						if (open) return;
						menuClosedAt.current = Date.now();
						setPointer(null);
					}}
				>
					<MenuTrigger asChild>
						<span aria-hidden tabIndex={-1} style={{ position: "fixed", left: pointer.x, top: pointer.y, width: 1, height: 1 }} />
					</MenuTrigger>
					<MenuContent>
						<MenuItems items={session.menu ?? []} onRun={props.onRun} />
					</MenuContent>
				</Menu>
			)}
		</div>
	);
}

export function SessionListSurface(props: SurfaceProps) {
	const { host } = props;
	const rows = useStore(host.sessions.store, (state) => state.rows);
	const arrived = useStore(host.sessions.store, (state) => state.arrived);
	const view = useStore(host.sessions.store, (state) => state.view);
	const selected = useStore(host.selection.store, (state) => state.selected);
	const searchOpen = useStore(host.workbench.store, (state) => state.searchOpen);
	const hasData = rows.length > 0 && selected === "";
	useEffect(() => {
		if (!hasData) return;
		mark("list");
	}, [hasData]);
	const headerItems = useStore(host.header.store, (state) => state.items);
	const footerItems = useStore(host.footer.store, (state) => state.items);
	const bindings = useStore(host.hotkeys.store, (state) => state.bindings);

	const [query, setQuery] = useState("");
	const [family, setFamily] = useState<string | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
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
	}, [rows, query, view, family, arrived]);

	const searching = query.trim() !== "";
	const matchedRows = useMemo(() => (searching ? filterSessions(rows, query) : []), [rows, query, searching]);
	const orderedRows = useMemo(() => [...rows].sort(byPinThenRecency), [rows]);
	const forkCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const row of rows) {
			if (row.forkedFrom === undefined) continue;
			counts.set(row.forkedFrom, (counts.get(row.forkedFrom) ?? 0) + 1);
		}
		return counts;
	}, [rows]);
	const ungroupedRows = useMemo(() => rows.filter((row) => !row.workspace).sort(byPinThenRecency), [rows]);
	const groups = useMemo(() => {
		const map = new Map<string, SessionRow[]>();
		for (const row of rows) {
			if (!row.workspace) continue;
			const key = row.workspace;
			const list = map.get(key) ?? [];
			list.push(row);
			map.set(key, list);
		}
		return [...map.entries()]
			.map(([key, list]) => ({
				key,
				label: groupLabel(key),
				full: key,
				rows: [...list].sort(byPinThenRecency),
				activity: Math.max(...list.map((row) => activityAt(row))),
			}))
			.sort((left, right) => right.activity - left.activity || left.label.localeCompare(right.label));
	}, [rows]);

	const toggleGroup = (key: string) =>
		setCollapsedGroups((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	const rowProps = (session: SessionRow, showWorkspace: boolean) => ({
		host,
		session,
		view,
		selected: selected === session.name,
		unread: (session.lastMessageAt ?? 0) > (session.readAt ?? 0),
		family,
		forks: forkCounts.get(session.name) ?? 0,
		showWorkspace,
		onSelect: () => {
			host.workbench.showView(null);
			void host.selection.select(session.name);
		},
		onFamily: (name: string | null) => setFamily(name),
		onRun: (item: ContributionItem) => start(item, session.name),
	});

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
				{!arrived ? (
					<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
						<SessionListSkeleton />
					</div>
				) : (
					<>
						{rows.length === 0 ? <div className="px-2 py-1 text-[13px] text-muted">no sessions yet</div> : null}

						{searching && rows.length > 0 && matchedRows.length === 0 ? (
							<div className="px-1 py-3">
								<p className="m-0 text-[13px] text-ink-soft">No sessions match</p>
								<p className="m-0 mt-1 font-mono text-[10px] text-muted">
									<button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[inherit] hover:text-ink" onClick={() => setQuery("")}>
										clear the filter
									</button>
								</p>
							</div>
						) : null}

						<div className={`edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""} flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto`} ref={rowsRef}>
							{searching ? (
								matchedRows.map((session) => <Row key={session.name} {...rowProps(session, true)} />)
							) : view === "groups" ? (
								<>
									{ungroupedRows.map((session) => (
										<Row key={session.name} {...rowProps(session, false)} />
									))}
									{groups.map((group) => {
										const collapsed = collapsedGroups.has(group.key);
										return (
											<div className="flex flex-col gap-0.5" key={group.key}>
												<div
													className="sticky top-0 z-[2] flex h-[22px] shrink-0 items-center gap-1.5 border-b border-line bg-chrome px-1.5 font-mono text-[9.5px] text-muted"
													title={group.full}
												>
													<FolderTreeIcon size={10} className="shrink-0 text-muted-soft" />
													<span className="min-w-0 truncate">{group.label}</span>
													<button
														type="button"
														className="ml-auto grid size-4 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink"
														aria-expanded={!collapsed}
														aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label}`}
														title={collapsed ? "Expand" : "Collapse"}
														onClick={() => toggleGroup(group.key)}
													>
														{collapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
													</button>
												</div>
												{!collapsed && group.rows.map((session) => <Row key={session.name} {...rowProps(session, false)} />)}
											</div>
										);
									})}
								</>
							) : (
								orderedRows.map((session) => <Row key={session.name} {...rowProps(session, true)} />)
							)}
						</div>
					</>
				)}
			</div>

			<div className="shrink-0 pt-1 pb-2">
				{footerItems.length === 0
					? null
					: footerItems.map((item) => {
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
		</div>
	);
}
