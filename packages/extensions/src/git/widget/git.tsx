import type { Host, SlotProps } from "@milu/window/api";
import { ensureLanguages, getHighlighter, highlightLines, resolveLanguage } from "@milu/window/api/markdown";
import { Tip } from "@milu/window/api/tooltip";
import { Columns2, PanelLeft, PanelLeftClose, PanelLeftOpen, RefreshCw, WrapText } from "lucide-react";
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { type DiffCell, splitDiff, type SplitRow } from "../lib/diff.ts";
import { IGitChangesService, keyOf, type GitViewState } from "../service/changes.ts";
import type { GitChange, GitPatch, GitSides } from "../types.ts";

const LIST_WIDTH = 232;
const LIST_MIN = 140;
const READER_MIN = 260;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const dirName = (path: string): string => {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? "" : path.slice(0, cut + 1);
};

const extensionOf = (path: string): string => {
	const at = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return at <= slash ? "" : path.slice(at + 1).toLowerCase();
};

const titleOf = (state: GitViewState): string =>
	state.repoRoot === "" ? (state.status === "ready" ? "not a repository" : "changes") : `${baseName(state.repoRoot)} · ${state.changes.length}`;

interface ListControls {
	readonly shown: boolean;
	readonly toggle: () => void;
}

function useHasWorkspace(host: Host): boolean {
	const selected = useStore(host.selection.store, (state) => state.selected);
	return useStore(host.sessions.store, (state) => {
		const row = state.rows.find((each) => each.name === selected);
		return selected !== "" && row !== undefined && row.workspace != null;
	});
}

export function GitHead(props: SlotProps) {
	const { host } = props;
	const hasWorkspace = useHasWorkspace(host);
	const active = useStore(host.dock.store, (state) => state.active);
	const state = useStore(host.get(IGitChangesService).store);
	if (!hasWorkspace || active !== "git") return null;
	return (
		<>
			<span className="dock-bar-title">{titleOf(state)}</span>
			{state.status === "loading" ? (
				<span className="dock-bar-status">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
					Reading…
				</span>
			) : null}
		</>
	);
}

export function GitPane(props: SlotProps) {
	const { host } = props;
	const hasWorkspace = useHasWorkspace(host);
	const service = host.get(IGitChangesService);
	const state = useStore(service.store);
	const session = useStore(host.selection.store, (current) => current.selected);
	const running = useStore(host.sessions.store, (current) => current.rows.find((row) => row.name === session)?.running ?? false);
	const dockWidth = useStore(host.columns.store, (current) => current.columns.dock.width);
	const shown = useStore(host.dock.store, (current) => current.visible);
	const origin = useRef<{ x: number; width: number } | null>(null);
	const peek = useRef<HTMLDivElement>(null);
	const wasRunning = useRef(running);
	const [peeking, setPeeking] = useState(false);

	const change = state.changes.find((each) => keyOf(each) === state.selected) ?? null;
	const detailOpen = change !== null;
	const listShown = !detailOpen || state.listOpen;
	const listMax = Math.max(LIST_MIN, dockWidth - READER_MIN);
	const listWidth = clamp(state.listWidth, LIST_MIN, listMax);
	const list: ListControls = {
		shown: listShown,
		toggle: () => {
			if (listShown) service.setList(false);
			else setPeeking((open) => !open);
		},
	};

	useEffect(() => {
		void service.refresh();
	}, [service]);

	useEffect(() => {
		if (!hasWorkspace || !shown || state.status !== "ready" || state.changes.length > 0) return;
		host.dock.select("explorer");
	}, [host, hasWorkspace, shown, state.status, state.changes.length]);

	useEffect(() => {
		if (wasRunning.current && !running) void service.refresh();
		wasRunning.current = running;
	}, [running, service]);

	useEffect(() => () => document.body.classList.remove("git-resizing"), []);

	useEffect(() => {
		if (!peeking) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && peek.current?.contains(target) === true) return;
			if (target instanceof Element && target.closest(".git-list-toggle") !== null) return;
			setPeeking(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPeeking(false);
		};
		window.addEventListener("pointerdown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [peeking]);

	const resize = (width: number): void => service.setListWidth(clamp(width, LIST_MIN, listMax));

	const onSplitDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		origin.current = { x: event.clientX, width: listWidth };
		document.body.classList.add("git-resizing");
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onSplitMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const start = origin.current;
		if (start !== null) resize(start.width + event.clientX - start.x);
	};

	const onSplitUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (origin.current === null) return;
		origin.current = null;
		document.body.classList.remove("git-resizing");
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	const onSplitKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (step === 0) return;
		event.preventDefault();
		resize(listWidth + step);
	};

	if (!hasWorkspace) return null;

	const group = (title: string, items: readonly GitChange[]): ReactNode => (
		<Fragment key={title}>
			<div className="git-group-title">
				{title} <span className="git-group-count">{items.length}</span>
			</div>
			{items.map((item) => (
				<button
					type="button"
					key={keyOf(item)}
					className={`git-row${keyOf(item) === state.selected ? " selected" : ""}`}
					title={item.path}
					onClick={() => {
						setPeeking(false);
						service.select(keyOf(item));
					}}
				>
					<span className={`git-status ${item.status.toLowerCase()}`}>{item.status}</span>
					<span className="git-path">
						<span className="git-path-dir">{dirName(item.path)}</span>
						<span className="git-path-name">{baseName(item.path)}</span>
					</span>
				</button>
			))}
		</Fragment>
	);

	const staged = state.changes.filter((each) => each.staged);
	const unstaged = state.changes.filter((each) => !each.staged);
	const listBody = (
		<div className="git-body">
			{state.status === "error" ? (
				<p className="git-note">{state.error}</p>
			) : state.changes.length === 0 ? (
				<p className="git-note">{state.status === "ready" ? (state.repoRoot === "" ? "not a git repository" : "no changes") : "reading the repository…"}</p>
			) : (
				<>
					{staged.length > 0 ? group("Staged Changes", staged) : null}
					{unstaged.length > 0 ? group("Changes", unstaged) : null}
				</>
			)}
		</div>
	);

	return (
		<div className={`git-dock${detailOpen && listShown ? " split" : ""}`}>
			{listShown ? (
				<div className="git-list" style={detailOpen ? { width: listWidth } : undefined}>
					{listBody}
				</div>
			) : null}

			{detailOpen && listShown ? (
				<div
					className="git-split-grip"
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize the change list"
					aria-valuemin={LIST_MIN}
					aria-valuemax={Math.round(listMax)}
					aria-valuenow={Math.round(listWidth)}
					tabIndex={0}
					onDoubleClick={() => resize(LIST_WIDTH)}
					onPointerDown={onSplitDown}
					onPointerMove={onSplitMove}
					onPointerUp={onSplitUp}
					onPointerCancel={onSplitUp}
					onKeyDown={onSplitKey}
				/>
			) : null}

			{change !== null ? <DiffPane host={host} session={session} change={change} list={list} /> : null}

			{!listShown && peeking ? (
				<div className="git-peek" ref={peek}>
					<div className="git-peek-head">
						<span className="dock-bar-title">{titleOf(state)}</span>
						<button
							type="button"
							className="git-btn"
							aria-label="Dock the list"
							title="Dock the list"
							onClick={() => {
								setPeeking(false);
								service.setList(true);
							}}
						>
							<PanelLeft size={12} />
						</button>
					</div>
					{listBody}
				</div>
			) : null}
		</div>
	);
}

function DiffPane(props: { host: Host; session: string; change: GitChange; list: ListControls }) {
	const { host, change } = props;
	const service = host.get(IGitChangesService);
	const state = useStore(service.store);
	const key = `${keyOf(change)}@${state.revision}`;
	const [sides, setSides] = useState<{ key: string; data: GitSides | null; error: string } | null>(null);
	const [patch, setPatch] = useState<{ key: string; data: GitPatch | null; error: string } | null>(null);

	const loaded = sides !== null && sides.key === key ? sides : null;
	const data = loaded?.data ?? null;
	const needed = !state.sideBySide || data?.tooLarge === true;

	useEffect(() => {
		let alive = true;
		void host.actions
			.request<GitSides>("git.sides", props.session, { path: change.path, staged: change.staged, ...(change.from === undefined ? {} : { from: change.from }) })
			.then((next) => {
				if (alive) setSides({ key, data: next ?? null, error: "" });
			})
			.catch((error: unknown) => {
				if (alive) setSides({ key, data: null, error: reason(error) });
			});
		return () => {
			alive = false;
		};
	}, [host, props.session, change.path, change.staged, change.from, key]);

	useEffect(() => {
		if (!needed) return;
		let alive = true;
		void host.actions
			.request<GitPatch>("git.patch", props.session, { path: change.path, staged: change.staged })
			.then((next) => {
				if (alive) setPatch({ key, data: next ?? null, error: "" });
			})
			.catch((error: unknown) => {
				if (alive) setPatch({ key, data: null, error: reason(error) });
			});
		return () => {
			alive = false;
		};
	}, [host, props.session, change.path, change.staged, needed, key]);

	const loadedPatch = patch !== null && patch.key === key ? patch : null;
	const rows = useMemo(() => (data === null || data.binary || data.tooLarge ? null : splitDiff(data.original, data.modified)), [data]);
	const language = resolveLanguage(extensionOf(change.path));
	const error = loaded?.error ?? loadedPatch?.error ?? "";
	const loading = loaded === null || (needed && loadedPatch === null);

	const body = (): ReactNode => {
		if (error !== "") return <p className="git-note">{error}</p>;
		if (loading) {
			return (
				<div className="git-loading">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
				</div>
			);
		}
		if (data === null) return <p className="git-note">nothing to read</p>;
		if (data.binary) return <p className="git-note">binary file · no line-by-line diff</p>;
		if (state.sideBySide) {
			if (rows === null) return <p className="git-note">{data.tooLarge ? "file too large to compare side by side" : "too many lines to align"} · switch to one column</p>;
			return <SplitView key={key} rows={rows} original={data.original} modified={data.modified} language={language} wrap={state.wrap} />;
		}
		if (loadedPatch?.data === null || loadedPatch?.data === undefined) return <p className="git-note">nothing to read</p>;
		return <PatchView patch={loadedPatch.data} wrap={state.wrap} />;
	};

	return (
		<div className="git-diff">
			<div className="git-diff-head">
				<button
					type="button"
					className="git-btn git-list-toggle"
					aria-expanded={props.list.shown}
					aria-label={props.list.shown ? "Collapse the list" : "Show the list"}
					title={props.list.shown ? "Collapse the list" : "Show the list"}
					onClick={props.list.toggle}
				>
					{props.list.shown ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
				</button>
				<div className="git-diff-title">
					<span className="git-file-name">{baseName(change.path)}</span>
					{data !== null && (data.add > 0 || data.del > 0) ? (
						<span className="git-diff-stats">
							{data.add > 0 ? <span className="add">+{data.add}</span> : null}
							{data.del > 0 ? <span className="del">−{data.del}</span> : null}
						</span>
					) : null}
				</div>
				<div className="git-diff-actions">
					<Tip label={state.sideBySide ? "Show one column" : "Show both sides"}>
						<button
							type="button"
							className={`git-btn${state.sideBySide ? " on" : ""}`}
							aria-pressed={state.sideBySide}
							aria-label={state.sideBySide ? "Show one column" : "Show both sides"}
							onClick={() => service.setSideBySide(!state.sideBySide)}
						>
							<Columns2 size={11} />
						</button>
					</Tip>
					<Tip label={state.wrap ? "Stop wrapping long lines" : "Wrap long lines"}>
						<button
							type="button"
							className={`git-btn${state.wrap ? " on" : ""}`}
							aria-pressed={state.wrap}
							aria-label="Wrap long lines"
							onClick={() => service.setWrap(!state.wrap)}
						>
							<WrapText size={11} />
						</button>
					</Tip>
					<Tip label="Read the repository again">
						<button type="button" className="git-btn" aria-label="Read the repository again" onClick={() => void service.refresh()}>
							<RefreshCw size={11} />
						</button>
					</Tip>
				</div>
			</div>
			<div className="git-dir-row">
				<span className="git-dir">{dirName(change.path)}</span>
			</div>
			{body()}
		</div>
	);
}

function usePainted(text: string, language: string | null): readonly string[] | null {
	const [painted, setPainted] = useState<{ text: string; lines: readonly string[] } | null>(null);
	useEffect(() => {
		if (language === null || text === "") return;
		let alive = true;
		void ensureLanguages([language])
			.then(() => getHighlighter())
			.then((core) => {
				const lines = highlightLines(core, text, language);
				if (alive && lines.length > 0) setPainted({ text, lines });
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [text, language]);
	return painted !== null && painted.text === text ? painted.lines : null;
}

function SplitView(props: { rows: readonly SplitRow[]; original: string; modified: string; language: string | null; wrap: boolean }) {
	const left = usePainted(props.original, props.language);
	const right = usePainted(props.modified, props.language);
	const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

	const content = (cell: DiffCell, painted: readonly string[] | null, side: "left" | "right"): ReactNode => {
		const html = painted !== null && cell.number !== null ? painted[cell.number - 1] : undefined;
		const tone = cell.tone === "none" ? " void" : ` ${cell.tone}`;
		return (
			<Fragment>
				<span className="git-no">{cell.number ?? ""}</span>
				<span className={`git-cell${tone}`} data-side={side} {...(html === undefined ? {} : { dangerouslySetInnerHTML: { __html: html === "" ? " " : html } })}>
					{html === undefined ? cell.text || " " : null}
				</span>
			</Fragment>
		);
	};

	return (
		<div className={`git-sides${props.wrap ? " wrap" : ""}`}>
			<div className="git-sides-grid">
				{props.rows.map((row, index) =>
					row.kind === "gap" ? (
						expanded.has(index) ? (
							<Fragment key={index}>
								{row.lines.map((line, at) => (
									<Fragment key={`${index}:${at}`}>
										{content(line.left, left, "left")}
										{content(line.right, right, "right")}
									</Fragment>
								))}
							</Fragment>
						) : (
							<button
								type="button"
								className="git-gap"
								key={index}
								onClick={() =>
									setExpanded((current) => {
										const next = new Set(current);
										next.add(index);
										return next;
									})
								}
							>
								{row.count} unchanged {row.count === 1 ? "line" : "lines"}
							</button>
						)
					) : (
						<Fragment key={index}>
							{content(row.left, left, "left")}
							{content(row.right, right, "right")}
						</Fragment>
					),
				)}
			</div>
		</div>
	);
}

function lineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
	if (line.startsWith("@@")) return "hunk";
	if (line.startsWith("+")) return "add";
	if (line.startsWith("-")) return "del";
	return "";
}

function PatchView(props: { patch: GitPatch; wrap: boolean }) {
	const lines = props.patch.kind === "new" ? props.patch.content.split("\n") : props.patch.diff.split("\n");
	return (
		<div className={`git-patch${props.wrap ? " wrap" : ""}`}>
			{props.patch.kind === "new" ? <div className="git-patch-note">new file</div> : null}
			{lines.map((line, index) => {
				const fresh = props.patch.kind === "new";
				const tone = fresh ? "add" : lineClass(line);
				const mark = tone === "add" ? "+" : tone === "del" ? "−" : "";
				const text = fresh || mark === "" ? line : line.slice(1);
				return (
					<div className={`git-diff-line${tone === "" ? "" : ` ${tone}`}`} key={index}>
						{mark === "" ? null : <span className="git-diff-mark">{mark}</span>}
						{text || " "}
					</div>
				);
			})}
		</div>
	);
}
