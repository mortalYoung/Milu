import { type ComposerTip, type ComposerWidget, type ImageMediaType, SLOT_POINTS, type SlotItem } from "@milu/protocol";
import { detectComposerTrigger, type ComposerTriggerToken, type Host, Kbd, type PendingImageInput } from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, memo, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { mark } from "../boot.ts";
import { ArrowUpIcon, SquareIcon } from "./icons.tsx";

const MAX_HEIGHT = 120;
const NO_ITEMS: readonly unknown[] = [];
const NO_SLOT_ITEMS: readonly SlotItem[] = [];
const COMMAND_LINE = /^\/([a-z][a-z0-9_:-]*)(?:\s+(.*))?$/s;
const NO_IMAGES: readonly { readonly id: string; readonly url: string; readonly name: string }[] = [];

const IMAGE_TYPES: Readonly<Record<string, ImageMediaType>> = {
	"image/png": "image/png",
	"image/jpeg": "image/jpeg",
	"image/webp": "image/webp",
	"image/gif": "image/gif",
};

function imageTypeOf(value: string): ImageMediaType | undefined {
	return IMAGE_TYPES[value];
}

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
	const compacting = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.compacting ?? false);
	const stopping = useStore(host.transcript.store, (state) => state.stopping[selected] === true);
	const external = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.origin != null);
	const above = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.composerAbove] ?? NO_SLOT_ITEMS);
	const slotComponents = useStore(host.slots.store, (state) => state.components);

	const area = useRef<HTMLTextAreaElement>(null);
	const files = useRef<HTMLInputElement>(null);
	const pending = useStore(host.transcript.store, (state) => state.images[selected] ?? NO_IMAGES);
	const pendingCount = pending.length;

	const accept = async (incoming: readonly File[]): Promise<void> => {
		if (external) return;
		if (selected === "") return;
		const images: PendingImageInput[] = [];
		for (const file of incoming) {
			const mediaType = imageTypeOf(file.type);
			if (mediaType === undefined) continue;
			images.push({ mediaType, data: new Uint8Array(await file.arrayBuffer()), ...(file.name === "" ? {} : { name: file.name }) });
		}
		if (images.length > 0) host.transcript.addImages(selected, images);
	};

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
		if (external) return;
		const pasted = [...event.clipboardData.items]
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null && imageTypeOf(file.type) !== undefined);
		if (pasted.length === 0) return;
		event.preventDefault();
		void accept(pasted);
	};

	const onDrop = (event: DragEvent<HTMLFormElement>): void => {
		if (external) return;
		const dropped = [...event.dataTransfer.files].filter((file) => imageTypeOf(file.type) !== undefined);
		if (dropped.length === 0) return;
		event.preventDefault();
		void accept(dropped);
	};

	const onDragOver = (event: DragEvent<HTMLFormElement>): void => {
		if (event.dataTransfer.types.includes("Files")) event.preventDefault();
	};

	const onPickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
		const picked = event.currentTarget.files === null ? [] : [...event.currentTarget.files];
		event.currentTarget.value = "";
		void accept(picked);
	};

	/** Treat the whole box as the input: clicks on chrome focus the caret at the end. */
	const onBoxMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
		if (event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']") !== null) return;
		event.preventDefault();
		const element = area.current;
		if (element === null) return;
		const focused = document.activeElement === element;
		element.focus();
		if (!focused) element.setSelectionRange(element.value.length, element.value.length);
	};
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
		void host.slots.load(SLOT_POINTS.composerAbove, selected || undefined);
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
		if (compacting) return;
		const value = text.trim();
		if (!selected || (value === "" && pendingCount === 0)) return;
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

	const idle = text.trim() === "" && pendingCount === 0 && !busy;
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
			onDrop={onDrop}
			onDragOver={onDragOver}
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
				{above.map((item) => {
					const Slot = slotComponents.get(item.component);
					return Slot ? <Slot key={item.id} host={host} data={item.data} /> : null;
				})}
				<div className={`composer-box${shownShell ? " shell" : ""}`} onMouseDown={onBoxMouseDown}>
					{pending.length === 0 ? null : (
						<div className="composer-images">
							{pending.map((image) => (
								<div className="composer-image" key={image.id}>
									<button
										type="button"
										className="composer-image-open"
										aria-label={`Preview ${image.name === "" ? "image" : image.name}`}
										onClick={() => {
											const label = image.name === "" ? "image" : image.name;
											void host.actions.invoke("image.preview", selected, { src: image.url, alt: label }).catch(() => undefined);
										}}
									>
										<img src={image.url} alt={image.name === "" ? "image" : image.name} draggable={false} />
									</button>
									<button type="button" className="composer-image-remove" aria-label="Remove image" onClick={() => host.transcript.removeImage(selected, image.id)}>
										×
									</button>
								</div>
							))}
						</div>
					)}
					<div className="composer-input-layer">
						<textarea
							id="prompt-input"
							ref={area}
							value={text}
							className="composer-input"
							rows={1}
							disabled={external}
							placeholder={
								external ? "This chat is driven by another client — read only" : shownShell ? "Run a shell command…" : `Message${selected === "" ? "" : ` @${selected}`}`
							}
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
							onPaste={onPaste}
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

					<fieldset className="composer-actions-field" disabled={external}>
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
								<input ref={files} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="composer-file-input" onChange={onPickFiles} />
								{awaiting ? null : (
									<Tip label="Attach image">
										<button type="button" className="composer-attach" aria-label="Attach image" disabled={external} onClick={() => files.current?.click()}>
											+
										</button>
									</Tip>
								)}
								{awaiting ? null : <ComposerActions host={host} items={layout.right} />}
								{awaiting ? null : (
									<Tip label={stopping ? "Stopping" : compacting ? "Compacting" : busy ? "Stop" : "Send"}>
										<button
											type="button"
											className={`composer-send${busy ? " composer-stop" : ""}${idle ? " is-idle" : ""}`}
											aria-label={stopping ? "Stopping" : compacting ? "Compacting" : busy ? "Stop" : "Send"}
											aria-busy={stopping || compacting || undefined}
											disabled={stopping || compacting || idle || external}
											onClick={() => (busy ? void host.transcript.abort(selected) : void submit())}
										>
											{busy ? <SquareIcon size={14} /> : <ArrowUpIcon size={14} />}
										</button>
									</Tip>
								)}
							</div>
						</div>
					</fieldset>
				</div>

				{awaiting ? null : <ComposerTips tips={layout.tips} shellMode={shownShell} />}
			</div>
		</form>
	);
}
