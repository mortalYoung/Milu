import { activityAt, byPinThenRecency, filterChats, listTime, previewFor, type SurfaceProps, workspaceLabel } from "@milu/client";
import type { ChatRow } from "@milu/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon, PanelLeftCloseIcon, SearchIcon } from "../components/icons.tsx";
import { MiluWordmark } from "../components/MiluWordmark.tsx";
import { useStore } from "../use-store.ts";

const SKELETON_ROWS = 5;

function Row(props: {
	chat: ChatRow;
	selected: boolean;
	writing: boolean;
	unread: boolean;
	leaf?: boolean;
	childCount?: number;
	expanded?: boolean;
	onSelect: () => void;
	onToggle?: () => void;
}) {
	const { chat } = props;
	return (
		<div
			className={`conv-item${props.selected ? " selected" : ""}${props.leaf ? " ml-5" : ""}`}
			role="button"
			tabIndex={0}
			aria-current={props.selected ? "true" : undefined}
			onClick={props.onSelect}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				props.onSelect();
			}}
		>
			<span className={`conv-avatar ${props.selected ? "avatar-ink" : "avatar-paper"}`}>
				<span className="avatar-initial">{chat.name.charAt(0)}</span>
			</span>
			<span className="conv-main">
				<span className="conv-name-row">
					<span className="conv-name-wrap">
						<span className="conv-name">{chat.name}</span>
						{props.childCount ? (
							<button
								type="button"
								className="conv-fork-count"
								aria-expanded={props.expanded}
								aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.childCount} fork${props.childCount === 1 ? "" : "s"} of ${chat.name}`}
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
					<span className="conv-time">{activityAt(chat) ? listTime(activityAt(chat)) : ""}</span>
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
							previewFor(chat) || "—"
						)}
					</span>
					{props.unread ? <span className="conv-unread-dot" title="new messages" /> : null}
				</span>
				{chat.workspace ? (
					<span className="conv-ws" title={chat.workspace}>
						{chat.workspaceKind === "worktree" ? <FolderTreeIcon size={10} /> : null}
						<span className="truncate">{workspaceLabel(chat)}</span>
					</span>
				) : null}
			</span>
		</div>
	);
}

export function ChatListSurface(props: SurfaceProps) {
	const { host } = props;
	const rows = useStore(host.chats.rows);
	const arrived = useStore(host.chats.arrived);
	const state = useStore(host.sessions.state);
	const listOpen = useStore(host.shell.listOpen);
	const searchOpen = useStore(host.shell.searchOpen);

	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [edges, setEdges] = useState({ above: false, below: false });
	const searchRef = useRef<HTMLInputElement>(null);
	const rowsRef = useRef<HTMLDivElement>(null);

	const selected = state.selected;
	const closeSearch = () => {
		host.shell.setSearch(false);
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

	const roots = useMemo(() => rows.filter((chat) => !chat.forkedFrom).sort(byPinThenRecency), [rows]);
	const leavesByRoot = useMemo(() => {
		const map = new Map<string, ChatRow[]>();
		for (const chat of rows) {
			if (!chat.forkedFrom) continue;
			const list = map.get(chat.forkedFrom) ?? [];
			list.push(chat);
			map.set(chat.forkedFrom, list);
		}
		for (const list of map.values()) list.sort(byPinThenRecency);
		return map;
	}, [rows]);

	const searching = query.trim() !== "";
	const matched = useMemo(() => new Set(filterChats(rows, query).map((chat) => chat.name)), [rows, query]);
	const visibleRoots = useMemo(() => {
		if (!searching) return roots;
		return roots.filter((root) => matched.has(root.name) || (leavesByRoot.get(root.name) ?? []).some((leaf) => matched.has(leaf.name)));
	}, [roots, leavesByRoot, matched, searching]);

	const selectedParent = rows.find((chat) => chat.name === selected)?.forkedFrom;
	const pinnedRoots = searching ? [] : visibleRoots.filter((root) => root.pinned === true);
	const restRoots = searching ? visibleRoots : visibleRoots.filter((root) => root.pinned !== true);

	const toggle = (name: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	const renderRoot = (root: ChatRow) => {
		const leaves = leavesByRoot.get(root.name) ?? [];
		const isExpanded = root.name === selectedParent || expanded.has(root.name) || (searching && leaves.some((leaf) => matched.has(leaf.name)));
		return (
			<div key={root.name}>
				<Row
					chat={root}
					selected={selected === root.name}
					writing={host.sessions.running(root.name)}
					unread={(root.lastMessageAt ?? 0) > (root.readAt ?? 0)}
					childCount={leaves.length}
					expanded={isExpanded}
					onSelect={() => void host.sessions.select(root.name)}
					onToggle={() => toggle(root.name)}
				/>
				{isExpanded
					? leaves.map((leaf) => (
							<Row
								key={leaf.name}
								chat={leaf}
								selected={selected === leaf.name}
								writing={host.sessions.running(leaf.name)}
								unread={(leaf.lastMessageAt ?? 0) > (leaf.readAt ?? 0)}
								leaf
								onSelect={() => void host.sessions.select(leaf.name)}
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
						aria-label={searchOpen ? "Close search" : "Search chats"}
						title="Search chats (⌘F)"
						onClick={() => (searchOpen ? closeSearch() : host.shell.setSearch(true))}
					>
						<SearchIcon />
					</button>
					<span className="conv-search-slide">
						<input
							ref={searchRef}
							className="conv-list-input"
							type="text"
							placeholder="Search chats"
							aria-label="Search chats"
							spellCheck={false}
							tabIndex={searchOpen ? 0 : -1}
							aria-hidden={searchOpen ? undefined : true}
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							onBlur={() => query === "" && host.shell.setSearch(false)}
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
				<button type="button" className="sidebar-toggle" aria-label="Hide chat list" title="Hide chat list (⌘B)" onClick={() => host.shell.setList(false)}>
					<PanelLeftCloseIcon size={16} />
				</button>
			</div>

			<div className="sidebar-brand">
				<img className="brand-mark" src="/milu.png" alt="" />
				<MiluWordmark class="sidebar-wordmark" />
			</div>

			<div className="sidebar-body">
				{arrived && rows.length === 0 ? <div className="conv-empty">no chats yet</div> : null}

				{searching && rows.length > 0 && visibleRoots.length === 0 ? (
					<div className="conv-no-match">
						<p className="conv-no-match-title">No chats match</p>
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
