import { Pin } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { GitChangeItem } from "../../shared/rpc";
import { DOCK_PANE_MAX, DOCK_PANE_MIN } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { rpc } from "../lib/rpc";
import { DockShell } from "./DockShell";

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

function basename(path: string) {
	return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string) {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? "" : path.slice(0, cut + 1);
}

function DiffLineView(props: { text: string }) {
	const cls = () => {
		if (props.text.startsWith("+++") || props.text.startsWith("---") || props.text.startsWith("diff --git")) return "meta";
		if (props.text.startsWith("@@")) return "hunk";
		if (props.text.startsWith("+")) return "add";
		if (props.text.startsWith("-")) return "del";
		return "";
	};
	return <div class={"git-diff-line" + (cls() ? ` ${cls()}` : "")}>{props.text || " "}</div>;
}

/**
 * What each partner left open in the dock — the explorer's own memory, kept here too and outside the
 * component for the same reason: the pin holds a file, and a partner that comes back pinned has to
 * come back with the diff it was pinned to.
 */
const [openDiffs, setOpenDiffs] = createSignal<Record<string, GitChangeItem>>({});

export function GitChangesDrawer(props: {
	open: boolean;
	partner: string | null;
	side?: "left" | "right";
	onClose: () => void;
	/** The dock's one pane width, shared with every other docked panel. */
	paneWidth: number;
	onPaneResize: (px: number) => void;
	onPaneCommit: () => void;
	/** Pinning shares the row with the letter, exactly as the explorer does. */
	pinned: boolean;
	onTogglePin: () => void;
	letterWidth: number | null;
	setLetterWidth: (width: number | null) => void;
	commitLetterWidth: () => void;
}) {
	const [data, setData] = createSignal<GitData | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);
	const selected = () => (props.partner ? (openDiffs()[props.partner] ?? null) : null);
	function setSelected(next: GitChangeItem | null) {
		const partner = props.partner;
		if (!partner) return;
		setOpenDiffs((prev) => {
			if ((prev[partner] ?? null) === next) return prev;
			const copy = { ...prev };
			if (next) copy[partner] = next;
			else delete copy[partner];
			return copy;
		});
	}
	const shownChange = createMemo<GitChangeItem | null>((prev) => selected() ?? prev, null);

	// The open diff is the dock's detail layer: Esc closes it, and the pin lets go with it.
	useEscapeLayer({
		id: "git.detail",
		order: ESCAPE_ORDER.dockDetail,
		isOpen: () => props.open && selected() != null,
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

	createEffect(() => {
		if (props.open && props.partner) void refresh();
	});

	const [diffData] = createResource(
		() => (shownChange() && props.partner ? { change: shownChange()!, name: props.partner } : null),
		async ({ change, name }): Promise<DiffData | null> => {
			const res = await rpc.request.git_diff({ name, path: change.path, staged: change.staged });
			if (!res.ok) return { error: res.error ?? "failed to load diff" };
			return res.kind === "new" ? { kind: "new", content: res.content ?? "" } : { kind: "diff", diff: res.diff ?? "" };
		},
	);

	// The size of the change, before the diff itself: `+12 −4`.
	const stats = createMemo(() => {
		const diff = diffData();
		if (!diff) return { add: 0, del: 0 };
		if (diff.kind === "new") return { add: (diff.content ?? "").split("\n").length, del: 0 };
		let add = 0;
		let del = 0;
		for (const line of (diff.diff ?? "").split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) add += 1;
			else if (line.startsWith("-") && !line.startsWith("---")) del += 1;
		}
		return { add, del };
	});

	const staged = () => (data()?.changes ?? []).filter((c) => c.staged);
	const unstaged = () => (data()?.changes ?? []).filter((c) => !c.staged);
	const shortRoot = () => {
		const root = data()?.repoRoot;
		if (!root) return "";
		const parts = root.split("/");
		return parts.at(-1) ?? root;
	};

	const renderGroup = (title: string, items: GitChangeItem[]) => (
		<>
			<div class="git-group-title">
				{title} <span class="git-group-count">{items.length}</span>
			</div>
			<For each={items}>
				{(change) => (
					<button
						type="button"
						class={"git-row" + (selected()?.path === change.path && selected()?.staged === change.staged ? " selected" : "")}
						onClick={() => setSelected(change)}
					>
						<span class={"git-status " + change.status.toLowerCase()}>{change.status}</span>
						<span class="git-path">{change.path}</span>
					</button>
				)}
			</For>
		</>
	);

	return (
		<DockShell
			open={props.open}
			panelId="git"
			side={props.side ?? "right"}
			width={props.paneWidth}
			min={DOCK_PANE_MIN}
			max={DOCK_PANE_MAX}
			resizeLabel="Resize the change list"
			onResize={props.onPaneResize}
			onCommit={props.onPaneCommit}
			pinned={props.pinned}
			onTogglePin={props.onTogglePin}
			letterWidth={props.letterWidth}
			setLetterWidth={props.setLetterWidth}
			commitLetterWidth={props.commitLetterWidth}
			title="Git Changes"
			actions={
				<>
					<span class="git-root">{shortRoot()}</span>
					<button
						type="button"
						class={"dock-refresh" + (loading() ? " loading" : "")}
						title={loading() ? "Refreshing…" : "Refresh"}
						disabled={loading()}
						onClick={() => void refresh()}
					>
						↻
					</button>
				</>
			}
			onClose={props.onClose}
			detail={{
				open: selected() != null,
				render: (leaving, list) => (
					<Show when={shownChange()}>
						{(change) => (
							<div class="git-diff dock-detail" classList={{ leaving }}>
								<div class="git-diff-head">
									<button
										type="button"
										class="dock-btn"
										classList={{ on: list.pinned }}
										aria-pressed={list.pinned}
										disabled={!list.canPin && !list.pinned}
										title={list.pinned ? "Let the diff cover the letter again" : "Pin the letter beside the diff"}
										onClick={() => list.togglePin()}
									>
										<Pin size={11} />
									</button>
									<Show when={list.pinned}>
										<button
											type="button"
											class="dock-btn"
											classList={{ on: list.listOpen }}
											aria-pressed={list.listOpen}
											title={list.listOpen ? "Hide the change list" : "Show the change list"}
											onClick={() => list.openList()}
										>
											☰
										</button>
									</Show>
									<Show when={!list.pinned}>
										<button type="button" class="git-back" title="Close this diff" onClick={() => setSelected(null)}>
											← Changes
										</button>
									</Show>
									<span class="git-file-name">{basename(change().path)}</span>
									<span class="git-dir" title={change().path}>
										{dirname(change().path)}
									</span>
									<Show when={stats().add > 0 || stats().del > 0}>
										<span class="git-diff-stats">
											<Show when={stats().add > 0}>
												<span class="add">+{stats().add}</span>
											</Show>
											<Show when={stats().del > 0}>
												<span class="del">−{stats().del}</span>
											</Show>
										</span>
									</Show>
									<Show when={diffData()?.error}>
										<span class="git-diff-error">{diffData()!.error}</span>
									</Show>
								</div>
								<Show
									when={!diffData.loading}
									fallback={
										<div class="git-diff-note">
											<span class="work-dot" />
											<span class="work-dot" />
											<span class="work-dot" />
										</div>
									}
								>
									<Show when={diffData()?.kind === "new"}>
										<div class="git-diff-body">
											<div class="git-diff-new-note">new file</div>
											<For each={(diffData()?.content ?? "").split("\n")}>{(line) => <div class="git-diff-line add">{line || " "}</div>}</For>
										</div>
									</Show>
									<Show when={diffData()?.kind === "diff"}>
										<div class="git-diff-body">
											<For each={(diffData()?.diff ?? "").split("\n")}>{(line) => <DiffLineView text={line} />}</For>
										</div>
									</Show>
								</Show>
							</div>
						)}
					</Show>
				),
			}}
		>
			<div class="git-body">
				{loading() && !data() ? (
					<div class="git-empty">loading…</div>
				) : error() ? (
					<div class="git-empty">{error()}</div>
				) : !data() || (staged().length === 0 && unstaged().length === 0) ? (
					<div class="git-empty">{data() ? "no changes" : "not a git repository"}</div>
				) : (
					<>
						{staged().length > 0 ? renderGroup("Staged Changes", staged()) : null}
						{unstaged().length > 0 ? renderGroup("Changes", unstaged()) : null}
					</>
				)}
			</div>
		</DockShell>
	);
}
