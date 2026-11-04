import { SLOT_POINTS, type WelcomeItem } from "@milu/protocol";
import { byPinThenRecency, formatHotkey, type Host, Kbd } from "@milu/window";
import { useEffect } from "react";
import { useStore } from "zustand";

const NO_TIMELINE: readonly never[] = [];

function EmptySchedule() {
	return (
		<section className="welcome-schedule">
			<div className="welcome-schedule-head">
				<span>Schedule</span>
				<span className="welcome-schedule-count">0 upcoming</span>
			</div>
			<div className="welcome-schedule-empty">
				<p className="welcome-schedule-empty-title">Nothing scheduled.</p>
				<p className="welcome-schedule-empty-hint">try “every day at 9:00 summarize the repo”</p>
			</div>
		</section>
	);
}

export function Welcome(props: { host: Host }) {
	const { host } = props;
	const items = useStore(host.welcome.store, (state) => state.items);
	const timeline = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.welcomeTimeline] ?? NO_TIMELINE);
	const bindings = useStore(host.hotkeys.store, (state) => state.bindings);
	const components = useStore(host.slots.store, (state) => state.components);
	const sessions = useStore(host.sessions.store, (state) => state.rows);

	useEffect(() => {
		const load = (): void => {
			void host.slots.load(SLOT_POINTS.welcomeTimeline);
		};
		load();
		const subscription = host.connection.onLive((event) => {
			if (event.type === "status") load();
		});
		return () => subscription.dispose();
	}, [host]);

	const invoke = (item: WelcomeItem): void => {
		void host.actions.invoke(item.action, undefined, item.args);
	};
	const keysOf = (item: WelcomeItem): string => {
		const binding = bindings.find((each) => each.id === item.action);
		return binding ? formatHotkey(binding.hotkey, host.hotkeys.platform) : (item.keys ?? []).join("");
	};

	const ordered = [...items].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
	const primary = ordered.find((item) => item.variant === "primary") ?? ordered[0];
	const entries = primary === undefined ? [] : [primary, ...ordered.filter((item) => item !== primary)];
	const resume = [...sessions].sort(byPinThenRecency)[0];

	return (
		<div className="welcome">
			<div className="welcome-left">
				<div className="welcome-eyebrow">New Chat</div>
				<h2 className="welcome-head">Next up.</h2>
				<p className="welcome-sub">A new chat, or the one you left open. Each keeps its own memory, model and permissions.</p>
				<div className="welcome-entries">
					{entries.map((item) => {
						const first = item === primary;
						const key = keysOf(item);
						return (
							<button key={item.id} type="button" className={first ? "welcome-entry is-primary" : "welcome-entry"} onClick={() => invoke(item)}>
								<span className="welcome-entry-label">{item.title}</span>
								<span className="welcome-entry-key">{key === "" ? null : <Kbd tone={first ? "on-ink" : "default"}>{key}</Kbd>}</span>
								<span className="welcome-entry-arrow" aria-hidden="true">
									→
								</span>
							</button>
						);
					})}
				</div>
			</div>

			<div className="welcome-right">
				<div className="welcome-schedule-body">
					{timeline.length === 0 ? (
						<EmptySchedule />
					) : (
						timeline.map((item) => {
							const Component = components.get(item.component);
							return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
						})
					)}
				</div>
				{timeline.length === 0 ? null : <div className="welcome-schedule-foot">All times local</div>}
			</div>

			{resume === undefined ? null : (
				<div className="welcome-foot">
					<button type="button" className="welcome-resume" onClick={() => void host.selection.select(resume.name)}>
						Resume “{resume.name}” →
					</button>
				</div>
			)}
		</div>
	);
}
