import type { ChatRow, LiveEvent, SeqEntry } from "@milu/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Session } from "./client.ts";
import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon, PanelLeftCloseIcon, PanelLeftIcon, SearchIcon } from "./components/icons.tsx";
import { MiluWordmark } from "./components/MiluWordmark.tsx";
import { activityAt, byPinThenRecency, filterChats, listTime, previewFor, workspaceLabel } from "./lib/chats.ts";

type Entry = SeqEntry["entry"];

const NO_ENTRIES: SeqEntry[] = [];
const SKELETON_ROWS = 5;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
		.join("");
}

function blockText(entry: Entry): { role: string; text: string } | null {
	if (entry.type !== "message") return null;
	const message = entry.message;
	if (!("content" in message)) return null;
	return { role: message.role, text: textOf(message.content) };
}

function toolLine(entry: Entry): string | null {
	if (entry.type !== "custom" || entry.customType !== "milu/tool") return null;
	const data = (entry.data ?? {}) as { phase?: string; name?: string; isError?: boolean; ms?: number };
	if (data.phase !== "end") return null;
	return `${data.name ?? "?"}${data.ms === undefined ? "" : `  ${data.ms}ms`}${data.isError ? "  ✕" : ""}`;
}

function ChatRowView(props: {
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

export function App() {
	const [chats, setChats] = useState<ChatRow[]>([]);
	const [arrived, setArrived] = useState(false);
	const [selected, setSelected] = useState("");
	const [logs, setLogs] = useState<Record<string, SeqEntry[]>>({});
	const [running, setRunning] = useState<Record<string, boolean>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [linked, setLinked] = useState(false);
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [listOpen, setListOpen] = useState(true);
	const [edges, setEdges] = useState({ above: false, below: false });

	const selectedRef = useRef("");
	const chatsRef = useRef<ChatRow[]>([]);
	const loaded = useRef(new Set<string>());
	const searchRef = useRef<HTMLInputElement>(null);
	const rowsRef = useRef<HTMLDivElement>(null);

	const session = useMemo(() => new Session(), []);

	const select = useCallback(
		(name: string) => {
			selectedRef.current = name;
			setSelected(name);

			const row = chatsRef.current.find((chat) => chat.name === name);
			const at = row?.lastMessageAt ?? 0;
			if (row && at > (row.readAt ?? 0)) {
				setChats((current) => current.map((chat) => (chat.name === name ? { ...chat, readAt: at } : chat)));
				void session.request("markRead", { chat: name, readAt: at }).catch(() => {});
			}

			if (loaded.current.has(name)) return;
			loaded.current.add(name);
			void session.load(name).catch((failure: Error) => setErrors((current) => ({ ...current, [name]: failure.message })));
		},
		[session],
	);

	useEffect(() => {
		session.attach({
			onEntry: (chat, entry) =>
				setLogs((current) => {
					const existing = current[chat] ?? [];
					if (existing.some((seen) => seen.seq === entry.seq)) return current;
					return { ...current, [chat]: [...existing, entry] };
				}),
			onLive: (event: LiveEvent) => {
				setRunning((current) => ({ ...current, [event.chat]: event.running }));
				if (event.error) setErrors((current) => ({ ...current, [event.chat]: event.error as string }));
				if (!event.running) void session.refreshChats().catch(() => {});
			},
			onLink: (up) => {
				setLinked(up);
				if (!up) {
					loaded.current.clear();
					setRunning({});
					return;
				}
				const current = selectedRef.current;
				if (current) select(current);
			},
			onChats: (rows) => {
				setChats(rows);
				setArrived(true);
			},
		});
		session.open();
		return () => session.close();
	}, [session, select]);

	useEffect(() => {
		chatsRef.current = chats;
		if (selectedRef.current || chats.length === 0) return;
		select(chats[0]?.name ?? "");
	}, [chats, select]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key === "f") {
				event.preventDefault();
				setSearchOpen(true);
				return;
			}
			if (event.key === "b") {
				event.preventDefault();
				setListOpen((open) => !open);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
	}, [chats, query, expanded, listOpen, arrived]);

	const roots = useMemo(() => chats.filter((chat) => !chat.forkedFrom).sort(byPinThenRecency), [chats]);
	const leavesByRoot = useMemo(() => {
		const map = new Map<string, ChatRow[]>();
		for (const chat of chats) {
			if (!chat.forkedFrom) continue;
			const list = map.get(chat.forkedFrom) ?? [];
			list.push(chat);
			map.set(chat.forkedFrom, list);
		}
		for (const list of map.values()) list.sort(byPinThenRecency);
		return map;
	}, [chats]);

	const searching = query.trim() !== "";
	const matched = useMemo(() => new Set(filterChats(chats, query).map((chat) => chat.name)), [chats, query]);
	const visibleRoots = useMemo(() => {
		if (!searching) return roots;
		return roots.filter((root) => matched.has(root.name) || (leavesByRoot.get(root.name) ?? []).some((leaf) => matched.has(leaf.name)));
	}, [roots, leavesByRoot, matched, searching]);
	const selectedParent = chats.find((chat) => chat.name === selected)?.forkedFrom;
	const pinnedRoots = searching ? [] : visibleRoots.filter((root) => root.pinned === true);
	const restRoots = searching ? visibleRoots : visibleRoots.filter((root) => root.pinned !== true);

	const toggle = (name: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	const closeSearch = () => {
		setSearchOpen(false);
		setQuery("");
	};

	const renderRoot = (root: ChatRow) => {
		const leaves = leavesByRoot.get(root.name) ?? [];
		const isExpanded = root.name === selectedParent || expanded.has(root.name) || (searching && leaves.some((leaf) => matched.has(leaf.name)));
		return (
			<div key={root.name}>
				<ChatRowView
					chat={root}
					selected={selected === root.name}
					writing={running[root.name] ?? root.writing}
					unread={(root.lastMessageAt ?? 0) > (root.readAt ?? 0)}
					childCount={leaves.length}
					expanded={isExpanded}
					onSelect={() => select(root.name)}
					onToggle={() => toggle(root.name)}
				/>
				{isExpanded
					? leaves.map((leaf) => (
							<ChatRowView
								key={leaf.name}
								chat={leaf}
								selected={selected === leaf.name}
								writing={running[leaf.name] ?? leaf.writing}
								unread={(leaf.lastMessageAt ?? 0) > (leaf.readAt ?? 0)}
								leaf
								onSelect={() => select(leaf.name)}
							/>
						))
					: null}
			</div>
		);
	};

	const entries = logs[selected] ?? NO_ENTRIES;
	const scroll = useRef<HTMLDivElement>(null);
	useEffect(() => {
		scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
	}, [entries]);

	const send = () => {
		const text = draft.trim();
		if (!text || !selected) return;
		const chat = selected;
		setDraft("");
		setErrors((current) => {
			if (!(chat in current)) return current;
			const next = { ...current };
			delete next[chat];
			return next;
		});
		void session.request("prompt", { chat, text }).catch((failure: Error) => setErrors((current) => ({ ...current, [chat]: failure.message })));
	};

	const rows = entries.map((entry) => {
		const message = blockText(entry.entry);
		if (message) return { key: `m${entry.seq}`, kind: message.role, text: message.text };
		const tool = toolLine(entry.entry);
		if (tool) return { key: `t${entry.seq}`, kind: "tool", text: tool };
		return null;
	});

	return (
		<div className="chat-page">
			<aside className={`sidebar${listOpen ? "" : " collapsed"}`} tabIndex={-1}>
				<div className="sidebar-windowbar">
					<div className={`conv-search${searchOpen ? " open" : ""}`}>
						<button
							type="button"
							className="conv-icon-btn"
							aria-expanded={searchOpen}
							aria-label={searchOpen ? "Close search" : "Search chats"}
							title="Search chats (⌘F)"
							onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
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
								onBlur={() => query === "" && setSearchOpen(false)}
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
					<button type="button" className="sidebar-toggle" aria-label="Hide chat list" title="Hide chat list (⌘B)" onClick={() => setListOpen(false)}>
						<PanelLeftCloseIcon size={16} />
					</button>
				</div>

				<div className="sidebar-brand">
					<img className="brand-mark" src="/milu.png" alt="" />
					<MiluWordmark class="sidebar-wordmark" />
				</div>

				<div className="sidebar-body">
					{arrived && chats.length === 0 ? <div className="conv-empty">no chats yet</div> : null}

					{searching && chats.length > 0 && visibleRoots.length === 0 ? (
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

			<main className="chat-area">
				<header className="chat-bar">
					<span className="chat-bar-left">
						{listOpen ? null : (
							<button type="button" className="conv-icon-btn" aria-label="Show chat list" title="Show chat list (⌘B)" onClick={() => setListOpen(true)}>
								<PanelLeftIcon size={16} />
							</button>
						)}
						<span className="mono muted">
							{selected || "no chat"} · {entries.length ? `seq ${entries[entries.length - 1]?.seq}` : "empty"}
						</span>
					</span>
					<span className={`dot${running[selected] ? " hot" : ""}${linked ? "" : " off"}`} />
				</header>

				<div className="chat-body">
					<div className="transcript" ref={scroll}>
						<div className="chat-column">
							{rows.every((row) => row === null) ? <p className="empty">Send something.</p> : null}
							{rows.map((row) =>
								row ? (
									<div key={row.key} className={`row ${row.kind}`}>
										{row.kind === "tool" ? <span className="mono tool-line">{row.text}</span> : <p>{row.text}</p>}
									</div>
								) : null,
							)}
							{errors[selected] ? <div className="row error mono">{errors[selected]}</div> : null}
						</div>
					</div>

					<div className="composer-slot">
						<div className="composer">
							<textarea
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send();
									}
								}}
								rows={2}
								placeholder="Message Milu…"
							/>
							<button type="button" onClick={send} disabled={!linked || !draft.trim() || !selected}>
								Send
							</button>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
