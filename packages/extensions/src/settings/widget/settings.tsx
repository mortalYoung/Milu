import type { DialogProps } from "@milu/window/api";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MCP_LIFECYCLES, type McpOptions } from "../../mcp/types.ts";
import type { Settings, SettingsSnapshot } from "../index.ts";
import { ProvidersPanel } from "./providers.tsx";
import { BUTTON_GHOST, FIELD, LINK, NumberField, Row, Select, Switch, TextField } from "./ui.tsx";

const CATEGORIES = [
	{ id: "general", label: "General" },
	{ id: "tools", label: "MCP & Tools" },
	{ id: "skills", label: "Skills" },
	{ id: "memory", label: "Memory" },
	{ id: "compaction", label: "Compaction" },
	{ id: "permission", label: "Permission" },
	{ id: "schedule", label: "Schedule" },
	{ id: "providers", label: "Providers" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

type FieldKind = "text" | "number" | "switch" | "select" | "path" | "dirs";

interface Field {
	readonly id: string;
	readonly category: CategoryId;
	readonly title: string;
	readonly description: string;
	readonly kind: FieldKind;
	readonly min?: number;
	readonly mono?: boolean;
	readonly options?: readonly { value: string; label: string }[];
	readonly preview?: boolean;
}

const SANDBOX: readonly { value: string; label: string }[] = [
	{ value: "read-only", label: "read-only" },
	{ value: "workspace-write", label: "workspace-write" },
	{ value: "danger-full-access", label: "danger-full-access" },
];

const FIELDS: readonly Field[] = [
	{
		id: "partner_profile_path",
		category: "general",
		kind: "path",
		title: "Partner Profile Path",
		description: "Directory where partner profiles are stored. Applied on the next start.",
	},
	{
		id: "detect_instructions_file",
		category: "general",
		kind: "text",
		title: "Instructions File",
		description: "Workspace file read into the reminders of every run.",
		mono: true,
	},
	{
		id: "workStepsDisplay",
		category: "general",
		kind: "select",
		title: "Work steps display",
		description: "Flat shows every thought and tool call; collapsed folds the whole step behind its header.",
		options: [
			{ value: "flat", label: "flat" },
			{ value: "collapsed", label: "collapsed" },
		],
	},
	{
		id: "toastPlacement",
		category: "general",
		kind: "select",
		title: "Notification Placement",
		description: "Where notifications appear. Only the right-hand corners are supported.",
		options: [
			{ value: "topright", label: "TopRight" },
			{ value: "bottomright", label: "BottomRight" },
		],
		preview: true,
	},
	{
		id: "toastDurationMs",
		category: "general",
		kind: "number",
		title: "Notification Duration",
		description: "How long a notification stays before dismissing itself, in milliseconds. 0 keeps it until dismissed.",
		min: 0,
	},
	{ id: "rememberSession", category: "general", kind: "switch", title: "Remember Last Session", description: "Reopen the last chat and window size on launch." },
	{
		id: "shellContinuous",
		category: "general",
		kind: "switch",
		title: "Continuous Shell Input",
		description: "Keep shell mode active after sending a command; off leaves shell mode as soon as one is sent.",
	},

	{
		id: "bash.timeoutSec",
		category: "tools",
		kind: "number",
		title: "Bash Timeout (s)",
		description: "Max time a bash command may run before its process group is killed.",
		min: 1,
	},
	{ id: "webFetch.timeoutMs", category: "tools", kind: "number", title: "Web Fetch Timeout (ms)", description: "Max time a fetch may take before aborting.", min: 0 },
	{
		id: "webFetch.maxBytes",
		category: "tools",
		kind: "number",
		title: "Web Fetch Max Bytes",
		description: "Response body size cap in bytes; larger responses are rejected.",
		min: 0,
	},
	{ id: "webFetch.maxChars", category: "tools", kind: "number", title: "Web Fetch Max Chars", description: "Character cap for the text returned to the model.", min: 0 },
	{ id: "webFetch.userAgent", category: "tools", kind: "text", title: "Web Fetch User Agent", description: "User-Agent header sent with web_fetch requests.", mono: true },

	{ id: "skills_dirs", category: "skills", kind: "dirs", title: "Skills Directories", description: "Where skills are looked up, relative to the workspace or home." },

	{ id: "memoryEnabled", category: "memory", kind: "switch", title: "Memory", description: "Let the agent write memory while it works." },
	{ id: "memoryIdleMinutes", category: "memory", kind: "number", title: "Memory Idle Delay", description: "Minutes of quiet before memory extraction runs.", min: 0 },
	{
		id: "memoryPendingRounds",
		category: "memory",
		kind: "number",
		title: "Memory Rounds Before Organize",
		description: "Rounds a pending memory may wait before it is organized into scenes.",
		min: 0,
	},
	{ id: "memoryMaxScenes", category: "memory", kind: "number", title: "Max Scene Documents", description: "Cap on scene documents per partner; older scenes are merged.", min: 0 },

	{
		id: "compaction.digestMaxItems",
		category: "compaction",
		kind: "number",
		title: "Checkpoint Digest Items",
		description: "Max memories carried in a checkpoint digest; the newest events are always reserved.",
		min: 0,
	},

	{ id: "defaultSandboxMode", category: "permission", kind: "select", title: "Default Sandbox Mode", description: "Sandbox mode for newly created partners.", options: SANDBOX },
	{ id: "delete.strict", category: "permission", kind: "switch", title: "Strict Delete Mode", description: "Refuse rm unless the same path was already moved to the Trash." },

	{ id: "schedulesEnabled", category: "schedule", kind: "switch", title: "Schedules", description: "Let scheduled messages fire." },
	{ id: "schedulesDailyCap", category: "schedule", kind: "number", title: "Daily Cap", description: "Max schedule runs per day, per partner.", min: 0 },
];

const MCP_FIELDS: readonly Field[] = [
	{ id: "configFile", category: "tools", kind: "path", title: "MCP Config File", description: "Where MCP servers and options are stored." },
	{
		id: "idleTimeoutSec",
		category: "tools",
		kind: "number",
		title: "MCP Idle Timeout (s)",
		description: "Seconds before a lazy or eager server is disconnected after last use.",
		min: 0,
	},
	{
		id: "defaultLifecycle",
		category: "tools",
		kind: "select",
		title: "MCP Default Lifecycle",
		description: "Lifecycle used for servers that do not set their own.",
		options: MCP_LIFECYCLES.map((value) => ({ value, label: value })),
	},
	{ id: "maxBufferSize", category: "tools", kind: "number", title: "MCP Max Buffer (bytes)", description: "Cap on a single server message.", min: 0 },
];

function at(source: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((value, key) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined), source);
}

function setIn(target: Record<string, unknown>, keys: readonly string[], value: unknown): Record<string, unknown> {
	const [head, ...rest] = keys;
	if (head === undefined) return target;
	if (rest.length === 0) return { ...target, [head]: value };
	const child = target[head];
	return { ...target, [head]: setIn(typeof child === "object" && child !== null ? (child as Record<string, unknown>) : {}, rest, value) };
}

function patchFor(values: Settings, path: string, next: unknown): Partial<Settings> {
	const [head, ...rest] = path.split(".");
	if (head === undefined) return {};
	if (rest.length === 0) return { [head]: next } as Partial<Settings>;
	const section = (values as unknown as Record<string, unknown>)[head];
	return { [head]: setIn(typeof section === "object" && section !== null ? (section as Record<string, unknown>) : {}, rest, next) } as Partial<Settings>;
}

function changed(values: unknown, defaults: unknown, path: string): boolean {
	return JSON.stringify(at(values, path) ?? null) !== JSON.stringify(at(defaults, path) ?? null);
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function highlight(text: string, query: string): ReactNode {
	if (query === "") return text;
	const index = text.toLowerCase().indexOf(query);
	if (index < 0) return text;
	return (
		<>
			{text.slice(0, index)}
			<span className="rounded bg-selected text-ink">{text.slice(index, index + query.length)}</span>
			{text.slice(index + query.length)}
		</>
	);
}

function PathField(props: { value: string; host: DialogProps["host"]; onCommit: (next: string) => void; ariaLabel: string }) {
	return (
		<div className="flex w-[260px] items-center gap-1.5">
			<TextField value={props.value} onCommit={props.onCommit} ariaLabel={props.ariaLabel} mono width="w-full" />
			<button
				type="button"
				className={BUTTON_GHOST}
				aria-label={`Choose ${props.ariaLabel}`}
				onClick={() => {
					void props.host.picker.pick(props.value || undefined).then((picked) => {
						if (picked) props.onCommit(picked);
					});
				}}
			>
				Choose
			</button>
		</div>
	);
}

function DirsField(props: { values: readonly string[]; onCommit: (next: string[]) => void }) {
	const [rows, setRows] = useState<readonly string[]>(props.values);

	const commit = (next: readonly string[]) => {
		const cleaned = next.map((row) => row.trim()).filter((row) => row !== "");
		void props.onCommit(cleaned);
	};

	return (
		<div className="grid gap-2">
			{rows.map((row, index) => (
				<div className="flex items-center gap-2" key={index}>
					<input
						className={`${FIELD} min-w-0 flex-1 font-mono text-[12px]`}
						value={row}
						aria-label={`Skills directory ${index + 1}`}
						spellCheck={false}
						onChange={(event) => setRows(rows.map((each, at) => (at === index ? event.currentTarget.value : each)))}
						onBlur={(event) => {
							const next = rows.map((each, at) => (at === index ? event.currentTarget.value : each));
							if (next[index] !== props.values[index]) commit(next);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
					/>
					<button
						type="button"
						className={LINK}
						aria-label={`remove skills directory ${index + 1}`}
						onClick={() => {
							const next = rows.filter((_, at) => at !== index);
							setRows(next);
							commit(next);
						}}
					>
						×
					</button>
				</div>
			))}
			<button type="button" className={`${LINK} justify-self-start`} onClick={() => setRows([...rows, ""])}>
				+ add directory
			</button>
		</div>
	);
}

export function SettingsDialog(props: DialogProps) {
	const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
	const [draft, setDraft] = useState<Settings | null>(null);
	const [mcp, setMcp] = useState<McpOptions | null>(null);
	const [category, setCategory] = useState<CategoryId>("general");
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const search = useRef<HTMLInputElement>(null);

	const refresh = async (): Promise<void> => {
		const next = await props.host.actions.request<SettingsSnapshot>("settings.collect");
		if (!next) return;
		setSnapshot(next);
		setDraft(next.values);
		setMcp(next.mcp);
	};

	useEffect(() => {
		let cancelled = false;
		props.host.actions
			.request<SettingsSnapshot>("settings.collect")
			.then((next) => {
				if (cancelled || !next) return;
				setSnapshot(next);
				setDraft(next.values);
				setMcp(next.mcp);
			})
			.catch((loadError: unknown) => {
				if (!cancelled) setError(reason(loadError));
			});
		return () => {
			cancelled = true;
		};
	}, [props.host]);
	useEffect(() => {
		search.current?.focus();
	}, []);

	const persist = async (patch: Partial<Settings>, credentials?: Record<string, string | null>): Promise<void> => {
		if (!draft) return;
		setDraft({ ...draft, ...patch });
		try {
			await props.host.actions.invoke("settings.update", undefined, { patch, credentials });
			setError(null);
		} catch (saveError) {
			setError(reason(saveError));
		}
	};

	const saveField = (path: string, next: unknown): void => {
		if (!draft) return;
		void persist(patchFor(draft, path, next));
	};

	const saveMcp = async (patch: Partial<McpOptions>): Promise<void> => {
		if (!mcp) return;
		const next = { ...mcp, ...patch };
		setMcp(next);
		try {
			await props.host.actions.invoke("settings.mcp", undefined, next);
			setError(null);
		} catch (saveError) {
			setError(reason(saveError));
		}
	};

	const searching = query.trim() !== "";
	const needle = query.trim().toLowerCase();
	const matches = useMemo(() => {
		if (!searching) return null;
		const hit = (field: Field) => field.title.toLowerCase().includes(needle) || field.description.toLowerCase().includes(needle);
		return {
			fields: FIELDS.filter(hit),
			mcp: MCP_FIELDS.filter(hit).length > 0,
			providers: snapshot ? snapshot.providers.filter((row) => row.id.toLowerCase().includes(needle)) : [],
		};
	}, [searching, needle, snapshot]);

	const fieldControl = (field: Field): ReactNode => {
		if (!draft || !snapshot) return null;
		const value = at(draft, field.id);
		switch (field.kind) {
			case "switch":
				return <Switch checked={value === true} ariaLabel={field.title} onChange={(next) => saveField(field.id, next)} />;
			case "select":
				return (
					<div className="flex items-center gap-2">
						<Select value={String(value ?? "")} ariaLabel={field.title} options={field.options ?? []} onChange={(next) => saveField(field.id, next)} />
						{field.preview ? (
							<button
								type="button"
								className={`${BUTTON_GHOST} h-8`}
								onClick={() => props.host.notifications.push({ title: "Notification", body: "This is how a notification looks." })}
							>
								Test
							</button>
						) : null}
					</div>
				);
			case "number":
				return <NumberField value={typeof value === "number" ? value : undefined} ariaLabel={field.title} min={field.min} onCommit={(next) => saveField(field.id, next)} />;
			case "path":
				return <PathField value={String(value ?? "")} host={props.host} ariaLabel={field.title} onCommit={(next) => saveField(field.id, next)} />;
			case "dirs":
				return (
					<DirsField
						key={(Array.isArray(value) ? (value as string[]) : []).join("|")}
						values={Array.isArray(value) ? (value as string[]) : []}
						onCommit={(next) => saveField(field.id, next)}
					/>
				);
			default:
				return <TextField value={String(value ?? "")} ariaLabel={field.title} mono={field.mono} onCommit={(next) => saveField(field.id, next)} />;
		}
	};

	const mcpControl = (field: Field): ReactNode => {
		if (!mcp) return null;
		const value = at(mcp, field.id);
		switch (field.kind) {
			case "select":
				return (
					<Select
						value={String(value ?? "")}
						ariaLabel={field.title}
						options={field.options ?? []}
						onChange={(next) => void saveMcp({ defaultLifecycle: next as McpOptions["defaultLifecycle"] })}
					/>
				);
			case "number":
				return (
					<NumberField
						value={typeof value === "number" ? value : undefined}
						ariaLabel={field.title}
						min={field.min}
						onCommit={(next) => void saveMcp(field.id === "idleTimeoutSec" ? { idleTimeoutSec: next } : { maxBufferSize: next })}
					/>
				);
			default:
				return <PathField value={String(value ?? "")} host={props.host} ariaLabel={field.title} onCommit={(next) => void saveMcp({ configFile: next })} />;
		}
	};

	const row = (field: Field, control: ReactNode, q = ""): ReactNode => (
		<Row
			key={field.id}
			title={q === "" ? field.title : highlight(field.title, q)}
			description={q === "" ? field.description : highlight(field.description, q)}
			modified={draft !== null && snapshot !== null && changed(draft, snapshot.defaults, field.id)}
			stacked={field.kind === "dirs"}
		>
			{control}
		</Row>
	);

	if (!draft || !snapshot || !mcp) {
		return (
			<div className="flex h-[min(640px,86vh)] w-[min(820px,calc(100vw-48px))] items-center justify-center font-sans text-[13px] text-muted">{error ?? "Loading settings…"}</div>
		);
	}

	const total = matches ? matches.fields.length + (matches.mcp ? MCP_FIELDS.length : 0) + matches.providers.length : 0;

	return (
		<div className="relative flex h-[min(640px,86vh)] w-[min(820px,calc(100vw-48px))] flex-col overflow-hidden font-sans text-ink">
			<header className="flex shrink-0 items-baseline gap-3 px-5 pt-4 pb-3 pr-12">
				<h2 className="m-0 font-serif text-[16px] font-semibold text-ink">Settings</h2>
				<p className="m-0 text-[12px] text-muted">Saved as you change it.</p>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav className="flex w-[184px] shrink-0 flex-col gap-0.5 border-r border-line px-3 py-1">
					{CATEGORIES.map((entry) => {
						const hits = !searching
							? 0
							: (matches?.fields.filter((field) => field.category === entry.id).length ?? 0) +
								(entry.id === "tools" && matches?.mcp ? 1 : 0) +
								(entry.id === "providers" ? (matches?.providers.length ?? 0) : 0);
						return (
							<button
								key={entry.id}
								type="button"
								className={`flex h-9 w-full cursor-pointer items-center rounded-md px-3 text-left font-serif text-[14px] transition-colors duration-100 ${category === entry.id ? "bg-hover text-ink" : "text-ink-soft hover:bg-hover"}`}
								onClick={() => setCategory(entry.id)}
							>
								{entry.label}
								{searching ? hits > 0 ? <span className="ml-auto size-[5px] shrink-0 rounded-full bg-signal" /> : null : null}
							</button>
						);
					})}
				</nav>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="px-6 pt-1 pb-3">
						<div className="relative">
							<Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
							<input
								ref={search}
								className="h-9 w-full rounded-md border border-line bg-surface pr-20 pl-9 font-sans text-[13px] text-ink outline-none transition-colors duration-100 placeholder:text-muted focus-visible:border-ink"
								placeholder="Search settings"
								aria-label="Search settings"
								spellCheck={false}
								value={query}
								onChange={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape" && searching) {
										event.preventDefault();
										setQuery("");
									}
								}}
							/>
							{searching ? (
								<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[10px] text-muted">
									{total} {total === 1 ? "match" : "matches"}
								</span>
							) : null}
						</div>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
						{searching ? (
							<div className="space-y-5">
								{CATEGORIES.map((entry) => {
									const fields = matches?.fields.filter((field) => field.category === entry.id) ?? [];
									const showMcp = entry.id === "tools" && matches?.mcp === true;
									const providers = entry.id === "providers" ? (matches?.providers ?? []) : [];
									if (fields.length === 0 && !showMcp && providers.length === 0) return null;
									return (
										<div key={entry.id}>
											<div className="mb-2 font-serif text-[16px] font-medium text-ink">{entry.label}</div>
											<div className="divide-y divide-line">
												{fields.map((field) => row(field, fieldControl(field), needle))}
												{showMcp ? MCP_FIELDS.map((field) => row(field, mcpControl(field), needle)) : null}
												{providers.map((row) => (
													<div key={row.id} className="flex items-center gap-2 py-3.5">
														<span className="font-serif text-[14px] text-ink">{highlight(row.id, needle)}</span>
														{row.configured ? <span className="size-[5px] shrink-0 rounded-full bg-ink-soft" title="configured" /> : null}
													</div>
												))}
											</div>
										</div>
									);
								})}
								{total === 0 ? (
									<div className="pt-8 text-center">
										<div className="font-serif text-[14px] text-ink-soft">No matching settings</div>
										<div className="mt-1 font-sans text-[12px] text-muted">Try a different search.</div>
									</div>
								) : null}
							</div>
						) : category === "providers" ? (
							<ProvidersPanel snapshot={snapshot} draft={draft} save={persist} refresh={refresh} />
						) : (
							<div>
								<div className="mb-2 font-serif text-[16px] font-medium text-ink">{CATEGORIES.find((entry) => entry.id === category)?.label}</div>
								{category === "tools" ? (
									<div className="mb-1">
										<div className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">MCP</div>
										<div className="divide-y divide-line">{MCP_FIELDS.map((field) => row(field, mcpControl(field)))}</div>
									</div>
								) : null}
								<div className="divide-y divide-line">{FIELDS.filter((field) => field.category === category).map((field) => row(field, fieldControl(field)))}</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{error ? (
				<div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-4 py-2 font-sans text-[13px] text-canvas">{error}</div>
			) : null}
		</div>
	);
}

export default SettingsDialog;
