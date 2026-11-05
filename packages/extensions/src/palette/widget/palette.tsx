import type { SessionRow } from "@milu/protocol";
import { activityAt, type DialogProps, Kbd, KbdGroup, filterSessions, fuzzyScore, listTime, previewFor, Tip } from "@milu/window/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import type { PaletteFile, PaletteFiles } from "../search.ts";
import { fileGlyph } from "./file-glyph.tsx";

const MODES = [
	{ id: "sessions", label: "Sessions" },
	{ id: "files", label: "Files" },
	{ id: "access", label: "Access" },
] as const;

type Mode = (typeof MODES)[number]["id"];

interface GrantRow {
	readonly group: "skills" | "mcp";
	readonly name: string;
	readonly detail?: string;
	readonly meta?: string;
	readonly granted: boolean;
	readonly alwaysOn: boolean;
}

type Row = { readonly kind: "session"; readonly row: SessionRow } | { readonly kind: "file"; readonly file: PaletteFile } | { readonly kind: "grant"; readonly grant: GrantRow };

const GRANT = "shrink-0 font-mono text-[10px] text-muted-soft";

const DEBOUNCE_MS = 150;

const CHIPS = "flex items-center gap-0.5 rounded-[4px] border border-line p-[1px]";
const CHIP = "cursor-pointer rounded-[4px] border-0 px-1.5 py-[1px] font-mono text-[10px] tracking-[0.12em] uppercase transition-colors duration-100";
const ROW = "flex w-full cursor-pointer items-center gap-2 border-0 px-4 py-1.5 text-left";
const NOTE = "px-4 py-6 text-center font-mono text-[12px] text-muted";
const STATUS = "min-w-0 truncate font-mono text-[10px] text-muted";
const KEYS = "ml-auto flex items-center gap-3 font-sans text-[10px] whitespace-nowrap text-muted";
const KEY_ITEM = "inline-flex items-center gap-[5px]";

function parseFileQuery(query: string): { path: string; range?: { start: number; end: number } } {
	const trimmed = query.trim();
	const at = trimmed.indexOf("#");
	if (at !== -1) {
		const tail = /^(\d+)(?:-(\d+))?$/.exec(trimmed.slice(at + 1).trim());
		if (!tail) return { path: trimmed };
		const start = Number(tail[1]);
		return { path: trimmed.slice(0, at).trim(), range: { start, end: tail[2] ? Number(tail[2]) : start } };
	}
	const colon = /^(.*?):(\d+)(?::(\d+))?(?:-(\d+))?$/.exec(trimmed);
	if (colon) {
		const start = Number(colon[2]);
		return { path: (colon[1] ?? "").trim(), range: { start, end: colon[4] ? Number(colon[4]) : start } };
	}
	return { path: trimmed };
}

function splitPath(path: string): { dir: string; name: string } {
	const at = path.lastIndexOf("/");
	return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

export function PaletteDialog(props: DialogProps) {
	const { host } = props;
	const sessions = useStore(host.sessions.store, (state) => state.rows);
	const selected = useStore(host.selection.store, (state) => state.selected);

	const [mode, setMode] = useState<Mode>(() => (props.data as { mode?: Mode } | undefined)?.mode ?? "sessions");
	const [grants, setGrants] = useState<readonly GrantRow[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState({ stamp: "", at: 0 });
	const [files, setFiles] = useState<{ query: string; result: PaletteFiles } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const seq = useRef(0);

	const current = sessions.find((row) => row.name === selected);
	const filesAvailable = selected !== "" && current?.workspace !== undefined && current?.workspace !== null;
	const accessAvailable = selected !== "";
	const activeMode: Mode = mode === "files" && !filesAvailable ? "sessions" : mode === "access" && !accessAvailable ? "sessions" : mode;

	const panel = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (panel.current?.contains(event.target as Node)) return;
			props.close(undefined);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [props]);

	const parsed = parseFileQuery(query);
	const needle = activeMode === "files" ? parsed.path : query;
	const searching = activeMode === "files" && files?.query !== parsed.path;

	useEffect(() => {
		if (activeMode !== "files" || !filesAvailable) return;
		const id = ++seq.current;
		const timer = setTimeout(() => {
			void host.actions
				.request<PaletteFiles>("palette.files", selected, { query: parsed.path })
				.then((next) => {
					if (id !== seq.current || !next) return;
					setFiles({ query: parsed.path, result: next });
				})
				.catch((failure: unknown) => {
					if (id !== seq.current) return;
					setFiles({ query: parsed.path, result: { items: [], truncated: false } });
					setError(failure instanceof Error ? failure.message : String(failure));
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [host, activeMode, filesAvailable, selected, parsed.path]);

	const loadAccess = useCallback(() => {
		const nothing = Promise.resolve(undefined);
		void Promise.all([
			selected === "" ? nothing : host.actions.request<{ rows: readonly GrantRow[] }>("skills.access", selected),
			selected === "" ? nothing : host.actions.request<{ rows: readonly GrantRow[] }>("mcp.access", selected),
		])
			.then(([skills, servers]) => {
				setGrants([...(skills?.rows ?? []), ...(servers?.rows ?? [])]);
				setLoaded(true);
			})
			.catch((failure: unknown) => {
				console.error("access list failed:", failure);
				setLoaded(true);
				setError(failure instanceof Error ? failure.message : String(failure));
			});
	}, [host, selected]);

	useEffect(() => {
		if (activeMode === "access") loadAccess();
	}, [activeMode, loadAccess]);

	useEffect(() => {
		input.current?.focus();
	}, [activeMode]);

	const grant = (row: GrantRow): void => {
		if (row.alwaysOn || selected === "") return;
		const action = row.group === "skills" ? "skills.grant" : "mcp.grant";
		void host.actions.invoke(action, undefined, { name: row.name, partner: selected, granted: !row.granted }).then(loadAccess);
	};

	const rows = useMemo<readonly Row[]>(() => {
		if (activeMode === "access") {
			const needle = query.trim().toLowerCase();
			return grants.filter((grant) => needle === "" || `${grant.name} ${grant.detail ?? ""}`.toLowerCase().includes(needle)).map((grant) => ({ kind: "grant" as const, grant }));
		}
		if (activeMode === "sessions") return filterSessions(sessions, query).map((row) => ({ kind: "session" as const, row }));
		const items = files?.query === parsed.path ? files.result.items : [];
		const ranked = items
			.map((file) => ({ file, score: fuzzyScore(needle, file.path) }))
			.filter((hit): hit is { file: PaletteFile; score: number } => hit.score !== null)
			.sort((left, right) => right.score - left.score || left.file.path.length - right.file.path.length || left.file.path.localeCompare(right.file.path));
		return ranked.map(({ file }) => ({ kind: "file" as const, file }));
	}, [activeMode, sessions, grants, query, files, needle, parsed.path]);

	const stamp = `${activeMode}\u0000${query}`;
	const index = cursor.stamp === stamp ? Math.min(cursor.at, Math.max(0, rows.length - 1)) : 0;

	const activate = (row: Row | undefined): void => {
		if (!row) return;
		if (row.kind === "grant") {
			grant(row.grant);
			return;
		}
		if (row.kind === "session") {
			props.close(undefined);
			void host.selection.select(row.row.name);
			return;
		}
		props.close(undefined);
		void host.actions
			.invoke("palette.openFile", selected, { path: row.file.path, ...(parsed.range === undefined ? {} : { line: parsed.range.start }) })
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	};

	const move = (delta: 1 | -1): void => {
		if (rows.length === 0) return;
		setCursor({ stamp, at: (index + delta + rows.length) % rows.length });
	};

	const cycle = (): void => {
		const available = MODES.filter((candidate) => (candidate.id !== "files" || filesAvailable) && (candidate.id !== "access" || accessAvailable));
		const at = available.findIndex((candidate) => candidate.id === activeMode);
		setMode(available[(at + 1) % available.length]?.id ?? "sessions");
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Tab") {
			event.preventDefault();
			cycle();
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
		if (event.key === "Enter") {
			event.preventDefault();
			activate(rows[index]);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			props.close(undefined);
		}
	};

	const empty = (() => {
		if (activeMode === "access") return loaded ? "no skills or mcp servers" : "loading…";
		if (activeMode === "sessions") return "no chat found";
		if (!filesAvailable) return "open a chat with a workspace to search files";
		if (searching) return "searching…";
		return "no file found";
	})();
	const status = error ?? (searching ? null : files?.result.truncated === true ? "first 50 · keep typing to narrow" : null);
	const range = activeMode === "files" ? parsed.range : undefined;

	return (
		<div
			ref={panel}
			className="flex w-[640px] max-w-full flex-col overflow-hidden rounded-[6px] border border-line bg-surface"
			style={{ boxShadow: "0 4px 12px color-mix(in srgb, var(--ink) 12%, transparent)" }}
		>
			<div className="flex items-center gap-2 border-b border-line px-3 py-2">
				<div className={CHIPS} role="group" aria-label="Mode">
					{MODES.map((candidate) => {
						const available = candidate.id === "files" ? filesAvailable : candidate.id === "access" ? accessAvailable : true;
						return (
							<button
								key={candidate.id}
								type="button"
								className={`${CHIP} ${activeMode === candidate.id ? "bg-ink text-canvas" : "bg-transparent text-muted hover:bg-hover"}${available ? "" : " cursor-default opacity-50"}`}
								disabled={!available}
								aria-pressed={activeMode === candidate.id}
								onClick={() => setMode(candidate.id)}
							>
								{candidate.label}
							</button>
						);
					})}
				</div>
				<KbdGroup className="ml-auto">
					{activeMode === "access" ? (
						<>
							<Kbd>⌘</Kbd>
							<Kbd>⇧</Kbd>
							<Kbd>P</Kbd>
						</>
					) : (
						<>
							<Kbd>⌘</Kbd>
							<Kbd>P</Kbd>
						</>
					)}
				</KbdGroup>
			</div>

			<div className="flex items-center gap-2 border-b border-line px-4">
				<span aria-hidden="true" className="font-mono text-[14px] text-muted-soft">
					›
				</span>
				<input
					ref={input}
					autoFocus
					className="min-w-0 flex-1 border-0 bg-transparent py-2.5 font-sans text-[14px] text-ink caret-ink outline-none placeholder:text-muted"
					placeholder="search…"
					aria-label="Search"
					spellCheck={false}
					autoComplete="off"
					value={query}
					onChange={(event) => {
						setQuery(event.currentTarget.value);
						setError(null);
					}}
					onKeyDown={onKeyDown}
				/>
			</div>

			{rows.length === 0 ? (
				<div className={`${NOTE}${error ? " text-signal" : ""}`}>{error ?? empty}</div>
			) : (
				<div className="max-h-[48vh] min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Results">
					{rows.map((row, at) => {
						const picked = at === index;
						const className = `${ROW}${picked ? " bg-hover" : " bg-transparent"}`;
						if (row.kind === "grant") {
							const glyph = <span className={`shrink-0 font-mono text-[12px] ${row.grant.granted ? "text-ink" : "text-muted-soft"}`}>{row.grant.granted ? "✓" : "·"}</span>;
							const name = <span className={`shrink-0 font-mono text-[13px] ${row.grant.granted ? "text-ink" : "text-muted"}`}>{row.grant.name}</span>;
							const detail = row.grant.detail ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{row.grant.detail}</span> : null;
							const meta = row.grant.meta ? <span className={GRANT}>{row.grant.meta}</span> : null;
							if (row.grant.alwaysOn) {
								return (
									<div key={`g:${row.grant.group}:${row.grant.name}`} className={`${className} cursor-default`} role="presentation">
										{glyph}
										{name}
										{detail}
										{meta}
									</div>
								);
							}
							return (
								<button
									key={`g:${row.grant.group}:${row.grant.name}`}
									type="button"
									className={className}
									role="option"
									aria-selected={picked}
									onMouseEnter={() => setCursor({ stamp, at })}
									onClick={() => activate(row)}
								>
									{glyph}
									{name}
									{detail}
									{meta}
								</button>
							);
						}
						if (row.kind === "session") {
							const unread = (row.row.lastMessageAt ?? 0) > (row.row.readAt ?? 0);
							const dir = row.row.workspace ? splitPath(row.row.workspace).name : "";
							return (
								<button
									key={`s:${row.row.name}`}
									type="button"
									className={className}
									role="option"
									aria-selected={picked}
									onMouseEnter={() => setCursor({ stamp, at })}
									onClick={() => activate(row)}
								>
									<span className="grid size-5 shrink-0 place-items-center rounded-full border border-line bg-surface font-serif text-[12px] leading-none text-ink">
										<span className="block leading-none [transform:translateY(0.1em)]">{(row.row.name[0] ?? "?").toUpperCase()}</span>
									</span>
									<span className="flex min-w-0 flex-1 flex-col leading-tight">
										<span className="truncate font-serif text-[14px] font-semibold text-ink">{row.row.name}</span>
										<span className="truncate font-sans text-[12px] text-muted">{previewFor(row.row) || "—"}</span>
									</span>
									{dir === "" ? null : <span className="min-w-0 truncate font-mono text-[12px] text-muted">{dir}</span>}
									{unread ? (
										<Tip label="new messages">
											<span className="inline-block size-[6px] shrink-0 rounded-full bg-signal" />
										</Tip>
									) : null}
									<span className="shrink-0 font-sans text-[12px] whitespace-nowrap text-muted">{listTime(activityAt(row.row))}</span>
								</button>
							);
						}
						const parts = splitPath(row.file.path);
						return (
							<button
								key={`f:${row.file.path}`}
								type="button"
								className={className}
								role="option"
								aria-selected={picked}
								onMouseEnter={() => setCursor({ stamp, at })}
								onClick={() => activate(row)}
							>
								<span className={`shrink-0 ${picked ? "text-ink" : "text-muted-soft"}`}>{fileGlyph(parts.name)}</span>
								<span className="shrink-0 font-mono text-[13px] text-ink">{parts.name}</span>
								<span className="min-w-0 truncate font-mono text-[12px] text-muted">{parts.dir}</span>
							</button>
						);
					})}
				</div>
			)}

			<div className="flex items-center gap-3 border-t border-line px-4 py-2">
				{range === undefined ? null : (
					<span className="shrink-0 rounded-[4px] border-[0.5px] border-line px-1 py-[1px] font-mono text-[10px] whitespace-nowrap text-muted">
						{range.start === range.end ? `#${range.start}` : `#${range.start}-${range.end}`}
					</span>
				)}
				<span className={`${STATUS}${error ? " text-signal" : ""}`} aria-live="polite">
					{status ?? ""}
				</span>
				<span className={KEYS}>
					<span className={KEY_ITEM}>
						<Kbd>⇥</Kbd>switch
					</span>
					<span className={KEY_ITEM}>
						<Kbd>↑↓</Kbd>navigate
					</span>
					<span className={KEY_ITEM}>
						<Kbd>↵</Kbd>
						{activeMode === "files" ? "open in editor" : activeMode === "access" ? "toggle" : "open"}
					</span>
					<span className={KEY_ITEM}>
						<Kbd>esc</Kbd>close
					</span>
				</span>
			</div>
		</div>
	);
}

export default PaletteDialog;
