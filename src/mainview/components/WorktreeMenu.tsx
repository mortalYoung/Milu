import { FolderTree } from "lucide-react";
import { useState } from "react";
import type { GitWorktreeItem } from "../../shared/rpc";
import { formatWorkspacePath } from "../lib/composer-input";
import { useCommandDirectory } from "../lib/contexts/commands-context";
import { useToast } from "../lib/contexts/toast-context";
import { rpc } from "../lib/rpc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tip } from "./ui/tooltip";

interface WorktreeData {
	worktrees: GitWorktreeItem[];
	current: string | null;
}

export function WorktreeMenu(props: { partner: string | null; buttonClass: string; onSwitch?: () => void }) {
	const commands = useCommandDirectory();
	const toast = useToast();
	const [data, setData] = useState<WorktreeData | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isCurrent = (worktree: GitWorktreeItem) => worktree.path === data?.current;
	const currentBranch = (data?.worktrees ?? []).find(isCurrent)?.branch ?? null;
	const title = currentBranch === null ? "Worktrees" : `Worktrees · ${currentBranch}`;

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
		<DropdownMenu
			onOpenChange={(open) => {
				if (open && props.partner !== null) void load(props.partner);
			}}
		>
			<Tip label={title}>
				<DropdownMenuTrigger type="button" className={props.buttonClass} aria-label="Worktrees">
					<FolderTree size={16} />
				</DropdownMenuTrigger>
			</Tip>
			<DropdownMenuContent className="min-w-[320px] max-w-[380px] rounded-[6px] p-0">
				<div className="wt-head">
					<span className="eyebrow">Worktrees</span>
					{data && <span className="wt-count">{data.worktrees.length}</span>}
				</div>
				<div className="wt-list">
					{loading && <div className="wt-state">loading…</div>}
					{error && <div className="wt-state wt-error">{error}</div>}
					{!loading && error === null && data?.worktrees.length === 0 && <div className="wt-state">no worktrees</div>}
					{(data?.worktrees ?? []).map((worktree) => (
						<DropdownMenuItem key={worktree.path} className="flex w-full flex-col items-start gap-[1px] px-3 py-2" onSelect={() => void switchTo(worktree.path)}>
							<span className="wt-branch">
								<span className="wt-name">{worktree.branch ?? "detached"}</span>
								{isCurrent(worktree) && <span className="wt-check">✓</span>}
							</span>
							<Tip label={worktree.path} className="max-w-[320px]">
								<span className="wt-path">{formatWorkspacePath(worktree.path, 46)}</span>
							</Tip>
						</DropdownMenuItem>
					))}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
