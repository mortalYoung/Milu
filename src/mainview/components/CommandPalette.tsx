import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { PartnerAccessServer, PartnerAccessSkill } from "../../shared/rpc";
import type { RevealRange } from "../lib/dock";
import { imeGuard } from "../lib/ime";
import { fileRows, grantRows, type Palette, type PaletteGrant, type PaletteMode, type PaletteRow, parseFileQuery, pickableIndexes, sessionRows } from "../lib/palette";
import { rpc } from "../lib/rpc";
import type { PartnerItem } from "./ConversationList";
import { PaletteList } from "./PaletteList";

const MODES: { id: PaletteMode; label: string }[] = [
	{ id: "sessions", label: "Sessions" },
	{ id: "files", label: "Files" },
	{ id: "access", label: "Access" },
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
	const [fileQuery, setFileQuery] = createSignal("");
	const ime = imeGuard(palette.setQuery);
	let panelEl: HTMLDivElement | undefined;
	let inputEl: HTMLInputElement | undefined;

	const filesAvailable = () => props.partner != null && props.hasWorkspace;
	const modeAvailable = (mode: PaletteMode) => (mode === "files" ? filesAvailable() : mode === "access" ? props.partner != null : true);
	const availableModes = createMemo(() => MODES.map((m) => m.id).filter(modeAvailable));

	createEffect(() => {
		const list = availableModes();
		if (list.includes(palette.mode())) return;
		palette.setMode(list[0]);
	});

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

	// The query drives the list, but the input must stay uncontrolled while an IME is composing:
	// writing `value` during composition cancels the preedit in WebKit.
	createEffect(() => {
		if (!palette.open()) return;
		const query = palette.query();
		const input = inputEl;
		if (input && !ime.composing && input.value !== query) input.value = query;
	});

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

	const [grants, setGrants] = createSignal<PaletteGrant[]>([]);
	const [grantError, setGrantError] = createSignal<string | null>(null);
	let accessSeq = 0;

	function toGrants(skills: PartnerAccessSkill[], servers: PartnerAccessServer[]): PaletteGrant[] {
		const skillRows: PaletteGrant[] = skills.map((skill) => ({
			group: "skill" as const,
			name: skill.name,
			detail: skill.description,
			...(skill.scope === "project" ? { meta: "project" } : {}),
			granted: skill.granted,
			alwaysOn: skill.scope === "project",
		}));
		const serverRows: PaletteGrant[] = servers.map((server) => ({
			group: "mcp" as const,
			name: server.name,
			detail: server.state === "error" ? "error" : "",
			...(server.toolCount > 0 ? { meta: `${server.toolCount} tools` } : {}),
			granted: server.granted,
			alwaysOn: false,
		}));
		return [...skillRows, ...serverRows];
	}

	createEffect(() => {
		if (!palette.open() || palette.mode() !== "access") return;
		const partner = props.partner;
		if (!partner) return;
		const seq = ++accessSeq;
		void rpc.request.partner_access({ name: partner }).then(
			(result) => {
				if (seq !== accessSeq) return;
				setGrants(toGrants(result.skills, result.mcp));
				setGrantError(null);
			},
			(error) => {
				if (seq !== accessSeq) return;
				setGrantError(error instanceof Error ? error.message : String(error));
			},
		);
	});

	async function toggleGrant(grant: PaletteGrant) {
		const next = !grant.granted;
		const flip = (granted: boolean) => setGrants((list) => list.map((item) => (item === grant ? { ...item, granted } : item)));
		flip(next);
		setGrantError(null);
		const partner = props.partner;
		if (!partner) return;
		try {
			const result =
				grant.group === "skill"
					? await rpc.request.partner_set_skill({ name: partner, skill: grant.name, granted: next })
					: await rpc.request.partner_set_mcp({ name: partner, server: grant.name, granted: next });
			if (!result.ok) throw new Error(result.error ?? "grant failed");
		} catch (error) {
			flip(grant.granted);
			setGrantError(error instanceof Error ? error.message : String(error));
		}
	}

	const rows = createMemo<PaletteRow[]>(() => {
		if (palette.mode() === "sessions") return sessionRows(props.partners, palette.query());
		if (palette.mode() === "access") return grantRows(grants(), palette.query());
		const result = fileResults();
		return result?.ok ? fileRows(result.items, palette.query()) : [];
	});
	const positions = createMemo(() => pickableIndexes(rows()));

	createEffect(() => {
		void palette.mode();
		void palette.query();
		const list = untrack(positions);
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
		if (row.kind === "grant") {
			if (!row.grant.alwaysOn) void toggleGrant(row.grant);
			return;
		}
		palette.close();
		if (row.kind === "session") props.onSelectPartner(row.partner.name);
		else props.onRevealFile(row.file.path, parseFileQuery(palette.query()).range);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.isComposing || ime.composing) return;
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

	createEffect(() => {
		void palette.mode();
		if (!palette.open()) return;
		requestAnimationFrame(() => inputEl?.focus());
	});

	createEffect(() => {
		if (!palette.open()) return;
		const onPointerDown = (e: PointerEvent) => {
			if (panelEl?.contains(e.target as Node)) return;
			e.preventDefault();
			e.stopPropagation();
			palette.close();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		onCleanup(() => {
			document.removeEventListener("pointerdown", onPointerDown, true);
		});
	});

	const emptyNote = () => {
		if (palette.mode() === "sessions") return "no partner found";
		if (palette.mode() === "access") return props.partner == null ? "open a chat to grant" : "no skills or MCP servers";
		if (!filesAvailable()) return "open a chat to search files";
		const result = fileResults();
		if (result && !result.ok) return `search failed${result.error ? ` · ${result.error}` : ""}`;
		if (searching()) return "searching…";
		return "no file found";
	};

	const rangeNote = () => {
		if (palette.mode() !== "files") return null;
		const range = parseFileQuery(palette.query()).range;
		if (!range) return null;
		return range.start === range.end ? `#${range.start}` : `#${range.start}-${range.end}`;
	};

	const statusNote = () => {
		if (palette.mode() === "access") return grantError();
		if (palette.mode() !== "files" || !filesAvailable() || searching()) return null;
		return fileResults()?.truncated ? "first 50 · keep typing to narrow" : null;
	};

	const keyNote = () => {
		if (palette.mode() === "access") return "tab switch · ↑↓ navigate · ↵ toggle · esc";
		return `tab switch · ↑↓ navigate · ↵ open${palette.mode() === "files" ? " · ⌘↵ editor" : ""} · esc`;
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
						<span class="palette-key">{palette.mode() === "access" ? "⌘⇧P" : "⌘P"}</span>
					</div>
					<div class="palette-input-row">
						<span class="palette-caret" aria-hidden="true">
							›
						</span>
						<input
							id="palette-input"
							ref={inputEl}
							class="palette-input"
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
							onKeyDown={(e) => {
								ime.onKeyDown(e);
								onKeyDown(e);
							}}
							onCompositionStart={ime.onStart}
							onCompositionEnd={(e) => ime.onEnd(e, e.currentTarget)}
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
						<span class="palette-keys">{keyNote()}</span>
					</div>
				</div>
			</div>
		</Show>
	);
}
