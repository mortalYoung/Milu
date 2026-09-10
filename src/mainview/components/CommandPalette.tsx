import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useCommandDirectory } from "../lib/contexts/commands-context";
import { useComposer } from "../lib/contexts/composer-context";
import type { RevealRange } from "../lib/dock";
import { commandRows, fileRows, type Palette, type PaletteMode, type PaletteRow, parseFileQuery, pickableIndexes, sessionRows } from "../lib/palette";
import { rpc } from "../lib/rpc";
import type { PartnerItem } from "./ConversationList";
import { PaletteList } from "./PaletteList";

const MODES: { id: PaletteMode; label: string }[] = [
	{ id: "sessions", label: "Sessions" },
	{ id: "files", label: "Files" },
	{ id: "commands", label: "Commands" },
];
const SEARCH_DEBOUNCE_MS = 150;

export function CommandPalette(props: {
	palette: Palette;
	partner: string | null;
	partners: PartnerItem[];
	hasWorkspace: boolean;
	unread: (name: string) => boolean;
	onSelectPartner: (name: string) => void;
	onRevealFile: (path: string, range: RevealRange | null) => void;
	onOpenFile: (path: string) => void;
}) {
	const palette = props.palette;
	const commands = useCommandDirectory();
	const composer = useComposer();
	const [fileQuery, setFileQuery] = createSignal("");
	const [composing, setComposing] = createSignal(false);
	let panelEl: HTMLDivElement | undefined;
	let inputEl: HTMLInputElement | undefined;

	const filesAvailable = () => props.partner != null && props.hasWorkspace;
	// Commands fill the composer, so they need a chat to fill (same rule as Files needing a workspace).
	const modeAvailable = (mode: PaletteMode) => (mode === "files" ? filesAvailable() : mode === "commands" ? props.partner != null : true);
	const availableModes = createMemo(() => MODES.map((m) => m.id).filter(modeAvailable));

	// A mode can disappear while the palette is open (chat closed): fall back to what is still available.
	createEffect(() => {
		const list = availableModes();
		if (list.includes(palette.mode())) return;
		palette.setMode(list[0]);
	});

	// The debounced query only settles into `fileQuery`, so a fetch never races the keystrokes.
	createEffect(() => {
		if (!palette.open()) {
			searchSeq += 1;
			setFileQuery("");
			setFileResults(null);
			setSearching(false);
			return;
		}
		const q = parseFileQuery(palette.query()).path;
		if (palette.mode() !== "files") return;
		const timer = setTimeout(() => setFileQuery(q), SEARCH_DEBOUNCE_MS);
		onCleanup(() => clearTimeout(timer));
	});

	const [fileResults, setFileResults] = createSignal<{ ok: boolean; error?: string; items: { path: string; name: string }[]; truncated: boolean } | null>(null);
	const [searching, setSearching] = createSignal(false);
	let searchSeq = 0;

	// A plain request + seq, deliberately **not** createResource: any resource load inside the
	// palette's Suspense boundary makes Solid swap to the fallback, which unmounts the whole panel
	// (entrance animation replays, input loses focus).
	createEffect(() => {
		if (!palette.open() || palette.mode() !== "files" || !filesAvailable() || fileQuery() !== parseFileQuery(palette.query()).path) return;
		const seq = ++searchSeq;
		const query = fileQuery();
		setSearching(true);
		void rpc.request.palette_search_files({ name: props.partner!, query }).then(
			(result) => {
				if (seq !== searchSeq) return;
				setFileResults(result);
				setSearching(false);
			},
			(error) => {
				if (seq !== searchSeq) return;
				setFileResults({ ok: false, error: error instanceof Error ? error.message : String(error), items: [], truncated: false });
				setSearching(false);
			},
		);
	});

	const rows = createMemo<PaletteRow[]>(() => {
		if (palette.mode() === "sessions") return sessionRows(props.partners, palette.query());
		if (palette.mode() === "commands") return commandRows(commands.commands(), palette.query());
		const result = fileResults();
		return result?.ok ? fileRows(result.items, palette.query()) : [];
	});
	const positions = createMemo(() => pickableIndexes(rows()));

	// Mode and query changes land on the first pickable row; the row set growing (partners refreshed,
	// file results arriving) must not yank a selection the user is already navigating.
	createEffect(() => {
		void palette.mode();
		void palette.query();
		const list = positions();
		palette.setIndex(list.length > 0 ? list[0] : -1);
	});
	createEffect(() => {
		const list = positions();
		if (list.includes(palette.index())) return;
		palette.setIndex(list.length > 0 ? list[0] : -1);
	});
	createEffect(() => {
		const index = palette.index();
		if (index < 0) return;
		requestAnimationFrame(() => document.getElementById(`palette-option-${index}`)?.scrollIntoView({ block: "nearest" }));
	});

	function move(delta: 1 | -1) {
		const list = positions();
		if (list.length === 0) return;
		const at = list.indexOf(palette.index());
		const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
		palette.setIndex(list[next]);
	}

	function activate(row: PaletteRow | undefined) {
		if (!row || row.kind === "header") return;
		palette.close();
		if (row.kind === "session") props.onSelectPartner(row.partner.name);
		else if (row.kind === "file") props.onRevealFile(row.file.path, parseFileQuery(palette.query()).range);
		else composer.prefill(`/${row.command.name} `);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.isComposing || composing()) return;
		if (e.key === "Tab") {
			e.preventDefault();
			palette.cycleMode(e.shiftKey ? -1 : 1, availableModes());
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			move(1);
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			move(-1);
			return;
		}
		if (e.key !== "Enter") return;
		e.preventDefault();
		const row = rows()[palette.index()];
		if (palette.mode() === "files" && (e.metaKey || e.ctrlKey) && row?.kind === "file") {
			palette.close();
			props.onOpenFile(row.file.path);
			return;
		}
		activate(row);
	}

	createEffect(() => {
		void palette.focusSeq();
		if (!palette.open()) return;
		requestAnimationFrame(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	});

	// Tab is a keyboard gesture: switching modes must leave the caret in the field (and survive any
	// remount), without re-selecting the preserved query.
	createEffect(() => {
		void palette.mode();
		if (!palette.open()) return;
		requestAnimationFrame(() => inputEl?.focus());
	});

	// Esc is the palette's own key: consume it here (capture) so drawers / dialogs below stay open.
	// The click that dismisses the palette is consumed too — it must not also act on what's behind.
	createEffect(() => {
		if (!palette.open()) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			palette.close();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (panelEl?.contains(e.target as Node)) return;
			e.preventDefault();
			e.stopPropagation();
			palette.close();
		};
		window.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		onCleanup(() => {
			window.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onPointerDown, true);
		});
	});

	const emptyNote = () => {
		if (palette.mode() === "sessions") return "no partner found";
		if (palette.mode() === "commands") return props.partner == null ? "open a chat to run commands" : "no command found";
		if (!filesAvailable()) return "open a chat to search files";
		const result = fileResults();
		if (result && !result.ok) return `search failed${result.error ? ` · ${result.error}` : ""}`;
		if (searching()) return "searching…";
		return "no file found";
	};

	/** `#16` / `#74-80` when the query carries a line reference — one always-accurate badge, applied on activate. */
	const rangeNote = () => {
		if (palette.mode() !== "files") return null;
		const range = parseFileQuery(palette.query()).range;
		if (!range) return null;
		return range.start === range.end ? `#${range.start}` : `#${range.start}-${range.end}`;
	};

	const statusNote = () => {
		if (palette.mode() !== "files" || !filesAvailable() || searching()) return null;
		return fileResults()?.truncated ? "first 50 · keep typing to narrow" : null;
	};

	return (
		<Show when={palette.open()}>
			<div class="palette-anchor">
				<div class="palette" ref={panelEl} role="dialog" aria-modal="false" aria-label="Command palette">
					<div class="palette-head">
						<div class="palette-chips" role="group" aria-label="Mode">
							<For each={MODES}>
								{(mode) => (
									<button
										type="button"
										class="palette-chip"
										classList={{ on: palette.mode() === mode.id }}
										disabled={!modeAvailable(mode.id)}
										aria-pressed={palette.mode() === mode.id}
										onClick={() => palette.setMode(mode.id)}
									>
										{mode.label}
									</button>
								)}
							</For>
						</div>
						<span class="palette-key">⌘P</span>
					</div>
					<div class="palette-input-row">
						<span class="palette-caret" aria-hidden="true">
							›
						</span>
						<input
							id="palette-input"
							ref={inputEl}
							class="palette-input"
							value={palette.query()}
							placeholder="search…"
							autocomplete="off"
							autocapitalize="off"
							spellcheck={false}
							role="combobox"
							aria-expanded="true"
							aria-controls="palette-list"
							aria-autocomplete="list"
							aria-label="Search"
							aria-activedescendant={palette.index() >= 0 ? `palette-option-${palette.index()}` : undefined}
							onInput={(e) => palette.setQuery(e.currentTarget.value)}
							onKeyDown={onKeyDown}
							onCompositionStart={() => setComposing(true)}
							onCompositionEnd={() => setComposing(false)}
						/>
					</div>
					<Show when={rows().length > 0} fallback={<div class="palette-note">{emptyNote()}</div>}>
						<PaletteList rows={rows()} index={palette.index()} unread={props.unread} onPick={activate} onHover={palette.setIndex} />
					</Show>
					<div class="palette-foot">
						<Show when={rangeNote()}>
							<span class="palette-range">{rangeNote()}</span>
						</Show>
						<span class="palette-status" aria-live="polite">
							{statusNote()}
						</span>
						<span class="palette-keys">tab switch · ↑↓ navigate · ↵ open{palette.mode() === "files" ? " · ⌘↵ editor" : ""} · esc</span>
					</div>
				</div>
			</div>
		</Show>
	);
}
