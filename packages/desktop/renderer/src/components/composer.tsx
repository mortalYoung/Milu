import type { Host } from "@milu/extensions/host";
import type { ComposerWidget } from "@milu/protocol";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { useStore } from "zustand";

import { ArrowUpIcon, SquareIcon } from "./icons.tsx";

const MAX_HEIGHT = 120;

export function Composer(props: { host: Host }) {
	const { host } = props;
	const linked = useStore(host.connection.store, (state) => state.linked);
	const composerPending = useStore(host.connection.store, (state) => (state.pending["composer"] ?? 0) > 0);
	const { layout, shellMode } = useStore(host.composer.store);

	const selected = useStore(host.selection.store, (state) => state.selected);
	const text = useStore(host.transcript.store, (state) => state.drafts[selected] ?? "");
	const busy = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.running ?? false);

	const area = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);

	const resize = () => {
		const element = area.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
	};

	useEffect(() => {
		void host.composer.load(selected);
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
	}, [selected]);

	const submit = async (): Promise<void> => {
		const value = text.trim();
		if (!value || !selected) return;
		if (shellMode) {
			host.transcript.setDraft(selected, "");
			try {
				await host.actions.invoke("shell.run", selected, { command: value });
			} catch (error) {
				host.transcript.fail(selected, error instanceof Error ? error.message : String(error));
			}
			return;
		}
		if (!linked) return;
		await host.transcript.send(selected, value);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

	const renderWidget = (item: ComposerWidget) => {
		const Widget = host.widgets.get(item.widget);
		if (!Widget) return null;
		return <Widget key={item.id} host={host} data={item.data} />;
	};

	const tips = composerPending ? [] : layout.tips.filter((tip) => (tip.when ?? "chat") === (shellMode ? "shell" : "chat"));
	const showSend = text.trim() !== "" || busy;
	const hasActions = composerPending || layout.left.length > 0 || layout.right.length > 0 || showSend;

	return (
		<form
			className="composer"
			id="composer"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="composer-row">
				<div className={`composer-box${shellMode ? " shell" : ""}`}>
					<div className="composer-input-layer">
						<textarea
							id="prompt-input"
							ref={area}
							value={text}
							className="composer-input"
							rows={1}
							placeholder={shellMode ? "Run a shell command…" : "Type a message…"}
							autoComplete="off"
							spellCheck={false}
							aria-label="Message"
							onChange={(event) => {
								host.transcript.setDraft(selected, event.currentTarget.value);
								resize();
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
							{composerPending ? (
								<span className="composer-skeleton" aria-hidden="true">
									<span className="composer-skeleton-pill" />
									<span className="composer-skeleton-pill wide" />
								</span>
							) : (
								layout.left.map(renderWidget)
							)}
							<div className="composer-actions-right">
								{composerPending ? null : layout.right.map(renderWidget)}
								{showSend ? (
									<button
										type="button"
										className={`composer-send${busy ? " composer-stop" : ""}`}
										aria-label={busy ? "Stop" : "Send"}
										title={busy ? "Stop" : "Send"}
										onClick={() => (busy ? void host.transcript.abort() : void submit())}
									>
										{busy ? <SquareIcon size={12} /> : <ArrowUpIcon size={13} />}
									</button>
								) : null}
							</div>
						</div>
					) : null}
				</div>

				{tips.length > 0 ? (
					<div className="composer-tip">
						<div className="composer-tip-row">
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
				) : null}
			</div>
		</form>
	);
}

function Kbd(props: { children: string }) {
	return <kbd className="composer-kbd">{props.children}</kbd>;
}
