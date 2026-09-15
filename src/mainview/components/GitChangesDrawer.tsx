import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { GitChangeItem } from "../../shared/rpc";
import { createPresence, DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS } from "../lib/presence";
import { rpc } from "../lib/rpc";
import { clampPaneWidth, DockGrip } from "./DockGrip";

const LIST_MIN = 220;
const LIST_MAX = 420;
const LIST_DEFAULT = 320;
const LIST_WIDTH_KEY = "git.listWidth";

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

function storedListWidth() {
	const stored = Number(localStorage.getItem(LIST_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, LIST_MIN, LIST_MAX) : LIST_DEFAULT;
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

export function GitChangesDrawer(props: { open: boolean; partner: string | null; side?: "left" | "right"; onClose: () => void }) {
	const [data, setData] = createSignal<GitData | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [selected, setSelected] = createSignal<GitChangeItem | null>(null);
	const [listWidth, setListWidth] = createSignal(storedListWidth());
	const drawer = createPresence(() => props.open, DOCK_EXIT_MS);
	const viewer = createPresence(() => props.open && selected() != null, DOCK_POPOVER_EXIT_MS);
	const shownChange = createMemo<GitChangeItem | null>((prev) => selected() ?? prev, null);
	let dockEl: HTMLDivElement | undefined;

	function commitWidth() {
		localStorage.setItem(LIST_WIDTH_KEY, String(listWidth()));
	}

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
		if (props.open && props.partner) {
			setSelected(null);
			void refresh();
		}
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

	createEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (selected()) setSelected(null);
			else props.onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});

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
		<Show when={drawer.visible()}>
			<div class={"git-dock side-" + (props.side ?? "right")} classList={{ leaving: drawer.leaving() }} ref={dockEl}>
				<Show when={viewer.visible()}>
					<Show when={shownChange()}>
						{(change) => (
							<div class="git-diff" classList={{ leaving: viewer.leaving() }}>
								<div class="git-diff-head">
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
				</Show>
				<Show when={viewer.visible()}>
					<DockGrip
						host={() => dockEl}
						width={listWidth}
						min={LIST_MIN}
						max={LIST_MAX}
						side={props.side ?? "right"}
						label="Resize the change list"
						onResize={setListWidth}
						onCommit={commitWidth}
					/>
				</Show>
				<div class="git-list-pane" style={{ width: `${listWidth()}px` }}>
					<div class="git-head">
						<span class="git-title">Git Changes</span>
						<span class="git-root">{shortRoot()}</span>
						<button
							type="button"
							class={"git-refresh" + (loading() ? " loading" : "")}
							title={loading() ? "Refreshing…" : "Refresh"}
							disabled={loading()}
							onClick={() => void refresh()}
						>
							↻
						</button>
						<button type="button" class="git-close" title="Close" onClick={props.onClose}>
							×
						</button>
					</div>
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
				</div>
			</div>
		</Show>
	);
}
