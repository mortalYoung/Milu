import { memo, useCallback } from "react";
import type { TaskSummary } from "../../shared/rpc";
import { Composer } from "../components/Composer";
import { FollowUpDock } from "../components/FollowUpDock";
import { TaskLogDialog } from "../components/TaskLogDialog";
import { useScroll } from "../lib/contexts/scroll-context";
import { composer, scroll, session, transcript } from "../lib/controllers";
import { rpc } from "../lib/rpc";
import { Transcript } from "./Transcript";

function send(text: string) {
	scroll.pin(true);
	void rpc.request.chat({ text }).then((res) => {
		if (!res.accepted) return;
		const partner = session.store.getState().selected;
		composer.clear(partner ?? "");
		if (partner && res.messageId && !res.queued) transcript.echo(partner, res.messageId, text);
		void session.mutate.refreshHistory();
	});
}

/**
 * 工作台这一列（转录 + 输入区）。它只跟着「会话里的内容」重渲染 ——
 * 侧栏、dock、窗口宽度都改不动它：那些只动外面那一层的宽度，重排交给 CSS。
 */
export const Workbench = memo(function Workbench(props: {
	worker: string;
	working: boolean;
	historyLoading: boolean;
	activeBtwAnchor: string | null;
	onBtwAnchor: (key: string | null) => void;
	tasks: TaskSummary[];
	taskVersion: number;
	taskOutput: number;
	taskOpen: boolean;
	onTaskOpenChange: (open: boolean) => void;
	onTaskOpen: () => void;
}) {
	const scrollFollower = useScroll();
	const onEscalationRespond = useCallback((id: string, approved: boolean) => void rpc.request.sandbox_respond({ id, approved }), []);
	const onStop = useCallback(() => void rpc.request.stop({}), []);
	const onShell = useCallback(
		(command: string) => {
			scrollFollower.pin(true);
			return rpc.request.shell_execute({ command });
		},
		[scrollFollower],
	);
	const onBtwClose = useCallback(() => props.onBtwAnchor(null), [props.onBtwAnchor]);
	const taskRunning = props.tasks.filter((task) => task.status === "running").length;

	return (
		<div className="chat-main">
			<div className="chat-column">
				<div className="chat-transcript-region">
					<Transcript
						working={props.working}
						historyLoading={props.historyLoading}
						worker={props.worker}
						onEscalationRespond={onEscalationRespond}
						onBtw={props.onBtwAnchor}
						onBtwClose={onBtwClose}
						activeBtwAnchor={props.activeBtwAnchor}
					/>
				</div>
				<div className="composer-slot">
					<FollowUpDock />
					<Composer onSend={send} onStop={onStop} onShell={onShell} onTasks={props.onTaskOpen} hasTasks={props.tasks.length > 0} taskRunning={taskRunning} />
					<TaskLogDialog
						open={props.taskOpen}
						onOpenChange={props.onTaskOpenChange}
						tasks={props.tasks}
						partner={props.worker}
						version={props.taskVersion}
						output={props.taskOutput}
					/>
				</div>
			</div>
		</div>
	);
});
