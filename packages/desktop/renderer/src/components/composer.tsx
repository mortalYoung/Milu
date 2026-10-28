import type { ComposerTip, ComposerWidget } from "@milu/protocol";
import { detectComposerTrigger, type ComposerTriggerToken, type Host, Kbd } from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { mark } from "../boot.ts";
import { ArrowUpIcon, SquareIcon } from "./icons.tsx";

const MAX_HEIGHT = 120;
const NO_ITEMS: readonly unknown[] = [];
const COMMAND_LINE = /^\/([a-z][a-z0-9_:-]*)(?:\s+(.*))?$/s;

function parseCommandLine(value: string): { name: string; args: string } | null {
	const match = COMMAND_LINE.exec(value.trim());
	return match ? { name: match[1] ?? "", args: match[2] ?? "" } : null;
}

const ComposerActions = memo(function ComposerActions(props: { readonly host: Host; readonly items: readonly ComposerWidget[] }) {
	return (
		<>
			{props.items.map((item) => {
				const Widget = props.host.widgets.get(item.widget);
				return Widget ? <Widget key={item.id} host={props.host} data={item.data} /> : null;
			})}
		</>
	);
});

const ComposerTips = memo(function ComposerTips(props: { readonly tips: readonly ComposerTip[]; readonly shellMode: boolean }) {
	const tips = props.tips.filter((tip) => (tip.when ?? "chat") === (props.shellMode ? "shell" : "chat"));
	if (tips.length === 0) return null;
	return (
		<div className="composer-tip">
			<div className={`composer-tip-row ${props.shellMode ? "shell" : "chat"}`} key={props.shellMode ? "shell" : "chat"}>
				{tips.map((tip) => (
					<span className="composer-tip-item" key={tip.id}>
						{tip.keys?.map((key, index) => (
							<Kbd key={`${tip.id}-${index}`}>{key}</Kbd>
						))}
						{tip.label}
					</span>
				))}
			</div>
		</div>
	);
});

export function Composer(props: { host: Host; onSent?: () => void }) {
	const { host } = props;
	const linked = useStore(host.connection.store, (state) => state.linked);
	const { layout, shellMode, modeSession, loaded } = useStore(host.composer.store);

	const selected = useStore(host.selection.store, (state) => state.selected);
	const shownShell = modeSession === selected ? shellMode : false;
	const awaiting = !loaded;
	const text = useStore(host.transcript.store, (state) => state.drafts[selected] ?? "");
	const busy = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.running ?? false);
	const stopping = useStore(host.transcript.store, (state) => state.stopping[selected] === true);

	const area = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	useStore(host.sessions.store, (state) => state.rows);
	useStore(host.commands.store, (state) => state.commands);
	const [menu, setMenu] = useState<{ readonly session: string; readonly token: ComposerTriggerToken } | null>(null);
	const [menuIndex, setMenuIndex] = useState(0);
	const lastTrigger = useRef<string | null>(null);
	const active = menu && menu.session === selected && !shownShell ? menu.token : null;
	const contribution = active ? host.triggers.get(active.trigger) : undefined;
	const items = active && contribution ? contribution.items(host, active.query) : NO_ITEMS;
	const menuSelected = items.length === 0 ? 0 : Math.min(menuIndex, items.length - 1);

	const resize = () => {
		const element = area.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
	};

	useEffect(() => {
		void host.composer.loadLayout();
		void host.composer.loadMode(selected);
		void host.commands.load(selected);
	}, [host, selected]);

	useEffect(() => {
		resize();
	}, [text]);

	useEffect(() => {
		const element = area.current;
		if (!element) return;
		element.style.height = "";
		resize();
		element.focus();
		const end = element.value.length;
		element.setSelectionRange(end, end);
		mark("interactive");
	}, [selected]);

	const submit = async (): Promise<void> => {
		const value = text.trim();
		if (!value || !selected) return;
		props.onSent?.();
		if (shownShell) {
			host.transcript.setDraft(selected, "");
			try {
				await host.actions.invoke("shell.run", selected, { command: value });
			} catch (error) {
				host.transcript.fail(selected, error instanceof Error ? error.message : String(error));
			}
			return;
		}
		const parsed = parseCommandLine(value);
		if (parsed) {
			const command = host.commands.find(parsed.name);
			if (!command) {
				syncTrigger(text, text.length);
				return;
			}
			try {
				await host.actions.invoke("chat.command", selected, { name: command.name, args: parsed.args });
				host.transcript.setDraft(selected, "");
				void host.sessions.refresh();
				await host.transcript.reload(selected);
				host.composerData.invalidate(selected);
			} catch (error) {
				host.transcript.fail(selected, error instanceof Error ? error.message : String(error));
			}
			return;
		}
		if (!linked) return;
		await host.transcript.send(selected, value);
	};

	const syncTrigger = (value: string, caret: number): void => {
		const chars = new Set(host.triggers.all().map((trigger) => trigger.trigger));
		const token = shownShell || composing.current ? null : detectComposerTrigger(value, caret, chars);
		const found = token ? host.triggers.get(token.trigger) : undefined;
		if (!token || !found || (found.leading === true && token.span.start !== 0)) {
			lastTrigger.current = null;
			setMenu(null);
			return;
		}
		const key = `${selected}:${token.trigger}:${token.query}:${token.span.start}`;
		if (lastTrigger.current === null) void host.commands.load(selected);
		if (lastTrigger.current !== key) {
			lastTrigger.current = key;
			setMenuIndex(0);
		}
		setMenu((current) =>
			current &&
			current.session === selected &&
			current.token.trigger === token.trigger &&
			current.token.query === token.query &&
			current.token.span.start === token.span.start &&
			current.token.span.end === token.span.end
				? current
				: { session: selected, token },
		);
	};

	const pick = (index: number): void => {
		const element = area.current;
		const item = items[index];
		if (!active || !contribution || !element || item === undefined) return;
		if (contribution.pick?.(host, item, selected) === true) {
			host.transcript.setDraft(selected, "");
			lastTrigger.current = null;
			setMenu(null);
			queueMicrotask(() => element.focus());
			return;
		}
		const insertion = contribution.insert(item);
		const value = element.value;
		const next = `${value.slice(0, active.span.start)}${insertion}${value.slice(active.span.end)}`;
		const caret = active.span.start + insertion.length;
		host.transcript.setDraft(selected, next);
		lastTrigger.current = null;
		setMenu(null);
		queueMicrotask(() => {
			element.focus();
			element.setSelectionRange(caret, caret);
			resize();
		});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (active) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				if (items.length > 0) {
					const delta = event.key === "ArrowDown" ? 1 : -1;
					setMenuIndex((index) => (index + delta + items.length) % items.length);
				}
				return;
			}
			if (event.key === "Tab" && !event.shiftKey && items.length > 0) {
				event.preventDefault();
				pick(menuSelected);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				lastTrigger.current = null;
				setMenu(null);
				return;
			}
			if (event.key === "Enter" && !event.shiftKey && !event.repeat && !event.nativeEvent.isComposing && !composing.current && items.length > 0) {
				event.preventDefault();
				pick(menuSelected);
				return;
			}
		}
		const native = event.nativeEvent;
		const claimed = host.composer.keydown(
			{ key: native.key, code: native.code, shift: native.shiftKey, meta: native.metaKey, ctrl: native.ctrlKey, alt: native.altKey, isComposing: native.isComposing },
			{ session: selected, text, composing: composing.current },
		);
		if (claimed) {
			event.preventDefault();
			return;
		}
		const send = event.key === "Enter" && !event.shiftKey && !event.repeat && !event.nativeEvent.isComposing && !composing.current;
		if (!send) return;
		event.preventDefault();
		void submit();
	};

	const showSend = text.trim() !== "" || busy;
	const hasActions = awaiting || layout.left.length > 0 || layout.right.length > 0 || showSend;
	const commandHint = (() => {
		if (active) return null;
		const parsed = parseCommandLine(text);
		if (!parsed) return null;
		const command = host.commands.find(parsed.name);
		return command?.kind === "leadingInput" && parsed.args.trim() === "" ? command : null;
	})();

	const TriggerMenu = contribution?.component;

	return (
		<form
			className="composer"
			id="composer"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			{TriggerMenu && active ? <TriggerMenu host={host} query={active.query} items={items} selectedIndex={menuSelected} onHover={setMenuIndex} onPick={pick} /> : null}
			{commandHint ? (
				<div className="composer-command-hint">
					<span className="composer-command-hint-name">/{commandHint.name}</span>
					{commandHint.hint ? <span className="composer-command-hint-args">{commandHint.hint}</span> : null}
				</div>
			) : null}
			<div className="composer-row">
				<div className={`composer-box${shownShell ? " shell" : ""}`}>
					<div className="composer-input-layer">
						<textarea
							id="prompt-input"
							ref={area}
							value={text}
							className="composer-input"
							rows={1}
							placeholder={shownShell ? "Run a shell command…" : "Type a message…"}
							autoComplete="off"
							spellCheck={false}
							aria-label="Message"
							onChange={(event) => {
								const value = event.currentTarget.value;
								host.transcript.setDraft(selected, value);
								resize();
								syncTrigger(value, event.currentTarget.selectionStart ?? value.length);
							}}
							onSelect={(event) => {
								syncTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
							}}
							onKeyDown={onKeyDown}
							onCompositionStart={() => {
								composing.current = true;
							}}
							onCompositionEnd={() => {
								window.setTimeout(() => {
									composing.current = false;
								}, 10);
							}}
						/>
					</div>

					{hasActions ? (
						<div className="composer-actions">
							{awaiting ? (
								<span className="composer-skeleton" aria-hidden="true">
									<span className="composer-skeleton-pill" />
									<span className="composer-skeleton-pill wide" />
								</span>
							) : (
								<ComposerActions host={host} items={layout.left} />
							)}
							<div className="composer-actions-right">
								{awaiting ? null : <ComposerActions host={host} items={layout.right} />}
								{showSend ? (
									<Tip label={stopping ? "Stopping" : busy ? "Stop" : "Send"}>
										<button
											type="button"
											className={`composer-send${busy ? " composer-stop" : ""}`}
											aria-label={stopping ? "Stopping" : busy ? "Stop" : "Send"}
											aria-busy={stopping || undefined}
											disabled={stopping}
											onClick={() => (busy ? void host.transcript.abort(selected) : void submit())}
										>
											{busy ? <SquareIcon size={12} /> : <ArrowUpIcon size={13} />}
										</button>
									</Tip>
								) : null}
							</div>
						</div>
					) : null}
				</div>

				{awaiting ? null : <ComposerTips tips={layout.tips} shellMode={shownShell} />}
			</div>
		</form>
	);
}
