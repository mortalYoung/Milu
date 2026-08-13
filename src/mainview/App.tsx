/**
 * App — the controller. Owns app state (busy/queued/turn/working), wires RPC
 * events into visible transcript entries, and renders the IM shell:
 * conversation list (left) + chat window (right).
 * Only user messages and send_message output reach the transcript.
 */

import { Electroview } from "electrobun/view";
import { Bot, MoreHorizontal, Search } from "lucide-solid";
import { createSignal } from "solid-js";
import type { AppRPCSchema } from "../shared/rpc";
import { Button } from "./components/Button";
import { Composer } from "./components/Composer";
import { type ConversationItem, ConversationList } from "./components/ConversationList";
import { type Entry, fmtTime, makeAgentEntry, makeSepEntry, makeSysEntry, makeUserEntry, SEPARATOR_GAP_MS, Transcript } from "./layouts/Transcript";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

export function App() {
	// ————— state —————
	const [entries, setEntries] = createSignal<Entry[]>([]);
	const [busy, setBusy] = createSignal(false);
	const [working, setWorking] = createSignal(false);
	const [queued, setQueued] = createSignal(0);
	const [error, setError] = createSignal<string | null>(null);
	const [tick, setTick] = createSignal(0);
	const [conversation, setConversation] = createSignal<ConversationItem>({ id: "main", name: "Coding Desktop", preview: "", time: "" });
	let lastMsgTime = 0;

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
	};

	// 渲染来源 = 持久化 JSONL(经 bun 拉取);按 id 去重,只追加新记录
	const renderedIds = new Set<string>();
	async function refreshHistory() {
		const { items } = await rpc.request.history({});
		const fresh = items.filter((item) => !renderedIds.has(item.id));
		for (const item of fresh) {
			renderedIds.add(item.id);
			maybeTimeSeparator(new Date(item.time));
			push(item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time));
		}
		// 对话列表:最后一条可见消息作为预览
		const last = items[items.length - 1];
		if (last) {
			setConversation((prev) => ({
				...prev,
				preview: last.text,
				time: fmtTime(new Date(last.time)),
			}));
		}
	}

	function maybeTimeSeparator(d: Date) {
		if (lastMsgTime && d.getTime() - lastMsgTime > SEPARATOR_GAP_MS) {
			const sameDay = new Date(lastMsgTime).toDateString() === d.toDateString();
			push(makeSepEntry(sameDay ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()} · ${fmtTime(d)}`));
		}
		lastMsgTime = d.getTime();
	}

	// ————— RPC events → state + entries —————
	rpc.addMessageListener("agent_turn", ({ turn: t }) => {
		setBusy(true);
		if (!working()) setWorking(true);
		// agent_turn 每个回合都触发(含内循环工具迭代);
		// 只有真实排空 follow-up 队列才显示提示
		if (queued() > 0) {
			setQueued((q) => q - 1);
			push(makeSysEntry(`✳ follow-up · turn ${t}`));
		}
		bump();
	});

	// send_message 已入库 → 重新拉取渲染
	rpc.addMessageListener("agent_message", () => {
		void refreshHistory();
	});

	// 挂载后拉取历史(存储驱动渲染;推送可能在视图就绪前丢失,故用 request)
	void refreshHistory();

	rpc.addMessageListener("agent_end", ({ error: err }) => {
		setBusy(false);
		setWorking(false);
		setQueued(0);
		setError(err ?? null);
		if (err) push(makeSysEntry(`ERR § ${err}`, true));
		bump();
	});

	// ————— user input —————
	function onSend(text: string) {
		if (busy()) {
			push(makeSysEntry("✳ follow-up queued"));
			setQueued((q) => q + 1);
		}
		// chat 返回时用户消息已落盘 → 拉取渲染(不走乐观渲染)
		void rpc.request.chat({ text }).then(() => refreshHistory());
	}

	const statusText = () => (busy() ? "回复中…" : error() ? "出错了" : "在线");

	// ————— shell —————
	// 顶部无独立拖拽条:聊天头部与对话列表顶部即拖拽区(红绿灯悬浮于列表左上,
	// 列表内容用 pt 让位)。交互元素需 no-drag。
	return (
		<div class="flex flex-1 min-h-0">
			{/* 对话列表 */}
			<ConversationList item={conversation()} />

			{/* 聊天窗口 */}
			<div class="flex flex-1 flex-col min-w-0">
				<div class="chat-header electrobun-webkit-app-region-drag">
					<span class="msg-avatar avatar-agent">
						<Bot size={16} />
					</span>
					<div class="flex flex-col leading-tight">
						<span class="chat-title">Coding Desktop</span>
						<span class="chat-status">{statusText()}</span>
					</div>
					<span class="flex-1" />
					<Button variant="icon" class="electrobun-webkit-app-region-no-drag" title="搜索" icon={<Search size={16} />} />
					<Button variant="icon" class="electrobun-webkit-app-region-no-drag" title="更多" icon={<MoreHorizontal size={16} />} />
				</div>

				<Transcript entries={entries} working={working} tick={tick} />

				<Composer busy={busy} onSend={onSend} onStop={() => void rpc.request.stop({})} />
			</div>
		</div>
	);
}
