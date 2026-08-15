/**
 * AppRail — the 64px icon rail on the left (letter direction): brand letter circle + Chat tab + footer (Settings).
 * active = warm-ink solid + paper-colored icon.
 */
import { MessageSquare, Settings } from "lucide-solid";

export type RailTabId = "chat" | "settings";

export function AppRail(props: { active: RailTabId; onSelect: (id: RailTabId) => void }) {
	return (
		<nav class="rail electrobun-webkit-app-region-drag">
			{/* Top empty drag region: makes room for the floating traffic lights */}
			<div class="rail-spacer" />
			{/* Brand area: P letter circle */}
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

			{/* Footer: settings */}
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
