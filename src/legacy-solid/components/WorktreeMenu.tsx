import { FolderTree } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import type { GitWorktreeItem } from "../../shared/rpc";
import { formatWorkspacePath } from "../lib/composer-input";
import { useCommandDirectory } from "../lib/contexts/commands-context";
import { useToast } from "../lib/contexts/toast-context";
import { rpc } from "../lib/rpc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

interface WorktreeData {
	worktrees: GitWorktreeItem[];
	current: string | null;
}

export function WorktreeMenu(props: { partner: string | null; buttonClass: string; onSwitch?: () => void }) {
	const commands = useCommandDirectory();
	const toast = useToast();
	const [data, setData] = createSignal<WorktreeData | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const isCurrent = (worktree: GitWorktreeItem) => worktree.path === data()?.current;
	const currentBranch = () => {
		const worktrees = data()?.worktrees ?? [];
		return worktrees.find(isCurrent)?.branch ?? null;
	};
	const title = () => {
		const branch = currentBranch();
		return branch === null ? "Worktrees" : `Worktrees · ${branch}`;
	};

	async function load(partner: string) {
		setLoading(true);
		setError(null);
		try {
			const res = await rpc.request.git_worktrees({ name: partner });
			if (!res.ok) {
				setError(res.error ?? "worktrees unavailable");
				setData(null);
				return;
			}
			setData({ worktrees: res.worktrees ?? [], current: res.current ?? null });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setData(null);
		} finally {
			setLoading(false);
		}
	}

	function onOpenChange(open: boolean) {
		if (open && props.partner !== null) void load(props.partner);
	}

	async function switchTo(path: string) {
		let failure: string | null = null;
		try {
			const res = await commands.execute(`/workspace ${path}`);
			if (!res.ok) failure = res.error ?? "workspace switch failed";
			else if (res.result?.kind === "error") failure = res.result.text ?? "workspace switch failed";
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
		}
		if (failure !== null) {
			toast.push({ title: "Couldn't switch workspace", body: failure }, "error");
			return;
		}
		props.onSwitch?.();
	}

	return (
		<DropdownMenu onOpenChange={onOpenChange}>
			<DropdownMenuTrigger type="button" class={props.buttonClass} title={title()} aria-label="Worktrees">
				<FolderTree size={16} />
			</DropdownMenuTrigger>
			<DropdownMenuContent class="min-w-[320px] max-w-[380px] rounded-[8px] p-0">
				<div class="wt-head">
					<span class="eyebrow">Worktrees</span>
					<Show when={data()}>{(loaded) => <span class="wt-count">{loaded().worktrees.length}</span>}</Show>
				</div>
				<div class="wt-list">
					<Show when={loading()}>
						<div class="wt-state">loading…</div>
					</Show>
					<Show when={error()}>{(message) => <div class="wt-state wt-error">{message()}</div>}</Show>
					<Show when={!loading() && error() === null && data()?.worktrees.length === 0}>
						<div class="wt-state">no worktrees</div>
					</Show>
					<For each={data()?.worktrees ?? []}>
						{(worktree) => (
							<DropdownMenuItem class="flex w-full flex-col items-start gap-[1px] px-3 py-2" onSelect={() => void switchTo(worktree.path)}>
								<span class="wt-branch">
									<span class="wt-name">{worktree.branch ?? "detached"}</span>
									<Show when={isCurrent(worktree)}>
										<span class="wt-check">✓</span>
									</Show>
								</span>
								<span class="wt-path" title={worktree.path}>
									{formatWorkspacePath(worktree.path, 46)}
								</span>
							</DropdownMenuItem>
						)}
					</For>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
