/**
 * App — the controller. Owns app state, wires RPC events into visible
 * transcript entries, and renders the shell: icon rail + chat / settings views.
 * Partners are created via a modal and saved as folders (see src/bun/partners.ts).
 */

import { Electroview } from "electrobun/view";
import { createSignal } from "solid-js";
import type { AppRPCSchema } from "../shared/rpc";
import { AppRail } from "./components/AppRail";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { type PartnerFormData, PartnerModal } from "./components/PartnerModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { type Entry, makeAgentEntry, makeSepEntry, makeSysEntry, makeUserEntry, SEPARATOR_GAP_MS } from "./layouts/Transcript";
import { ConversationPage } from "./pages/ConversationPage";
import { type SettingsData, SettingsView } from "./pages/SettingsView";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

interface PartnerItem {
	name: string;
	avatar?: string;
	role?: string;
	responsibilities?: string;
	tones?: string;
	createdAt: number;
}

export function App() {
	// ————— state —————
	const [view, setView] = createSignal<"chat" | "settings">("chat");
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	// Partner 详情弹窗(列表菜单 / 头部点击共用)
	const [detailsPartner, setDetailsPartner] = createSignal<PartnerItem | null>(null);
	const [entries, setEntries] = createSignal<Entry[]>([]);
	// busy = agent 是否在运行(流式/工具执行中),单一来源;推送事件做增量,get_status 校准
	const [busy, setBusy] = createSignal(false);
	const [queued, setQueued] = createSignal(0);
	const [tick, setTick] = createSignal(0);
	const [selected, setSelected] = createSignal<string | null>(null);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [showModal, setShowModal] = createSignal(false);
	const [settings, setSettings] = createSignal<SettingsData | null>(null);
	const [runtime, setRuntime] = createSignal<{ model: string; apiKeyConfigured: boolean } | null>(null);
	// chat 列表收起状态(持久化)
	const [listCollapsed, setListCollapsed] = createSignal(localStorage.getItem("chatlist.collapsed") === "1");
	function toggleListCollapsed() {
		const next = !listCollapsed();
		setListCollapsed(next);
		localStorage.setItem("chatlist.collapsed", next ? "1" : "0");
	}
	let lastMsgTime = 0;

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
	};

	// ————— RPC helpers —————
	// 渲染来源 = 持久化 JSONL;按 id 去重,只追加新记录
	const renderedIds = new Set<string>();
	async function refreshHistory() {
		const { items } = await rpc.request.history({});
		const fresh = items.filter((item) => !renderedIds.has(item.id));
		for (const item of fresh) {
			renderedIds.add(item.id);
			maybeTimeSeparator(new Date(item.time));
			push(item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time));
		}
	}

	const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
	const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
	function maybeTimeSeparator(d: Date) {
		if (lastMsgTime && d.getTime() - lastMsgTime > SEPARATOR_GAP_MS) {
			push(makeSepEntry(`${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`));
		}
		lastMsgTime = d.getTime();
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setPartners(list);
		// 默认选中第一个 Partner;已选中项消失时清空
		if (selected() == null && list.length > 0) selectPartner(list[0]);
		if (selected() != null && !list.some((p) => p.name === selected())) selectPartner(null);
	}

	// 选择 Partner → 切换会话(清空当前聊天)+ 动态重建系统提示词
	function selectPartner(partner: PartnerItem | null) {
		setSelected(partner?.name ?? null);
		setEntries([]);
		renderedIds.clear();
		lastMsgTime = 0;
		void rpc.request
			.set_partner({
				profile: partner ? { name: partner.name, role: partner.role, responsibilities: partner.responsibilities, tones: partner.tones } : null,
			})
			.then(() => refreshHistory());
	}

	async function refreshSettings() {
		const { settings: s, runtime: r } = await rpc.request.get_settings({});
		setSettings(s);
		setRuntime(r);
	}

	// ————— RPC events —————
	rpc.addMessageListener("agent_turn", ({ turn: t }) => {
		setBusy(true);
		if (queued() > 0) {
			setQueued((q) => q - 1);
			push(makeSysEntry(`✳ follow-up · turn ${t}`));
		}
		bump();
	});

	rpc.addMessageListener("agent_message", () => {
		void refreshHistory();
	});

	rpc.addMessageListener("agent_end", ({ error: err }) => {
		setQueued(0);
		if (err) push(makeSysEntry(`ERR § ${err}`, true));
		bump();
		calibrateBusy();
	});

	// 校准:以 bun 侧 isStreaming 为准,兜底推送事件丢失/晚到(如挂载晚于 turn 的启动竞态)
	function calibrateBusy() {
		void rpc.request.get_status({}).then((s) => setBusy(s.streaming));
	}

	// ————— user input —————
	function onSend(text: string) {
		if (busy()) {
			push(makeSysEntry("✳ follow-up queued"));
			setQueued((q) => q + 1);
		}
		void rpc.request.chat({ text }).then(() => refreshHistory());
	}

	// ————— Partner 删除 —————
	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });
		// 若删除的是当前选中 Partner:立即关闭(重置选中与提示词)
		if (selected() === name) selectPartner(null);
		void refreshPartners();
	}

	// ————— Partner 创建 —————
	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			setShowModal(false);
			void refreshPartners();
			return null;
		}
		return res.error ?? "Failed to create partner";
	}

	// 预览 = 四段系统提示词拼装效果(identify/tool-guidance 只读展示在拼装结果里)
	function onPreviewPrompt(data: PartnerFormData): Promise<string> {
		return rpc.request
			.preview_system_prompt({
				profile: { role: data.role, responsibilities: data.responsibilities, tones: data.tones },
			})
			.then((res) => res.prompt);
	}

	// ————— 挂载 —————
	void refreshHistory();
	void refreshPartners();
	void refreshSettings();
	calibrateBusy();

	// ————— shell —————
	return (
		<div class="flex flex-1 min-h-0">
			<AppRail active={view()} onSelect={(tab) => (tab === "settings" ? setSettingsOpen(true) : setView("chat"))} />

			<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
				<ConversationPage
					partners={partners()}
					selected={selected()}
					onSelect={(name) => selectPartner(partners().find((p) => p.name === name) ?? null)}
					onAddPartner={() => setShowModal(true)}
					onDelete={onDeletePartner}
					onViewDetails={(name) => setDetailsPartner(partners().find((p) => p.name === name) ?? null)}
					listCollapsed={listCollapsed()}
					onToggleList={toggleListCollapsed}
					entries={entries}
					working={busy}
					tick={tick}
					busy={busy}
					onSend={onSend}
					onStop={() => void rpc.request.stop({})}
				/>
			</main>

			{/* 设置:弹窗 */}
			<Dialog open={settingsOpen()} onOpenChange={setSettingsOpen}>
				<DialogContent class="w-[440px] bg-white border-print-line">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<SettingsView
						settings={settings()}
						runtime={runtime()}
						onLoad={() => void refreshSettings()}
						onSave={async (s) => {
							await rpc.request.update_settings({ settings: s });
							setSettings(s);
						}}
					/>
				</DialogContent>
			</Dialog>

			<PartnerModal open={showModal()} onOpenChange={setShowModal} onConfirm={onCreatePartner} onPreview={onPreviewPrompt} />

			<PartnerDetailsDialog partner={detailsPartner()} onOpenChange={(open) => !open && setDetailsPartner(null)} />
		</div>
	);
}
