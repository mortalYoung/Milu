import { Activity, Feather, MessageSquare, Settings } from "lucide-solid";

export type RailTabId = "chat" | "skills" | "dashboard" | "settings";

export function AppRail(props: { active: RailTabId; onSelect: (id: RailTabId) => void }) {
	return (
		<nav class="rail electrobun-webkit-app-region-drag">
			<button
				type="button"
				class={"rail-tab electrobun-webkit-app-region-no-drag" + (props.active === "chat" ? " active" : "")}
				title="Chat"
				aria-label="Chat"
				onClick={() => props.onSelect("chat")}
			>
				<MessageSquare size={18} />
			</button>
			<button
				type="button"
				class={"rail-tab electrobun-webkit-app-region-no-drag" + (props.active === "skills" ? " active" : "")}
				title="Skills"
				aria-label="Skills"
				onClick={() => props.onSelect("skills")}
			>
				<Feather size={18} />
			</button>

			<button
				type="button"
				class={"rail-tab electrobun-webkit-app-region-no-drag" + (props.active === "dashboard" ? " active" : "")}
				title="Dashboard"
				aria-label="Dashboard"
				onClick={() => props.onSelect("dashboard")}
			>
				<Activity size={18} />
			</button>

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
