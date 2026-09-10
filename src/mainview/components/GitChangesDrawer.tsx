import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { GitChangeItem } from "../../shared/rpc";
import { createPresence, DOCK_EXIT_MS, DOCK_POPOVER_EXIT_MS } from "../lib/presence";
import { rpc } from "../lib/rpc";

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
	const drawer = createPresence(() => props.open, DOCK_EXIT_MS);
	const viewer = createPresence(() => props.open && selected() != null, DOCK_POPOVER_EXIT_MS);
	const shownChange = createMemo<GitChangeItem | null>((prev) => selected() ?? prev, null);

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
		return () => window.removeEventListener("keydown", onKey);
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
		<>
			<Show when={drawer.visible()}>
				<aside class={"git-drawer dock-panel side-" + (props.side ?? "right")} classList={{ leaving: drawer.leaving() }}>
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
				</aside>

				<Show when={viewer.visible()}>
					<Show when={shownChange()}>
						{(change) => (
							<div class={"git-popover dock-pop side-" + (props.side ?? "right")} classList={{ leaving: viewer.leaving() }}>
								<div class="git-popover-head">
									<span class="git-popover-path">{change().path}</span>
									<Show when={diffData()?.error}>
										<span class="git-popover-error">{diffData()!.error}</span>
									</Show>
									<button type="button" class="git-popover-close" title="Close" onClick={() => setSelected(null)}>
										×
									</button>
								</div>
								<Show when={!diffData.loading} fallback={<div class="git-popover-note">loading…</div>}>
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
			</Show>
		</>
	);
}
