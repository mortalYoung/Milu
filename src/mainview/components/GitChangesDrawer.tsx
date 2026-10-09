import { Columns2, LocateFixed, Space, WrapText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { GitChangeItem } from "../../shared/rpc";
import { useSettings } from "../lib/contexts/settings-context";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { languageForPath } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { SURFACE } from "../lib/surfaces";
import { CodeDiff } from "./CodeDiff";
import { type DockListControls, DockListToggle, DockShell } from "./DockShell";

interface GitData {
	repoRoot: string;
	changes: GitChangeItem[];
}

interface DiffData {
	kind?: "diff" | "new";
	diff?: string;
	content?: string;
	error?: string;
}

type SidesData = { ok: true; original: string; modified: string; add: number; del: number; binary: boolean; tooLarge: boolean } | { ok: false; error: string };

function basename(path: string) {
	return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string) {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? "" : path.slice(0, cut + 1);
}

function DiffLineView(props: { text: string }) {
	const cls =
		props.text.startsWith("+++") || props.text.startsWith("---") || props.text.startsWith("diff --git")
			? "meta"
			: props.text.startsWith("@@")
				? "hunk"
				: props.text.startsWith("+")
					? "add"
					: props.text.startsWith("-")
						? "del"
						: "";
	const mark = cls === "add" || cls === "del" ? props.text.slice(0, 1) : "";
	return (
		<div className={"git-diff-line" + (cls ? ` ${cls}` : "")}>
			{mark && <span className="git-diff-mark">{mark}</span>}
			{props.text.slice(mark.length) || " "}
		</div>
	);
}

const openDiffsStore = createStore<{ files: Record<string, GitChangeItem> }>()(() => ({ files: {} }));

export function GitChangesDrawer(props: {
	open: boolean;
	partner: string | null;
	width: number;
	paneWidth: number;
	listOpen: boolean;
	onToggleList: () => void;
	sideBySide: boolean;
	onToggleSideBySide: () => void;
	wrap: boolean;
	onToggleWrap: () => void;
	ignoreWhitespace: boolean;
	onToggleIgnoreWhitespace: () => void;
	onRevealInExplorer: (path: string) => void;
}) {
	const settings = useSettings();
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);
	const openDiffs = useStore(openDiffsStore, (state) => state.files);
	const lineHeight = 1 + (settingsSnapshot.settings?.explorer?.lineGap ?? 0.2);

	const [data, setData] = useState<GitData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [sides, setSides] = useState<SidesData | null>(null);
	const [sidesLoading, setSidesLoading] = useState(false);
	const [patch, setPatch] = useState<DiffData | null>(null);
	const shownRef = useRef<GitChangeItem | null>(null);

	const selected = props.partner ? (openDiffs[props.partner] ?? null) : null;
	if (selected) shownRef.current = selected;
	const shownChange = shownRef.current;

	function setSelected(next: GitChangeItem | null) {
		const partner = props.partner;
		if (!partner) return;
		openDiffsStore.setState((state) => {
			if ((state.files[partner] ?? null) === next) return state;
			const copy = { ...state.files };
			if (next) copy[partner] = next;
			else delete copy[partner];
			return { files: copy };
		});
	}

	useEscapeLayer({
		id: "git.detail",
		order: ESCAPE_ORDER.dockDetail,
		isOpen: () => props.open && selected != null,
		close: () => setSelected(null),
	});

	async function refresh() {
		if (!props.partner) return;
		setLoading(true);
		setError(null);
		try {
			const res = await rpc.request.git_changes({ name: props.partner });
			if (!res.ok) {
				setError(res.error ?? "git changes failed");
				setData(null);
			} else {
				setData({ repoRoot: res.repoRoot ?? "", changes: res.changes ?? [] });
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setData(null);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (props.open && props.partner) void refresh();
	}, [props.open, props.partner]);

	useEffect(() => {
		if (!shownChange || !props.partner) {
			setSides(null);
			return;
		}
		let cancelled = false;
		const change = shownChange;
		const partner = props.partner;
		setSidesLoading(true);
		void rpc.request
			.git_file_sides({ name: partner, path: change.path, staged: change.staged, ...(change.from ? { from: change.from } : {}) })
			.then((res) => {
				if (cancelled) return;
				setSides(
					res.ok
						? {
								ok: true,
								original: res.original ?? "",
								modified: res.modified ?? "",
								add: res.add ?? 0,
								del: res.del ?? 0,
								binary: res.binary === true,
								tooLarge: res.tooLarge === true,
							}
						: { ok: false, error: res.error ?? "failed to read the two sides" },
				);
				setSidesLoading(false);
			})
			.catch((err: Error) => {
				if (cancelled) return;
				setSides({ ok: false, error: err.message });
				setSidesLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [shownChange, props.partner]);

	const both = sides && sides.ok ? sides : null;
	const comparable = both != null && !both.binary && !both.tooLarge;
	const sidesError = sides && !sides.ok ? sides.error : null;
	const stats = { add: both?.add ?? 0, del: both?.del ?? 0 };

	useEffect(() => {
		if (!shownChange || !props.partner || sides === null || sidesLoading || comparable) {
			setPatch(null);
			return;
		}
		let cancelled = false;
		const change = shownChange;
		const partner = props.partner;
		void rpc.request
			.git_diff({ name: partner, path: change.path, staged: change.staged })
			.then((res) => {
				if (cancelled) return;
				setPatch(
					!res.ok ? { error: res.error ?? "failed to load diff" } : res.kind === "new" ? { kind: "new", content: res.content ?? "" } : { kind: "diff", diff: res.diff ?? "" },
				);
			})
			.catch((err: Error) => {
				if (!cancelled) setPatch({ error: err.message });
			});
		return () => {
			cancelled = true;
		};
	}, [shownChange, props.partner, sides, sidesLoading, comparable]);

	const staged = (data?.changes ?? []).filter((change) => change.staged);
	const unstaged = (data?.changes ?? []).filter((change) => !change.staged);

	const renderGroup = (title: string, items: GitChangeItem[]) => (
		<>
			<div className="git-group-title" key={`${title}-title`}>
				{title} <span className="git-group-count">{items.length}</span>
			</div>
			{items.map((change) => (
				<button
					type="button"
					key={`${change.path}:${change.staged}`}
					className={"git-row" + (selected?.path === change.path && selected?.staged === change.staged ? " selected" : "")}
					onClick={() => setSelected(change)}
				>
					<span className={"git-status " + change.status.toLowerCase()}>{change.status}</span>
					<span className="git-path">{change.path}</span>
				</button>
			))}
		</>
	);

	return (
		<DockShell
			open={props.open}
			panelId="git"
			width={props.width}
			paneWidth={props.paneWidth}
			listTitle={`changes · ${staged.length + unstaged.length}`}
			listOpen={props.listOpen}
			onToggleList={props.onToggleList}
			surface={SURFACE.diff}
			detail={{
				open: selected != null,
				render: (leaving: boolean, list: DockListControls) =>
					shownChange ? (
						<div
							className={"git-diff dock-detail" + (leaving ? " leaving" : "")}
							style={{ "--explorer-line-height": lineHeight, "--explorer-line-height-em": `${lineHeight}em` } as React.CSSProperties}
						>
							<div className="git-diff-head">
								{!list.open && <DockListToggle open={false} onToggle={list.toggle} />}
								<div className="git-diff-title">
									<span className="git-file-name">{basename(shownChange.path)}</span>
									{(stats.add > 0 || stats.del > 0) && (
										<span className="git-diff-stats">
											{stats.add > 0 && <span className="add">+{stats.add}</span>}
											{stats.del > 0 && <span className="del">−{stats.del}</span>}
										</span>
									)}
									{sidesError && <span className="git-diff-error">{sidesError}</span>}
								</div>
								<div className="git-diff-actions">
									<button
										type="button"
										className="dock-btn"
										aria-label="Reveal this file in the explorer"
										title="Reveal this file in the explorer"
										onClick={() => props.onRevealInExplorer(shownChange.path)}
									>
										<LocateFixed size={11} />
									</button>
									{comparable && (
										<button
											type="button"
											className={"dock-btn" + (props.sideBySide ? " on" : "")}
											aria-pressed={props.sideBySide}
											aria-label={props.sideBySide ? "Show one column" : "Show both sides"}
											title={props.sideBySide ? "Show one column" : "Show both sides"}
											onClick={props.onToggleSideBySide}
										>
											<Columns2 size={11} />
										</button>
									)}
									<button
										type="button"
										className={"dock-btn" + (props.wrap ? " on" : "")}
										aria-pressed={props.wrap}
										aria-label="Wrap long lines"
										title={props.wrap ? "Stop wrapping long lines" : "Wrap long lines"}
										onClick={props.onToggleWrap}
									>
										<WrapText size={11} />
									</button>
									<button
										type="button"
										className={"dock-btn" + (props.ignoreWhitespace ? " on" : "")}
										aria-pressed={props.ignoreWhitespace}
										aria-label="Ignore leading and trailing whitespace"
										title={props.ignoreWhitespace ? "Show whitespace changes" : "Ignore leading and trailing whitespace"}
										onClick={props.onToggleIgnoreWhitespace}
									>
										<Space size={11} />
									</button>
								</div>
							</div>
							{/* breadcrumbs：head 下面单独一行，与 head 之间不画线 */}
							<div className="git-dir-row">
								<span className="git-dir" title={shownChange.path}>
									{dirname(shownChange.path)}
								</span>
							</div>
							{comparable && both ? (
								<CodeDiff
									original={both.original}
									modified={both.modified}
									lang={languageForPath(shownChange.path)}
									sideBySide={props.sideBySide}
									wrap={props.wrap}
									ignoreWhitespace={props.ignoreWhitespace}
								/>
							) : sidesLoading ? (
								<div className="git-diff-note">
									<span className="work-dot" />
									<span className="work-dot" />
									<span className="work-dot" />
								</div>
							) : (
								<>
									{both?.binary && <div className="git-diff-note">binary file · no line-by-line diff</div>}
									{both?.tooLarge && <div className="git-diff-note">file too large to compare side by side</div>}
									{(patch?.error ?? sidesError) && <div className="git-diff-note">{patch?.error ?? sidesError}</div>}
									{patch?.kind === "new" && (
										<div className={"git-diff-body" + (props.wrap ? " wrap" : "")}>
											<div className="git-diff-new-note">new file</div>
											{(patch.content ?? "").split("\n").map((line, index) => (
												<div className="git-diff-line add" key={index}>
													{line || " "}
												</div>
											))}
										</div>
									)}
									{patch?.kind === "diff" && (
										<div className={"git-diff-body" + (props.wrap ? " wrap" : "")}>
											{(patch.diff ?? "").split("\n").map((line, index) => (
												<DiffLineView text={line} key={index} />
											))}
										</div>
									)}
								</>
							)}
						</div>
					) : null,
			}}
		>
			<div className="git-body">
				{loading && !data ? (
					<div className="git-empty">loading…</div>
				) : error ? (
					<div className="git-empty">{error}</div>
				) : !data || (staged.length === 0 && unstaged.length === 0) ? (
					<div className="git-empty">{data ? "no changes" : "not a git repository"}</div>
				) : (
					<>
						{staged.length > 0 && renderGroup("Staged Changes", staged)}
						{unstaged.length > 0 && renderGroup("Changes", unstaged)}
					</>
				)}
			</div>
		</DockShell>
	);
}
