import { formatHotkey, type Host } from "@milu/extensions/host";
import type { WelcomeItem } from "@milu/protocol";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { IconByName } from "./icons.tsx";

const HEAD = "Say something and it starts.";

let typed = false;

const calm = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Welcome(props: { host: Host }) {
	const { host } = props;
	const items = useStore(host.welcome.store, (state) => state.items);
	const bindings = useStore(host.hotkeys.store, (state) => state.bindings);
	const [chars, setChars] = useState(() => (typed || calm() ? HEAD.length : 0));
	const typing = chars < HEAD.length;

	useEffect(() => {
		typed = true;
	}, []);

	useEffect(() => {
		if (!typing) return;
		const timer = window.setTimeout(() => setChars((count) => count + 1), chars === 0 ? 220 : 26 + Math.random() * 26);
		return () => window.clearTimeout(timer);
	}, [chars, typing]);

	const buttons = items.filter((item) => item.variant !== "key");
	const keys = items.filter((item) => item.variant === "key");
	const invoke = (item: WelcomeItem): void => {
		void host.actions.invoke(item.action, undefined, item.args);
	};
	const keysOf = (item: WelcomeItem): string => {
		const binding = bindings.find((each) => each.id === item.action);
		return binding ? formatHotkey(binding.hotkey, host.hotkeys.platform) : (item.keys ?? []).join("");
	};

	return (
		<div className="welcome">
			<h2 className="welcome-head">
				<span className="welcome-head-text">
					{HEAD.slice(0, chars)}
					{typing ? <span className="welcome-caret" aria-hidden="true" /> : null}
				</span>
			</h2>
			<p className="welcome-sub">A new chat, or the one you left open. Each keeps its own memory, model and permissions.</p>

			<div className="welcome-tl">
				<span className="welcome-spine" aria-hidden="true" />
				<section className="welcome-grp">
					<h3 className="welcome-eyebrow">Next</h3>
					<ul>
						<li className="welcome-row-item">
							<span className="welcome-empty">
								<span className="welcome-tick" aria-hidden="true" />
								<span className="welcome-what">nothing coming up</span>
								<span className="welcome-hint">try “every day at 9:00 summarize the repo”</span>
							</span>
						</li>
					</ul>
				</section>
			</div>

			<div className="welcome-acts">
				{buttons.length === 0 ? null : (
					<div className="welcome-buttons">
						{buttons.map((item) => (
							<button key={item.id} type="button" className={item.variant === "primary" ? "welcome-btn is-primary" : "welcome-btn"} onClick={() => invoke(item)}>
								{item.icon ? <IconByName name={item.icon} size={13} /> : null}
								<span>{item.title}</span>
								{keysOf(item) ? <span className="welcome-kbd">{keysOf(item)}</span> : null}
							</button>
						))}
					</div>
				)}
				{keys.length === 0 ? null : (
					<div className="welcome-keys">
						{keys.map((item) => (
							<button key={item.id} type="button" className="welcome-key" onClick={() => invoke(item)}>
								<span>{item.title}</span>
								<span className="welcome-kbds">
									{(item.keys ?? []).map((key, index) => (
										<kbd key={index}>{key}</kbd>
									))}
								</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
