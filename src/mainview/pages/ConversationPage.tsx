/**
 * ConversationPage — 聊天页:左侧 Partner 列表(来自配置目录)+ 右侧聊天窗口。
 * 头部标题跟随选中的 Partner。
 */
import { PanelLeft, PanelLeftOpen } from "lucide-solid";
import type { Accessor } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import { Button } from "../components/Button";
import { Composer } from "../components/Composer";
import { ConversationList, type PartnerItem } from "../components/ConversationList";
import { type Entry, Transcript } from "../layouts/Transcript";

export function ConversationPage(props: {
	partners: PartnerItem[];
	selected: string | null;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
	listCollapsed: boolean;
	onToggleList: () => void;
	entries: Accessor<Entry[]>;
	working: Accessor<boolean>;
	tick: Accessor<number>;
	busy: Accessor<boolean>;
	onSend: (text: string) => void;
	onStop: () => void;
}) {
	return (
		<div class="chat-page">
			<AnimatePresence>
				{!props.listCollapsed && (
					<Motion as="div" class="shrink-0 h-full" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
						<ConversationList
							partners={props.partners}
							selected={props.selected}
							busy={props.busy}
							onSelect={props.onSelect}
							onAddPartner={props.onAddPartner}
							onDelete={props.onDelete}
							onViewDetails={props.onViewDetails}
						/>
					</Motion>
				)}
			</AnimatePresence>

			<div class="chat-window">
				{/* 信封抬头:72px,上下发丝线,居中 "name · role";左上角为列表开关 */}
				<div class="chat-header electrobun-webkit-app-region-drag">
					<Button
						variant="ghost"
						size="icon"
						class="chat-toggle size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag"
						title={props.listCollapsed ? "Show chat list" : "Hide chat list"}
						icon={props.listCollapsed ? <PanelLeft size={16} /> : <PanelLeftOpen size={16} />}
						onClick={props.onToggleList}
					/>
					<div class="chat-worker electrobun-webkit-app-region-no-drag cursor-pointer" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
						<span>{props.selected ?? "Chat"}</span>
						<span class="chat-worker-sep">·</span>
						<span class="chat-worker-role">{props.partners.find((p) => p.name === props.selected)?.role ?? "partner"}</span>
						{props.busy() && (
							<span class="chat-worker-status" title="Working…">
								<span class="work-dot" />
								<span class="work-dot" />
								<span class="work-dot" />
								Writing…
							</span>
						)}
					</div>
				</div>
				{props.selected ? (
					<>
						<Transcript entries={props.entries} working={props.working} tick={props.tick} worker={props.selected} />
						<Composer busy={props.busy} onSend={props.onSend} onStop={props.onStop} />
					</>
				) : (
					// 必须选 Partner 才能聊天
					<div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
						<p class="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p class="eyebrow">the directory is on the left</p>
					</div>
				)}
			</div>
		</div>
	);
}
