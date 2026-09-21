import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
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
	const open = useStore(palette.store, (state) => state.open);
	const mode = useStore(palette.store, (state) => state.mode);
	const query = useStore(palette.store, (state) => state.query);
	const index = useStore(palette.store, (state) => state.index);
	const focusSeq = useStore(palette.store, (state) => state.focusSeq);

	const [sessions, setSessions] = useState<PartnerItem[]>([]);
	const [fileQuery, setFileQuery] = useState("");
	const [fileResults, setFileResults] = useState<{ ok: boolean; error?: string; items: { path: string; name: string }[]; truncated: boolean } | null>(null);
	const [searching, setSearching] = useState(false);
	const [grants, setGrants] = useState<PaletteGrant[]>([]);
	const [grantError, setGrantError] = useState<string | null>(null);

	const panelEl = useRef<HTMLDivElement>(null);
	const inputEl = useRef<HTMLInputElement>(null);
	const searchSeq = useRef(0);
	const accessSeq = useRef(0);
	const imeRef = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!imeRef.current) imeRef.current = imeGuard(palette.setQuery);
	const ime = imeRef.current;

	const propsRef = useRef(props);
	propsRef.current = props;

	useEffect(() => {
		if (!open) return;
		setSessions(propsRef.current.partners);
	}, [open]);

	const filesAvailable = props.partner != null && props.hasWorkspace;
	const modeAvailable = (candidate: PaletteMode) => (candidate === "files" ? filesAvailable : candidate === "access" ? props.partner != null : true);
	const availableModes = MODES.map((m) => m.id).filter(modeAvailable);

	useEffect(() => {
		if (availableModes.includes(mode)) return;
		palette.setMode(availableModes[0]!);
	}, [availableModes.join(","), mode]);

	useEffect(() => {
		if (!open) {
			searchSeq.current += 1;
			setFileQuery("");
			setFileResults(null);
			setSearching(false);
			return;
		}
		if (mode !== "files") return;
		const next = parseFileQuery(query).path;
		const timer = setTimeout(() => setFileQuery(next), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [open, mode, query]);

	useEffect(() => {
		if (!open) return;
		const input = inputEl.current;
		if (input && !ime.composing && input.value !== query) input.value = query;
	}, [open, query, ime]);

	useEffect(() => {
		if (!open || mode !== "files" || !filesAvailable || fileQuery !== parseFileQuery(query).path) return;
		const seq = ++searchSeq.current;
		setSearching(true);
		void rpc.request.palette_search_files({ name: props.partner!, query: fileQuery }).then(
			(result) => {
				if (seq !== searchSeq.current) return;
				setFileResults(result);
				setSearching(false);
			},
			(error: Error) => {
				if (seq !== searchSeq.current) return;
				setFileResults({ ok: false, error: error instanceof Error ? error.message : String(error), items: [], truncated: false });
				setSearching(false);
			},
		);
	}, [open, mode, filesAvailable, fileQuery, query, props.partner]);

	useEffect(() => {
		if (!open || mode !== "access" || !props.partner) return;
		const seq = ++accessSeq.current;
		const partner = props.partner;
		void rpc.request.partner_access({ name: partner }).then(
			(result) => {
				if (seq !== accessSeq.current) return;
				setGrants(toGrants(result.skills, result.mcp));
				setGrantError(null);
			},
			(error: Error) => {
				if (seq !== accessSeq.current) return;
				setGrantError(error instanceof Error ? error.message : String(error));
			},
		);
	}, [open, mode, props.partner]);

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

	const rows = useMemo<PaletteRow[]>(() => {
		if (mode === "sessions") return sessionRows(sessions, query);
		if (mode === "access") return grantRows(grants, query);
		return fileResults?.ok ? fileRows(fileResults.items, query) : [];
	}, [mode, sessions, query, grants, fileResults]);
	const positions = useMemo(() => pickableIndexes(rows), [rows]);

	useEffect(() => {
		palette.setIndex(positions.length > 0 ? positions[0]! : -1);
	}, [mode, query]);

	useEffect(() => {
		if (positions.includes(index)) return;
		palette.setIndex(positions.length > 0 ? positions[0]! : -1);
	}, [positions]);

	useEffect(() => {
		if (index < 0) return;
		requestAnimationFrame(() => document.getElementById(`palette-option-${index}`)?.scrollIntoView({ block: "nearest" }));
	}, [index]);

	function move(delta: 1 | -1) {
		if (positions.length === 0) return;
		const at = positions.indexOf(index);
		const next = at === -1 ? (delta > 0 ? 0 : positions.length - 1) : (at + delta + positions.length) % positions.length;
		palette.setIndex(positions[next]!);
	}

	const activate = useCallback(
		(row: PaletteRow | undefined) => {
			if (!row || row.kind === "header") return;
			if (row.kind === "grant") {
				if (!row.grant.alwaysOn) void toggleGrant(row.grant);
				return;
			}
			palette.close();
			if (row.kind === "session") propsRef.current.onSelectPartner(row.partner.name);
			else propsRef.current.onRevealFile(row.file.path, parseFileQuery(palette.store.getState().query).range);
		},
		[palette],
	);

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing || ime.composing) return;
		if (event.key === "Tab") {
			event.preventDefault();
			palette.cycleMode(event.shiftKey ? -1 : 1, availableModes);
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			move(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			move(-1);
			return;
		}
		if (event.key !== "Enter") return;
		event.preventDefault();
		const row = rows[index];
		if (mode === "files" && (event.metaKey || event.ctrlKey) && row?.kind === "file") {
			palette.close();
			propsRef.current.onOpenFile(row.file.path);
			return;
		}
		activate(row);
	}

	useEffect(() => {
		if (!open) return;
		requestAnimationFrame(() => {
			inputEl.current?.focus();
			inputEl.current?.select();
		});
	}, [open, focusSeq]);

	useEffect(() => {
		if (!open) return;
		requestAnimationFrame(() => inputEl.current?.focus());
	}, [open, mode]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (panelEl.current?.contains(event.target as Node)) return;
			event.preventDefault();
			event.stopPropagation();
			palette.close();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [open, palette]);

	const emptyNote = (() => {
		if (mode === "sessions") return "no partner found";
		if (mode === "access") return props.partner == null ? "open a chat to grant" : "no skills or MCP servers";
		if (!filesAvailable) return "open a chat to search files";
		if (fileResults && !fileResults.ok) return `search failed${fileResults.error ? ` · ${fileResults.error}` : ""}`;
		if (searching) return "searching…";
		return "no file found";
	})();

	const range = mode === "files" ? parseFileQuery(query).range : null;
	const rangeNote = range ? (range.start === range.end ? `#${range.start}` : `#${range.start}-${range.end}`) : null;
	const statusNote = mode === "access" ? grantError : mode !== "files" || !filesAvailable || searching ? null : fileResults?.truncated ? "first 50 · keep typing to narrow" : null;
	const keyNote = mode === "access" ? "tab switch · ↑↓ navigate · ↵ toggle · esc" : `tab switch · ↑↓ navigate · ↵ open${mode === "files" ? " · ⌘↵ editor" : ""} · esc`;

	if (!open) return null;

	return (
		<div className="palette-anchor">
			<div className="palette" ref={panelEl} role="dialog" aria-modal="false" aria-label="Command palette">
				<div className="palette-head">
					<div className="palette-chips" role="group" aria-label="Mode">
						{MODES.map((candidate) => (
							<button
								type="button"
								key={candidate.id}
								className={"palette-chip" + (mode === candidate.id ? " on" : "")}
								disabled={!modeAvailable(candidate.id)}
								aria-pressed={mode === candidate.id}
								onClick={() => palette.setMode(candidate.id)}
							>
								{candidate.label}
							</button>
						))}
					</div>
					<span className="palette-key">{mode === "access" ? "⌘⇧P" : "⌘P"}</span>
				</div>
				<div className="palette-input-row">
					<span className="palette-caret" aria-hidden="true">
						›
					</span>
					<input
						id="palette-input"
						ref={inputEl}
						className="palette-input"
						placeholder="search…"
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						role="combobox"
						aria-expanded="true"
						aria-controls="palette-list"
						aria-autocomplete="list"
						aria-label="Search"
						aria-activedescendant={index >= 0 ? `palette-option-${index}` : undefined}
						onChange={(event) => palette.setQuery(event.currentTarget.value)}
						onKeyDown={(event) => {
							ime.onKeyDown(event.nativeEvent);
							onKeyDown(event);
						}}
						onCompositionStart={ime.onStart}
						onCompositionEnd={(event) => ime.onEnd(event.nativeEvent, event.currentTarget)}
					/>
				</div>
				{rows.length > 0 ? (
					<PaletteList rows={rows} index={index} unread={props.unread} onPick={activate} onHover={palette.setIndex} />
				) : (
					<div className="palette-note">{emptyNote}</div>
				)}
				<div className="palette-foot">
					{rangeNote && <span className="palette-range">{rangeNote}</span>}
					<span className="palette-status" aria-live="polite">
						{statusNote}
					</span>
					<span className="palette-keys">{keyNote}</span>
				</div>
			</div>
		</div>
	);
}

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
