/**
 * ConversationList — 左侧对话列表(IM 布局)。
 * 当前为单会话;条目展示名称/最后消息预览/时间,选中态高亮。
 */
import { Bot } from "lucide-solid";

export interface ConversationItem {
	id: string;
	name: string;
	preview: string;
	time: string;
}

export function ConversationList(props: { item: ConversationItem }) {
	return (
		// 列表顶部即窗口拖拽区(红绿灯悬浮于左上,pt 让位);交互元素 no-drag
		<aside class="w-60 shrink-0 bg-white border-r border-ink/10 flex flex-col electrobun-webkit-app-region-drag">
			{/* 搜索框(IM 惯例;当前列表只有一个会话) */}
			<div class="px-3 pt-10 pb-2 electrobun-webkit-app-region-no-drag">
				<div class="flex items-center gap-2 bg-paper rounded-md px-2.5 py-1.5">
					<Bot size={13} class="text-ink-soft" />
					<input
						class="flex-1 min-w-0 bg-transparent border-none outline-none font-sans text-[12px] text-ink placeholder:text-ink-soft"
						type="text"
						placeholder="搜索"
						spellcheck={false}
					/>
				</div>
			</div>

			<button type="button" class="conv-item selected mx-2 mb-2 electrobun-webkit-app-region-no-drag">
				<span class="conv-avatar avatar-agent">
					<Bot size={16} />
				</span>
				<span class="flex flex-col min-w-0 flex-1 text-left leading-tight">
					<span class="flex items-baseline justify-between gap-2">
						<span class="conv-name truncate">{props.item.name}</span>
						<span class="conv-time shrink-0">{props.item.time}</span>
					</span>
					<span class="conv-preview">{props.item.preview || "—"}</span>
				</span>
			</button>
		</aside>
	);
}
