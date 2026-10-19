import { activityAt, byPinThenRecency, filterSessions, type Host, listTime, previewFor, type SurfaceProps, workspaceLabel } from "@milu/client";
import type { SessionRow } from "@milu/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { copyPath } from "../clipboard.ts";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, FolderTreeIcon, MoreVerticalIcon, PanelLeftCloseIcon, PinIcon, PinOffIcon, SearchIcon } from "../components/icons.tsx";
import { MiluWordmark } from "../components/MiluWordmark.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, OpenMenu } from "../components/row-menu.tsx";
import { useStore } from "../use-store.ts";

const SKELETON_ROWS = 5;

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
}) {
	const { host, session } = props;
	const targets = useStore(host.opener.targets);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuClosedAt = useRef(0);

	return (
		<div
			className={`conv-item${props.selected ? " selected" : ""}${props.leaf ? " ml-5" : ""}`}
			role="button"
			tabIndex={0}
			aria-current={props.selected ? "true" : undefined}
			onClick={() => {
				// A click that dismissed the menu must not also pick the row it was pointing at.
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
			<span className={`conv-avatar ${props.selected ? "avatar-ink" : "avatar-paper"}`}>
				<span className="avatar-initial">{session.name.charAt(0)}</span>
			</span>
			<span className="conv-main">
				<span className="conv-name-row">
					<span className="conv-name-wrap">
						<span className="conv-name">{session.name}</span>
						{props.childCount ? (
							<button
								type="button"
								className="conv-fork-count"
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
					<span className="conv-time">{activityAt(session) ? listTime(activityAt(session)) : ""}</span>
				</span>
				<span className="conv-preview">
					<span className="conv-preview-main">
						{props.writing ? (
							<span className="conv-preview-dots">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</span>
						) : (
							previewFor(session) || "—"
						)}
					</span>
					{props.unread ? <span className="conv-unread-dot" title="new messages" /> : null}
				</span>
				{session.workspace ? (
					<span className="conv-ws" title={session.workspace}>
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
					<button type="button" className="conv-ellipsis" aria-label={`More actions for ${session.name}`} onClick={(event) => event.stopPropagation()}>
						<MoreVerticalIcon size={14} />
					</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem onSelect={() => void host.sessions.pin(session.name, session.pinned !== true)}>
						{session.pinned ? <PinOffIcon size={13} /> : <PinIcon size={13} />}
						<span>{session.pinned ? "Unpin" : "Pin"}</span>
					</MenuItem>
					<MenuSeparator />
					<MenuItem onSelect={() => void copyPath(session.path)}>
						<CopyIcon size={13} />
						<span>Copy directory path</span>
					</MenuItem>
					{session.workspace ? (
						<MenuItem onSelect={() => void copyPath(session.workspace ?? "")}>
							<CopyIcon size={13} />
							<span>Copy workspace path</span>
						</MenuItem>
					) : null}
					<MenuSeparator />
					<OpenMenu label="Open workspace" path={session.workspace ?? null} targets={targets} onOpen={(target) => void host.opener.open(session.workspace ?? "", target)} />
					<OpenMenu label="Open storage" path={session.storage} targets={targets} onOpen={(target) => void host.opener.open(session.storage, target)} />
				</MenuContent>
			</Menu>
		</div>
	);
}

export function SessionListSurface(props: SurfaceProps) {
	const { host } = props;
	const rows = useStore(host.sessions.rows);
	const arrived = useStore(host.sessions.arrived);
	const state = useStore(host.transcript.state);
	const listOpen = useStore(host.workbench.listOpen);
	const searchOpen = useStore(host.workbench.searchOpen);

	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [edges, setEdges] = useState({ above: false, below: false });
	const searchRef = useRef<HTMLInputElement>(null);
	const rowsRef = useRef<HTMLDivElement>(null);

	const selected = state.selected;
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
	}, [rows, query, expanded, listOpen, arrived]);

	const roots = useMemo(() => rows.filter((session) => !session.forkedFrom).sort(byPinThenRecency), [rows]);
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
					writing={host.transcript.running(root.name)}
					unread={(root.lastMessageAt ?? 0) > (root.readAt ?? 0)}
					childCount={leaves.length}
					expanded={isExpanded}
					onSelect={() => void host.transcript.select(root.name)}
					onToggle={() => toggle(root.name)}
				/>
				{isExpanded
					? leaves.map((leaf) => (
							<Row
								key={leaf.name}
								host={host}
								session={leaf}
								selected={selected === leaf.name}
								writing={host.transcript.running(leaf.name)}
								unread={(leaf.lastMessageAt ?? 0) > (leaf.readAt ?? 0)}
								leaf
								onSelect={() => void host.transcript.select(leaf.name)}
							/>
						))
					: null}
			</div>
		);
	};

	return (
		<aside className={`sidebar${listOpen ? "" : " collapsed"}`} tabIndex={-1}>
			<div className="sidebar-windowbar">
				<div className={`conv-search${searchOpen ? " open" : ""}`}>
					<button
						type="button"
						className="conv-icon-btn"
						aria-expanded={searchOpen}
						aria-label={searchOpen ? "Close search" : "Search sessions"}
						title="Search sessions (⌘F)"
						onClick={() => (searchOpen ? closeSearch() : host.workbench.setSearch(true))}
					>
						<SearchIcon />
					</button>
					<span className="conv-search-slide">
						<input
							ref={searchRef}
							className="conv-list-input"
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
				<button type="button" className="sidebar-toggle" aria-label="Hide session list" title="Hide session list (⌘B)" onClick={() => host.workbench.setList(false)}>
					<PanelLeftCloseIcon size={16} />
				</button>
			</div>

			<div className="sidebar-brand">
				<img className="brand-mark" src="/milu.png" alt="" />
				<MiluWordmark class="sidebar-wordmark" />
			</div>

			<div className="sidebar-body">
				{arrived && rows.length === 0 ? <div className="conv-empty">no sessions yet</div> : null}

				{searching && rows.length > 0 && visibleRoots.length === 0 ? (
					<div className="conv-no-match">
						<p className="conv-no-match-title">No sessions match</p>
						<p className="conv-no-match-hint">
							<button type="button" onClick={() => setQuery("")}>
								clear the filter
							</button>
						</p>
					</div>
				) : null}

				<div className={`conv-rows edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""}`} ref={rowsRef}>
					{!arrived ? (
						Array.from({ length: SKELETON_ROWS }, (_, index) => (
							<div className="conv-skeleton" key={index} aria-busy="true">
								<span className="conv-skeleton-face" />
								<span className="conv-skeleton-lines">
									<span className="conv-skeleton-line" />
									<span className="conv-skeleton-line preview" />
								</span>
							</div>
						))
					) : (
						<>
							{pinnedRoots.length > 0 ? <div className="conv-section">Pinned</div> : null}
							{pinnedRoots.map(renderRoot)}
							{pinnedRoots.length > 0 && restRoots.length > 0 ? <div className="conv-gap" aria-hidden="true" /> : null}
							{restRoots.map(renderRoot)}
						</>
					)}
				</div>
			</div>
		</aside>
	);
}
