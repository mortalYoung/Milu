import { Activity, Feather, MessageSquare, Settings } from "lucide-react";
import type { RailView } from "../../shared/rpc";

export type RailTabId = RailView | "settings";

const TABS: { id: RailTabId; title: string; icon: typeof MessageSquare }[] = [
	{ id: "chat", title: "Chat", icon: MessageSquare },
	{ id: "skills", title: "Skills", icon: Feather },
	{ id: "dashboard", title: "Dashboard", icon: Activity },
];

export function AppRail(props: { active: RailTabId; onSelect: (id: RailTabId) => void }) {
	return (
		<nav className="rail electrobun-webkit-app-region-drag">
			{TABS.map(({ id, title, icon: Icon }) => (
				<button
					key={id}
					type="button"
					className={"rail-tab electrobun-webkit-app-region-no-drag" + (props.active === id ? " active" : "")}
					title={title}
					aria-label={title}
					onClick={() => props.onSelect(id)}
				>
					<Icon size={18} />
				</button>
			))}

			<div className="rail-footer">
				<button
					type="button"
					className={"rail-settings electrobun-webkit-app-region-no-drag" + (props.active === "settings" ? " active" : "")}
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
