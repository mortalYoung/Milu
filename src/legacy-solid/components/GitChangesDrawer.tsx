import { Columns2, Pin, WrapText } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { GitChangeItem } from "../../shared/rpc";
import { useSettings } from "../lib/contexts/settings-context";
import { DOCK_PANE_MAX, DOCK_PANE_MIN } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { languageForPath } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { CodeDiff } from "./CodeDiff";
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

/** Both ends of the change, or why there are none to show. */
type SidesData = { ok: true; original: string; modified: string; add: number; del: number; binary: boolean; tooLarge: boolean } | { ok: false; error: string };

function basename(path: string) {
	return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string) {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? "" : path.slice(0, cut + 1);
}

/** A patch line: the wash and the bar carry the colour, so the text stays ink and only the marker is
 * dyed — the same three levels the two-sided diff paints. */
function DiffLineView(props: { text: string }) {
	const cls = () => {
		if (props.text.startsWith("+++") || props.text.startsWith("---") || props.text.startsWith("diff --git")) return "meta";
		if (props.text.startsWith("@@")) return "hunk";
		if (props.text.startsWith("+")) return "add";
		if (props.text.startsWith("-")) return "del";
		return "";
	};
	const mark = () => (cls() === "add" || cls() === "del" ? props.text.slice(0, 1) : "");
	return (
		<div class={"git-diff-line" + (cls() ? ` ${cls()}` : "")}>
			{mark() && <span class="git-diff-mark">{mark()}</span>}
			{props.text.slice(mark().length) || " "}
		</div>
	);
}

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
	/** Two-sided by default; a unified column for a dock too narrow to split. */
	sideBySide: boolean;
	onToggleSideBySide: () => void;
	/** Long lines wrap — the dock's reading preference, the same one the reader carries. */
	wrap: boolean;
	onToggleWrap: () => void;
}) {
	const settings = useSettings();
	// The reader's line rhythm, shared: both panels read code in the same dock, so they breathe alike.
	const lineHeight = () => 1 + (settings.data()?.settings?.explorer?.lineGap ?? 0.2);
	const [data, setData] = createSignal<GitData | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);
	/**
	 * What a partner left open in the dock — the explorer's own memory, kept here too: the pin holds a
	 * file, and a partner that comes back pinned has to come back with the diff it was pinned to.
	 */
	const [openDiffs, setOpenDiffs] = createSignal<Record<string, GitChangeItem>>({});
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

	// Both ends of the change, which is what a two-sided diff reads. `+12 −4` comes with it, from git.
	const [sides] = createResource(
		() => (shownChange() && props.partner ? { change: shownChange()!, name: props.partner } : null),
		async ({ change, name }) => {
			const res = await rpc.request.git_file_sides({ name, path: change.path, staged: change.staged, ...(change.from ? { from: change.from } : {}) });
			if (!res.ok) return { ok: false as const, error: res.error ?? "failed to read the two sides" };
			return {
				ok: true as const,
				original: res.original ?? "",
				modified: res.modified ?? "",
				add: res.add ?? 0,
				del: res.del ?? 0,
				binary: res.binary === true,
				tooLarge: res.tooLarge === true,
			};
		},
	);

	/** The two documents, once both ends are readable. */
	const both = (): Extract<SidesData, { ok: true }> | null => {
		const data = sides();
		if (!data || !data.ok) return null;
		return data;
	};
	const comparable = () => {
		const data = both();
		return data != null && !data.binary && !data.tooLarge;
	};
	const sidesError = () => {
		const data = sides();
		return data && !data.ok ? data.error : null;
	};
	const stats = () => ({ add: both()?.add ?? 0, del: both()?.del ?? 0 });

	// A line diff is still the only reading for a binary file or one too large to hold both ends, so the
	// patch is fetched exactly then.
	const [patch] = createResource(
		() => (shownChange() && props.partner && sides() !== undefined && !sides.loading && !comparable() ? { change: shownChange()!, name: props.partner } : null),
		async ({ change, name }): Promise<DiffData | null> => {
			const res = await rpc.request.git_diff({ name, path: change.path, staged: change.staged });
			if (!res.ok) return { error: res.error ?? "failed to load diff" };
			return res.kind === "new" ? { kind: "new", content: res.content ?? "" } : { kind: "diff", diff: res.diff ?? "" };
		},
	);

	const staged = () => (data()?.changes ?? []).filter((c) => c.staged);
	const unstaged = () => (data()?.changes ?? []).filter((c) => !c.staged);

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
			onClose={props.onClose}
			detail={{
				open: selected() != null,
				render: (leaving, list) => (
					<Show when={shownChange()}>
						{(change) => (
							<div class="git-diff dock-detail" classList={{ leaving }} style={`--explorer-line-height: ${lineHeight()}; --explorer-line-height-em: ${lineHeight()}em`}>
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
									<button type="button" class="git-back" title="Close this diff" onClick={() => setSelected(null)}>
										← Changes
									</button>
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
									<Show when={comparable()}>
										<button
											type="button"
											class="dock-btn"
											classList={{ on: props.sideBySide }}
											aria-pressed={props.sideBySide}
											aria-label={props.sideBySide ? "Show one column" : "Show both sides"}
											title={props.sideBySide ? "Show one column" : "Show both sides"}
											onClick={props.onToggleSideBySide}
										>
											<Columns2 size={11} />
										</button>
									</Show>
									<button
										type="button"
										class="dock-btn"
										classList={{ on: props.wrap }}
										aria-pressed={props.wrap}
										aria-label="Wrap long lines"
										title={props.wrap ? "Stop wrapping long lines" : "Wrap long lines"}
										onClick={props.onToggleWrap}
									>
										<WrapText size={11} />
									</button>
									<Show when={sidesError()}>{(message) => <span class="git-diff-error">{message()}</span>}</Show>
								</div>
								<Show
									when={comparable() ? both() : null}
									fallback={
										<Show
											when={!sides.loading}
											fallback={
												<div class="git-diff-note">
													<span class="work-dot" />
													<span class="work-dot" />
													<span class="work-dot" />
												</div>
											}
										>
											<Show when={both()?.binary}>
												<div class="git-diff-note">binary file · no line-by-line diff</div>
											</Show>
											<Show when={both()?.tooLarge}>
												<div class="git-diff-note">file too large to compare side by side</div>
											</Show>
											<Show when={patch()?.error ?? sidesError()}>{(message) => <div class="git-diff-note">{message()}</div>}</Show>
											<Show when={patch()?.kind === "new"}>
												<div class="git-diff-body" classList={{ wrap: props.wrap }}>
													<div class="git-diff-new-note">new file</div>
													<For each={(patch()?.content ?? "").split("\n")}>{(line) => <div class="git-diff-line add">{line || " "}</div>}</For>
												</div>
											</Show>
											<Show when={patch()?.kind === "diff"}>
												<div class="git-diff-body" classList={{ wrap: props.wrap }}>
													<For each={(patch()?.diff ?? "").split("\n")}>{(line) => <DiffLineView text={line} />}</For>
												</div>
											</Show>
										</Show>
									}
								>
									{(data) => (
										<CodeDiff original={data().original} modified={data().modified} lang={languageForPath(change().path)} sideBySide={props.sideBySide} wrap={props.wrap} />
									)}
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
