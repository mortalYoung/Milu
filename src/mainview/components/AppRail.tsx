/**
 * AppRail — 左侧 64px 图标栏(书信方向):品牌字母圆 + Chat 标签 + footer(Settings)。
 * active = 暖墨实底 + 纸色图标。
 */
import { MessageSquare, Settings } from "lucide-solid";

export type RailTabId = "chat" | "settings";

export function AppRail(props: { active: RailTabId; onSelect: (id: RailTabId) => void }) {
	return (
		<nav class="rail electrobun-webkit-app-region-drag">
			{/* 顶部空拖拽区:让位给悬浮的红绿灯 */}
			<div class="rail-spacer" />
			{/* 品牌区:P 字母圆 */}
			<div class="rail-brand" title="Coding Desktop">
				P
			</div>
			<button
				type="button"
				class={"rail-tab electrobun-webkit-app-region-no-drag" + (props.active === "chat" ? " active" : "")}
				title="Chat"
				aria-label="Chat"
				onClick={() => props.onSelect("chat")}
			>
				<MessageSquare size={18} />
			</button>

			{/* footer:设置 */}
			<div class="rail-footer">
				<button
					type="button"
					class={"rail-settings electrobun-webkit-app-region-no-drag" + (props.active === "settings" ? " active" : "")}
					title="Settings"
					aria-label="Settings"
					onClick={() => props.onSelect("settings")}
				>
					<Settings size={18} />
				</button>
			</div>
		</nav>
	);
}
