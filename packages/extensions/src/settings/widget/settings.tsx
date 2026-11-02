import type { ThemeMode, ThemeSettings, ThemeState } from "@milu/protocol";
import type { DialogProps } from "@milu/window/api";
import { Bell, Check, Folder, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MCP_LIFECYCLES, type McpOptions } from "../../mcp/types.ts";
import type { ProviderRow, Settings, SettingsSnapshot } from "../index.ts";
import { ProvidersBand } from "./providers.tsx";
import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD, InlineChoices, LINK, SheetPanel, SheetRow, Switch, ValueButton } from "./ui.tsx";

const CATEGORIES = [
	{ id: "general", label: "General", intro: "How Milu starts, where partner profiles live, and how it tells you something happened." },
	{ id: "appearance", label: "Appearance", intro: "One mode, two palettes. Picking a theme applies it at once." },
	{ id: "providers", label: "Providers", intro: "Keys and endpoints behind the models you can pick. A key is written once and never echoed back." },
	{ id: "tools", label: "Tools", intro: "Limits for the shell, the web, and MCP servers." },
	{ id: "skills", label: "Skills", intro: "Where skill folders are looked up, relative to the workspace or home." },
	{ id: "memory", label: "Memory", intro: "When the agent writes memory, and how much of it it keeps." },
	{ id: "permission", label: "Permission", intro: "What a new partner may touch by default." },
	{ id: "schedule", label: "Schedule", intro: "Whether scheduled messages fire, and how many may run in a day." },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
type FieldKind = "text" | "number" | "switch" | "segments" | "duration" | "sandbox" | "path" | "dirs" | "select";

interface Field {
	readonly id: string;
	readonly scope: "settings" | "mcp";
	readonly category: CategoryId;
	readonly group?: string;
	readonly title: string;
	readonly description: string;
	readonly kind: FieldKind;
	readonly min?: number;
	readonly unit?: string;
	readonly mono?: boolean;
	readonly options?: readonly { value: string; label: string }[];
}

const SANDBOX: readonly { value: string; label: string }[] = [
	{ value: "read-only", label: "Read only" },
	{ value: "workspace-write", label: "Workspace" },
	{ value: "danger-full-access", label: "Full access" },
];

const FIELDS: readonly Field[] = [
	{
		id: "partner_profile_path",
		scope: "settings",
		category: "general",
		kind: "path",
		title: "Partner Profile Path",
		description: "Directory where partner profiles are stored. Applied on the next start.",
	},
	{
		id: "detect_instructions_file",
		scope: "settings",
		category: "general",
		kind: "text",
		title: "Instructions File",
		description: "Workspace file read into the reminders of every run.",
		mono: true,
	},
	{
		id: "toastPlacement",
		scope: "settings",
		category: "general",
		kind: "segments",
		title: "Notification Placement",
		description: "Where notifications appear. Only the right-hand corners are supported.",
		options: [
			{ value: "topright", label: "Top Right" },
			{ value: "bottomright", label: "Bottom Right" },
		],
	},
	{
		id: "toastDurationMs",
		scope: "settings",
		category: "general",
		kind: "duration",
		title: "Notification Duration",
		description: "How long a notification stays before dismissing itself. 0 keeps it until dismissed.",
		min: 0,
	},
	{ id: "rememberSession", scope: "settings", category: "general", kind: "switch", title: "Remember Last Session", description: "Reopen the last chat and window size on launch." },
	{
		id: "shellContinuous",
		scope: "settings",
		category: "general",
		kind: "switch",
		title: "Continuous Shell Input",
		description: "Keep shell mode active after sending a command; off leaves shell mode as soon as one is sent.",
	},

	{
		id: "bash.timeoutSec",
		scope: "settings",
		category: "tools",
		group: "Bash",
		kind: "number",
		title: "Bash Timeout",
		description: "Max time a bash command may run before its process group is killed.",
		min: 1,
		unit: "s",
	},
	{
		id: "webFetch.timeoutMs",
		scope: "settings",
		category: "tools",
		group: "Web Fetch",
		kind: "number",
		title: "Fetch Timeout",
		description: "Max time a fetch may take before aborting.",
		min: 0,
		unit: "ms",
	},
	{
		id: "webFetch.maxBytes",
		scope: "settings",
		category: "tools",
		group: "Web Fetch",
		kind: "number",
		title: "Fetch Max Bytes",
		description: "Response body size cap in bytes; larger responses are rejected.",
		min: 0,
		unit: "bytes",
	},
	{
		id: "webFetch.maxChars",
		scope: "settings",
		category: "tools",
		group: "Web Fetch",
		kind: "number",
		title: "Fetch Max Chars",
		description: "Character cap for the text returned to the model.",
		min: 0,
		unit: "chars",
	},
	{
		id: "webFetch.userAgent",
		scope: "settings",
		category: "tools",
		group: "Web Fetch",
		kind: "text",
		title: "Fetch User Agent",
		description: "User-Agent header sent with web_fetch requests.",
		mono: true,
	},
	{ id: "configFile", scope: "mcp", category: "tools", group: "MCP", kind: "path", title: "MCP Config File", description: "Where MCP servers and options are stored." },
	{
		id: "idleTimeoutSec",
		scope: "mcp",
		category: "tools",
		group: "MCP",
		kind: "number",
		title: "MCP Idle Timeout",
		description: "Seconds before a lazy or eager server is disconnected after last use.",
		min: 0,
		unit: "s",
	},
	{
		id: "defaultLifecycle",
		scope: "mcp",
		category: "tools",
		group: "MCP",
		kind: "select",
		title: "MCP Default Lifecycle",
		description: "Lifecycle used for servers that do not set their own.",
		options: MCP_LIFECYCLES.map((value) => ({ value, label: value })),
	},
	{
		id: "maxBufferSize",
		scope: "mcp",
		category: "tools",
		group: "MCP",
		kind: "number",
		title: "MCP Max Buffer",
		description: "Cap on a single server message.",
		min: 0,
		unit: "bytes",
	},

	{
		id: "skills_dirs",
		scope: "settings",
		category: "skills",
		kind: "dirs",
		title: "Skills Directories",
		description: "Where skills are looked up, relative to the workspace or home.",
	},

	{ id: "memoryEnabled", scope: "settings", category: "memory", group: "Extraction", kind: "switch", title: "Memory", description: "Let the agent write memory while it works." },
	{
		id: "memoryIdleMinutes",
		scope: "settings",
		category: "memory",
		group: "Extraction",
		kind: "number",
		title: "Idle Delay",
		description: "Minutes of quiet before memory extraction runs.",
		min: 0,
		unit: "min",
	},
	{
		id: "memoryPendingRounds",
		scope: "settings",
		category: "memory",
		group: "Extraction",
		kind: "number",
		title: "Rounds Before Organize",
		description: "Rounds a pending memory may wait before it is organized into scenes.",
		min: 0,
		unit: "rounds",
	},
	{
		id: "memoryMaxScenes",
		scope: "settings",
		category: "memory",
		group: "Scenes",
		kind: "number",
		title: "Max Scene Documents",
		description: "Cap on scene documents per partner; older scenes are merged.",
		min: 0,
		unit: "docs",
	},
	{
		id: "memoryDigestMaxItems",
		scope: "settings",
		category: "memory",
		group: "Digest",
		kind: "number",
		title: "Checkpoint Digest Items",
		description: "Max memories carried in a checkpoint digest; the newest events are always reserved.",
		min: 0,
		unit: "items",
	},

	{
		id: "defaultSandboxMode",
		scope: "settings",
		category: "permission",
		kind: "sandbox",
		title: "Default Sandbox Mode",
		description: "Sandbox mode for newly created partners.",
		options: SANDBOX,
	},
	{
		id: "delete.strict",
		scope: "settings",
		category: "permission",
		kind: "switch",
		title: "Strict Delete Mode",
		description: "Refuse rm unless the same path was already moved to the Trash.",
	},

	{ id: "schedulesEnabled", scope: "settings", category: "schedule", kind: "switch", title: "Schedules", description: "Let scheduled messages fire." },
	{
		id: "schedulesDailyCap",
		scope: "settings",
		category: "schedule",
		kind: "number",
		title: "Daily Cap",
		description: "Max schedule runs per day, per partner.",
		min: 0,
		unit: "/ day",
	},
];

const THEME_DEFAULTS: ThemeSettings = { mode: "system", light: "light", dark: "dark" };

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

function eq(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function patchFor(values: Settings, path: string, next: unknown): Partial<Settings> {
	const [head, ...rest] = path.split(".");
	if (head === undefined) return {};
	if (rest.length === 0) return { [head]: next } as Partial<Settings>;
	const section = (values as unknown as Record<string, unknown>)[head];
	return { [head]: setIn(typeof section === "object" && section !== null ? (section as Record<string, unknown>) : {}, rest, next) } as Partial<Settings>;
}

function themeOf(value: unknown): ThemeSettings {
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const theme = record["theme"];
	const source = typeof theme === "object" && theme !== null ? (theme as Record<string, unknown>) : {};
	const mode = source["mode"];
	return {
		mode: mode === "light" || mode === "dark" ? mode : "system",
		light: typeof source["light"] === "string" ? source["light"] : THEME_DEFAULTS.light,
		dark: typeof source["dark"] === "string" ? source["dark"] : THEME_DEFAULTS.dark,
	};
}

function themeSummary(host: DialogProps["host"], theme: ThemeSettings): string {
	const mode = theme.mode === "system" ? "System" : theme.mode === "light" ? "Light" : "Dark";
	const light = host.theme.themes("light").find((entry) => entry.id === theme.light)?.name ?? theme.light;
	const dark = host.theme.themes("dark").find((entry) => entry.id === theme.dark)?.name ?? theme.dark;
	return `${mode} · ${light} / ${dark}`;
}

function formatDuration(ms: number): string {
	if (ms === 0) return "Off";
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function rowKeyOf(field: Field): string {
	return field.scope === "mcp" ? `mcp.${field.id}` : field.id;
}

function fieldByRowKey(key: string): Field | undefined {
	return FIELDS.find((field) => rowKeyOf(field) === key);
}

function optionLabel(field: Field, value: unknown): string {
	return field.options?.find((option) => option.value === String(value))?.label ?? String(value);
}

function valueOf(field: Field, draft: Settings, mcp: McpOptions): unknown {
	return field.scope === "mcp" ? at(mcp, field.id) : at(draft, field.id);
}

function displayValue(field: Field, value: unknown): string {
	switch (field.kind) {
		case "number":
			return `${value ?? ""}${field.unit === undefined ? "" : ` ${field.unit}`}`;
		case "duration":
			return formatDuration(Number(value) || 0);
		case "segments":
		case "sandbox":
		case "select":
			return optionLabel(field, value);
		case "dirs": {
			const count = Array.isArray(value) ? value.length : 0;
			return count === 0 ? "None" : count === 1 ? "1 directory" : `${count} directories`;
		}
		case "switch":
			return value === true ? "On" : "Off";
		default:
			return String(value ?? "—");
	}
}

function highlight(text: string, query: string): ReactNode {
	const needle = query.trim().toLowerCase();
	if (needle === "") return text;
	const index = text.toLowerCase().indexOf(needle);
	if (index < 0) return text;
	return (
		<>
			{text.slice(0, index)}
			<span className="rounded bg-selected text-ink">{text.slice(index, index + needle.length)}</span>
			{text.slice(index + needle.length)}
		</>
	);
}

function optionRowClass(active: boolean): string {
	return `flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-left font-sans text-[12.5px] transition-colors duration-100 ${active ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink"}`;
}

function ThemePanel(props: { host: DialogProps["host"]; value: ThemeSettings; onChange: (next: ThemeSettings) => void }) {
	const appearance = props.host.theme.resolve(props.value.mode);
	const id = appearance === "light" ? props.value.light : props.value.dark;
	const current = props.host.theme.themes(appearance).find((theme) => theme.id === id);
	const note =
		props.value.mode === "system" ? `Following the system — currently ${appearance}. Using ${current?.name ?? id}.` : `Forced ${props.value.mode}. Using ${current?.name ?? id}.`;
	const modes: readonly { value: ThemeMode; label: string }[] = [
		{ value: "system", label: "System" },
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
	];
	return (
		<div className="grid gap-3">
			<div className="inline-flex w-fit gap-0.5 rounded-[8px] border border-line bg-surface p-0.5" role="radiogroup" aria-label="Appearance">
				{modes.map((mode) => {
					const active = props.value.mode === mode.value;
					return (
						<button
							key={mode.value}
							type="button"
							role="radio"
							aria-checked={active}
							className={`cursor-pointer rounded-[6px] px-3 py-1.5 font-sans text-[11.5px] transition-colors duration-100 ${active ? "bg-selected text-ink" : "text-muted hover:text-ink"}`}
							onClick={() => props.onChange({ ...props.value, mode: mode.value })}
						>
							{mode.label}
						</button>
					);
				})}
			</div>
			<div className="font-sans text-[10.5px] text-muted-soft">{note}</div>
			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				{(["light", "dark"] as const).map((slot) => {
					const live = appearance === slot;
					return (
						<section key={slot} className={`overflow-hidden rounded-[9px] border bg-canvas ${live ? "border-accent-teal/40" : "border-line"}`}>
							<div className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5 font-sans text-[10px] tracking-[0.07em] text-muted uppercase">
								<span>{slot}</span>
								{live ? <span className="ml-auto rounded-full bg-hover px-1.5 py-0.5 text-[9px] tracking-[0.04em] text-accent-teal">Active now</span> : null}
							</div>
							<div className="flex flex-col gap-px p-1" role="radiogroup" aria-label={`${slot} theme`}>
								{props.host.theme.themes(slot).map((theme) => {
									const selected = props.value[slot] === theme.id;
									const colors = props.host.theme.swatch(slot, theme.id);
									return (
										<button
											key={theme.id}
											type="button"
											role="radio"
											aria-checked={selected}
											className={`flex w-full cursor-pointer items-center gap-2 rounded-[7px] border px-1.5 py-1 text-left transition-colors duration-100 ${
												selected ? "border-line bg-selected" : "border-transparent hover:bg-hover"
											}`}
											onClick={() => props.onChange({ ...props.value, [slot]: theme.id })}
										>
											<span className={`grid size-[13px] shrink-0 place-items-center rounded-full border-[1.5px] ${selected ? "border-accent-teal" : "border-line-strong"}`}>
												{selected ? <span className="size-[5px] rounded-full bg-accent-teal" /> : null}
											</span>
											<span className="min-w-0 flex-1">
												<span className="block font-sans text-[12.5px] leading-tight text-ink">{theme.name}</span>
												<span className="block font-sans text-[10.5px] leading-tight text-muted">{theme.id === "light" || theme.id === "dark" ? "Built in" : "Extension"}</span>
											</span>
											<span className="flex shrink-0 gap-0.5" aria-hidden="true">
												{colors.map((color, index) => (
													<span key={`${color}-${index}`} className="size-[11px] rounded-[3px] border border-line" style={{ background: color }} />
												))}
											</span>
										</button>
									);
								})}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}

function DirsEditor(props: { values: readonly string[]; onCommit: (next: string[]) => void }) {
	const [rows, setRows] = useState<readonly string[]>(props.values);

	const commit = (next: readonly string[]): void => {
		const cleaned = next.map((row) => row.trim()).filter((row) => row !== "");
		setRows(cleaned);
		if (!eq(cleaned, props.values)) props.onCommit(cleaned);
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
						onChange={(event) => {
							const value = event.currentTarget.value;
							setRows(rows.map((each, at) => (at === index ? value : each)));
						}}
						onBlur={() => commit(rows)}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
							if (event.key === "Escape") {
								setRows(props.values);
								event.currentTarget.blur();
							}
						}}
					/>
					<button type="button" className={LINK} aria-label={`remove skills directory ${index + 1}`} onClick={() => commit(rows.filter((_, at) => at !== index))}>
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

function InlineInput(props: {
	field: Field;
	text: string;
	invalid?: boolean;
	onText: (text: string) => void;
	onCommit: (override?: string) => void;
	onCancel: () => void;
	onPick?: () => void;
}) {
	const numeric = props.field.kind === "number" || props.field.kind === "duration";
	return (
		<span className="inline-flex items-center gap-1.5">
			<input
				autoFocus
				key={props.field.id}
				className={`${FIELD} h-[30px] ${props.invalid === true ? "border-signal" : ""} ${numeric ? "w-[84px] font-mono text-[12px] tabular-nums" : `w-[200px] ${props.field.mono === true ? "font-mono text-[12px]" : ""}`}`}
				value={props.text}
				aria-invalid={props.invalid === true}
				aria-label={props.field.title}
				inputMode={numeric ? "numeric" : undefined}
				spellCheck={false}
				onChange={(event) => props.onText(event.currentTarget.value)}
				onBlur={() => props.onCommit()}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						props.onCommit();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						props.onCancel();
					}
				}}
			/>
			{props.field.unit === undefined ? null : <span className="font-mono text-[9.5px] text-muted">{props.field.unit}</span>}
			{props.onPick === undefined ? null : (
				<button
					type="button"
					tabIndex={-1}
					className="grid size-[30px] cursor-pointer place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
					aria-label={`Choose ${props.field.title}`}
					onMouseDown={(event) => event.preventDefault()}
					onClick={props.onPick}
				>
					<Folder size={13} />
				</button>
			)}
		</span>
	);
}

export function SettingsDialog(props: DialogProps) {
	const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
	const [draft, setDraft] = useState<Settings | null>(null);
	const [mcp, setMcp] = useState<McpOptions | null>(null);
	const [query, setQuery] = useState("");
	const [activeBand, setActiveBand] = useState<CategoryId>("general");
	const [open, setOpen] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const [editError, setEditError] = useState<string | null>(null);
	const [sandboxConfirm, setSandboxConfirm] = useState<string | null>(null);
	const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [, setThemeRevision] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const frame = useRef(0);
	const picking = useRef(false);

	useEffect(() => {
		let cancelled = false;
		props.host.actions
			.request<SettingsSnapshot>("settings.collect")
			.then((next) => {
				if (cancelled || !next) return;
				setSnapshot(next);
				setDraft(clone(next.values));
				setMcp(clone(next.mcp));
				setLoadError(null);
			})
			.catch((error: unknown) => {
				if (!cancelled) setLoadError(reason(error));
			});
		return () => {
			cancelled = true;
		};
	}, [props.host]);

	useEffect(() => {
		let cancelled = false;
		void props.host.actions
			.request<ThemeState>("themes.state")
			.then((state) => {
				if (cancelled) return;
				props.host.theme.hydrate(state);
				setThemeRevision((revision) => revision + 1);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [props.host]);

	useEffect(() => {
		if (query.trim() === "") return;
		scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
	}, [query]);

	const refresh = async (): Promise<void> => {
		const next = await props.host.actions.request<SettingsSnapshot>("settings.collect");
		if (!next) return;
		setSnapshot(next);
		setDraft(clone(next.values));
		setMcp(clone(next.mcp));
	};

	const saveField = (field: Field, next: unknown): void => {
		if (draft === null || mcp === null) return;
		const previous = valueOf(field, draft, mcp);
		setRowError(null);
		if (field.scope === "mcp") {
			const nextMcp = { ...mcp, [field.id]: next } as McpOptions;
			setMcp(nextMcp);
			void props.host.actions.invoke("settings.mcp", undefined, nextMcp).catch((error: unknown) => {
				setMcp((current) => (current === null ? current : ({ ...current, [field.id]: previous } as McpOptions)));
				setRowError({ key: rowKeyOf(field), message: reason(error) });
			});
			return;
		}
		const nextDraft = setIn(draft as unknown as Record<string, unknown>, field.id.split("."), next) as unknown as Settings;
		setDraft(nextDraft);
		const patch = patchFor(draft, field.id, next);
		void props.host.actions.invoke("settings.update", undefined, { patch }).catch((error: unknown) => {
			setDraft((current) => (current === null ? current : (setIn(current as unknown as Record<string, unknown>, field.id.split("."), previous) as unknown as Settings)));
			setRowError({ key: rowKeyOf(field), message: reason(error) });
		});
	};

	const saveTheme = (next: ThemeSettings): void => {
		if (draft === null) return;
		const previous = themeOf(draft);
		setRowError(null);
		setDraft({ ...draft, theme: next } as Settings);
		void props.host.actions
			.invoke("settings.update", undefined, { patch: { theme: next } })
			.then(() => {
				props.host.theme.select(next);
			})
			.catch((error: unknown) => {
				setDraft((current) => (current === null ? current : ({ ...current, theme: previous } as Settings)));
				setRowError({ key: "theme", message: reason(error) });
			});
	};

	const saveProviders = async (patch: Partial<Settings>, credentials?: Record<string, string | null>): Promise<void> => {
		await props.host.actions.invoke("settings.update", undefined, { patch, credentials });
		await refresh();
	};

	const startEdit = (field: Field): void => {
		if (draft === null || mcp === null) return;
		setEditing(rowKeyOf(field));
		setEditText(String(valueOf(field, draft, mcp) ?? ""));
		setEditError(null);
		setRowError(null);
		setOpen(null);
	};

	const commitEditing = (override?: string): boolean => {
		if (editing === null) return true;
		if (draft === null || mcp === null) return true;
		const field = fieldByRowKey(editing);
		if (field === undefined) {
			setEditing(null);
			setEditError(null);
			return true;
		}
		const raw = override ?? editText;
		let value: unknown = raw.trim();
		if (field.kind === "number" || field.kind === "duration") {
			const parsed = Number.parseInt(raw, 10);
			const min = field.min ?? 0;
			if (!Number.isFinite(parsed) || parsed < min) {
				setEditError(`Enter a number ≥ ${min}.`);
				return false;
			}
			value = parsed;
		}
		if (field.kind === "path" && value === "") {
			setEditError("Can't be empty.");
			return false;
		}
		saveField(field, value);
		setEditing(null);
		setEditError(null);
		return true;
	};

	const scrollToBand = (id: CategoryId): void => {
		const element = scrollRef.current;
		const band = element?.querySelector<HTMLElement>(`#band-${id}`);
		if (!element || !band) return;
		const top = band.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
		element.scrollTo({ top, behavior: "smooth" });
	};

	const scrollToRow = (rowKey: string): void => {
		const element = scrollRef.current;
		const row = element?.querySelector<HTMLElement>(`[data-row-key="${rowKey}"]`);
		if (!element || !row) return;
		const top = row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
		element.scrollTo({ top: Math.max(0, top - 96), behavior: "auto" });
	};

	const selectBand = (id: CategoryId): void => {
		setQuery("");
		requestAnimationFrame(() => scrollToBand(id));
	};

	const focusProvider = (id: string): void => {
		setQuery("");
		requestAnimationFrame(() => {
			scrollToRow(`provider:${id}`);
			setOpen(`provider:${id}`);
		});
	};

	const onScroll = (): void => {
		if (frame.current) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			const element = scrollRef.current;
			if (!element) return;
			const top = element.getBoundingClientRect().top;
			let active = CATEGORIES[0].id as CategoryId;
			for (const entry of CATEGORIES) {
				const band = element.querySelector<HTMLElement>(`#band-${entry.id}`);
				if (band !== null && band.getBoundingClientRect().top - top <= 56) active = entry.id;
			}
			setActiveBand(active);
		});
	};

	useEffect(() => {
		return () => {
			if (frame.current) cancelAnimationFrame(frame.current);
		};
	}, []);

	if (draft === null || snapshot === null || mcp === null) {
		return (
			<div className="flex h-[min(760px,88vh)] w-[min(1080px,calc(100vw-64px))] flex-col overflow-hidden bg-surface font-sans text-ink">
				<header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5 pr-12">
					<h2 className="m-0 font-serif text-[17px] font-semibold text-ink">Settings</h2>
				</header>
				<div className="grid min-h-0 flex-1 place-items-center px-6">
					<div className="max-w-[46ch] text-center">
						<p className="m-0 font-sans text-[13px] text-muted">{loadError ?? "Loading settings…"}</p>
						{loadError === null ? null : (
							<button
								type="button"
								className={`${BUTTON_GHOST} mt-3`}
								onClick={() => {
									setLoadError(null);
									void props.host.actions
										.request<SettingsSnapshot>("settings.collect")
										.then((next) => {
											if (!next) return;
											setSnapshot(next);
											setDraft(clone(next.values));
											setMcp(clone(next.mcp));
										})
										.catch((error: unknown) => setLoadError(reason(error)));
								}}
							>
								Retry
							</button>
						)}
					</div>
				</div>
			</div>
		);
	}

	const theme = themeOf(draft);
	const themeNames = [...props.host.theme.themes("light"), ...props.host.theme.themes("dark")].map((entry) => entry.name).join(" ");
	const q = query.trim().toLowerCase();
	const searching = q !== "";
	const fieldMatches = searching ? FIELDS.filter((field) => `${field.title} ${field.description}`.toLowerCase().includes(q)) : [];
	const themeMatches = searching && `Theme Follow the system, or force light or dark. Each appearance uses its own palette. ${themeNames}`.toLowerCase().includes(q);
	const providerMatches = searching ? snapshot.providers.filter((provider) => provider.id.toLowerCase().includes(q)) : [];
	const totalMatches = fieldMatches.length + (themeMatches ? 1 : 0) + providerMatches.length;
	const catMatches = (id: CategoryId): boolean =>
		fieldMatches.some((field) => field.category === id) || (id === "appearance" && themeMatches) || (id === "providers" && providerMatches.length > 0);
	const catMatchCount = (id: CategoryId): number =>
		fieldMatches.filter((field) => field.category === id).length + (id === "appearance" && themeMatches ? 1 : 0) + (id === "providers" ? providerMatches.length : 0);

	const bandCount = (id: CategoryId): string => {
		if (id === "providers") return `${snapshot.providers.length} ${snapshot.providers.length === 1 ? "provider" : "providers"}`;
		if (id === "appearance") return "1 setting";
		const count = FIELDS.filter((field) => field.category === id).length;
		return `${count} ${count === 1 ? "setting" : "settings"}`;
	};

	const renderInlineInput = (field: Field): ReactNode => (
		<InlineInput
			field={field}
			text={editText}
			invalid={editError !== null}
			onText={setEditText}
			onCommit={(override) => {
				if (picking.current) return;
				commitEditing(override);
			}}
			onCancel={() => {
				setEditing(null);
				setEditError(null);
			}}
			onPick={
				field.kind === "path"
					? () => {
							picking.current = true;
							void props.host.picker
								.pick(editText || undefined)
								.then((picked) => {
									picking.current = false;
									if (picked !== null && picked !== undefined && picked !== "") commitEditing(picked);
								})
								.catch(() => {
									picking.current = false;
								});
						}
					: undefined
			}
		/>
	);

	const renderField = (field: Field, searchQuery = ""): ReactNode => {
		const key = rowKeyOf(field);
		const value = valueOf(field, draft, mcp);
		const label = field.scope === "mcp" ? `mcp.${field.id}` : field.id;
		const mono = field.mono === true || field.kind === "number" || field.kind === "duration" || field.kind === "path";

		let control: ReactNode;
		if (field.kind === "switch") {
			control = <Switch checked={value === true} ariaLabel={field.title} onChange={(next) => saveField(field, next)} />;
		} else if (field.kind === "segments" || field.kind === "sandbox") {
			control = (
				<div className="flex items-center gap-1.5">
					<InlineChoices
						value={String(value ?? "")}
						options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
						ariaLabel={field.title}
						onChange={(next) => {
							if (field.kind === "sandbox" && next === "danger-full-access" && value !== next) {
								setSandboxConfirm(key);
								return;
							}
							setSandboxConfirm(null);
							saveField(field, next);
						}}
					/>
					{field.id === "toastPlacement" ? (
						<button
							type="button"
							className="grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
							aria-label="Test notification"
							title="Test notification"
							onClick={() => props.host.notifications.push({ title: "Notification", body: "This is how a notification looks." })}
						>
							<Bell size={13} />
						</button>
					) : null}
				</div>
			);
		} else if (field.kind === "duration") {
			const duration = Number(value) || 0;
			const presets = [0, 4000, 8000];
			const isPreset = presets.includes(duration);
			control =
				editing === key ? (
					renderInlineInput(field)
				) : (
					<InlineChoices
						value={isPreset ? duration : -1}
						options={[
							{ value: 0, label: "Off", mono: true },
							{ value: 4000, label: "4s", mono: true },
							{ value: 8000, label: "8s", mono: true },
							{ value: -1, label: isPreset ? "Custom" : formatDuration(duration), mono: true },
						]}
						ariaLabel={field.title}
						onChange={(next) => {
							if (next === -1) startEdit(field);
							else saveField(field, next);
						}}
					/>
				);
		} else if (field.kind === "number" || field.kind === "text" || field.kind === "path") {
			control = editing === key ? renderInlineInput(field) : <ValueButton value={displayValue(field, value)} mono={mono} mode="edit" onClick={() => startEdit(field)} />;
		} else {
			control = <ValueButton value={displayValue(field, value)} mode="panel" expanded={open === key} onClick={() => setOpen(open === key ? null : key)} />;
		}

		const messages: ReactNode[] = [];
		if (editing === key && editError !== null)
			messages.push(
				<div className="font-mono text-[10px] text-signal" key="edit">
					{editError}
				</div>,
			);
		if (rowError?.key === key)
			messages.push(
				<div className="font-mono text-[10px] text-signal" key="save">
					{rowError.message}
				</div>,
			);
		if (sandboxConfirm === key) {
			messages.push(
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-signal/40 bg-signal/5 px-3 py-2.5" key="confirm">
					<p className="m-0 max-w-[62ch] text-[12px] leading-snug text-ink">Full access lets every tool write outside the workspace, including files you did not open. Continue?</p>
					<span className="flex shrink-0 gap-1.5">
						<button type="button" className={BUTTON_GHOST} onClick={() => setSandboxConfirm(null)}>
							Cancel
						</button>
						<button
							type="button"
							className={BUTTON_PRIMARY}
							onClick={() => {
								saveField(field, "danger-full-access");
								setSandboxConfirm(null);
							}}
						>
							Use full access
						</button>
					</span>
				</div>,
			);
		}
		const inline = messages.length === 0 ? undefined : <div className="grid gap-1.5">{messages}</div>;

		const panel =
			open === key ? (
				<SheetPanel label={label}>
					{field.kind === "dirs" ? (
						<DirsEditor
							key={Array.isArray(value) ? (value as string[]).join("|") : ""}
							values={Array.isArray(value) ? (value as string[]) : []}
							onCommit={(next) => saveField(field, next)}
						/>
					) : field.kind === "select" ? (
						<div className="grid gap-0.5">
							{(field.options ?? []).map((option) => {
								const active = String(value ?? "") === option.value;
								return (
									<button
										key={option.value}
										type="button"
										role="radio"
										aria-checked={active}
										className={optionRowClass(active)}
										onClick={() => {
											saveField(field, option.value);
											setOpen(null);
										}}
									>
										<span className="font-mono text-[11.5px]">{option.label}</span>
										{active ? <Check size={12} className="ml-auto" /> : null}
									</button>
								);
							})}
						</div>
					) : null}
				</SheetPanel>
			) : undefined;

		return (
			<SheetRow
				key={key}
				rowKey={key}
				title={searchQuery === "" ? field.title : highlight(field.title, searchQuery)}
				description={searchQuery === "" ? field.description : highlight(field.description, searchQuery)}
				control={control}
				panel={panel}
				inline={inline}
			/>
		);
	};

	const themeRow = (searchQuery = ""): ReactNode => (
		<SheetRow
			rowKey="theme"
			title={searchQuery === "" ? "Theme" : highlight("Theme", searchQuery)}
			description={
				searchQuery === ""
					? "Follow the system, or force light or dark. Each appearance uses its own palette."
					: highlight("Follow the system, or force light or dark. Each appearance uses its own palette.", searchQuery)
			}
			control={<ValueButton value={themeSummary(props.host, theme)} mode="panel" expanded={open === "theme"} onClick={() => setOpen(open === "theme" ? null : "theme")} />}
			inline={rowError?.key === "theme" ? <div className="font-mono text-[10px] text-signal">{rowError.message}</div> : undefined}
			panel={
				open === "theme" ? (
					<SheetPanel label="theme">
						<ThemePanel host={props.host} value={theme} onChange={saveTheme} />
					</SheetPanel>
				) : undefined
			}
		/>
	);

	const providerRow = (provider: ProviderRow, searchQuery = ""): ReactNode => (
		<SheetRow
			key={`search-provider-${provider.id}`}
			rowKey={`provider:${provider.id}`}
			title={searchQuery === "" ? provider.id : highlight(provider.id, searchQuery)}
			description={
				<span>
					<span className="font-mono text-[10.5px] tracking-[-0.01em]">{provider.baseUrl ?? "—"}</span>
					<span> · {provider.modelCount} models</span>
				</span>
			}
			control={<ValueButton value={provider.configured ? "Key set" : "No key"} mode="panel" onClick={() => focusProvider(provider.id)} />}
		/>
	);

	const renderBand = (id: CategoryId, searchQuery = ""): ReactNode => {
		if (id === "appearance") return themeRow(searchQuery);
		if (id === "providers") {
			return <ProvidersBand snapshot={snapshot} save={saveProviders} open={open} onOpen={setOpen} />;
		}
		const fields = FIELDS.filter((field) => field.category === id);
		const groups = new Map<string, Field[]>();
		for (const field of fields) {
			const name = field.group ?? "";
			const list = groups.get(name);
			if (list === undefined) groups.set(name, [field]);
			else list.push(field);
		}
		return [...groups.entries()].map(([name, list]) => (
			<div key={name}>
				{name === "" ? null : <div className="mt-4 mb-px font-mono text-[9px] tracking-[0.14em] text-muted-soft uppercase">{name}</div>}
				{list.map((field) => renderField(field, searchQuery))}
			</div>
		));
	};

	const renderSearch = (): ReactNode => {
		if (totalMatches === 0) {
			return (
				<div className="pt-10 text-center">
					<div className="font-serif text-[14px] text-ink-soft">No matching settings</div>
					<div className="mt-1 font-sans text-[12px] text-muted">Try a different search.</div>
				</div>
			);
		}
		return CATEGORIES.map((category, index) => {
			if (!catMatches(category.id)) return null;
			return (
				<section key={category.id} id={`band-${category.id}`}>
					<header className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-line bg-surface pt-[18px] pb-[9px]">
						<span className="font-mono text-[9px] tracking-[0.14em] text-muted-soft">{String(index + 1).padStart(2, "0")}</span>
						<h2 className="m-0 font-serif text-[21px] leading-tight font-medium tracking-[-0.015em] text-ink">{category.label}</h2>
						<span className="ml-auto font-mono text-[9px] tracking-[0.06em] text-muted-soft">
							{catMatchCount(category.id)} {catMatchCount(category.id) === 1 ? "match" : "matches"}
						</span>
					</header>
					<div>
						{category.id === "appearance" && themeMatches ? themeRow(q) : null}
						{fieldMatches.filter((field) => field.category === category.id).map((field) => renderField(field, q))}
						{category.id === "providers" ? providerMatches.map((provider) => providerRow(provider, q)) : null}
					</div>
				</section>
			);
		});
	};

	return (
		<div
			className="flex h-[min(760px,88vh)] w-[min(1080px,calc(100vw-64px))] flex-col overflow-hidden bg-surface font-sans text-ink"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				if (open !== null) {
					event.preventDefault();
					event.stopPropagation();
					setOpen(null);
					return;
				}
				if (editing !== null) {
					event.preventDefault();
					event.stopPropagation();
					setEditing(null);
					setEditError(null);
					return;
				}
				if (sandboxConfirm !== null) {
					event.preventDefault();
					event.stopPropagation();
					setSandboxConfirm(null);
					return;
				}
				if (query !== "") {
					event.preventDefault();
					event.stopPropagation();
					setQuery("");
				}
			}}
		>
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5 pr-12">
				<h2 className="m-0 font-serif text-[17px] font-semibold text-ink">Settings</h2>
				<p className="m-0 font-sans text-[12px] text-muted">Saved as you go.</p>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav className="hidden w-[216px] shrink-0 flex-col gap-0.5 border-r border-line px-3 pt-4 pb-3.5 md:flex" aria-label="Settings sections">
					<div className="px-2.5 pb-2 font-mono text-[9px] tracking-[0.14em] text-muted-soft uppercase">Sections</div>
					{CATEGORIES.map((entry, index) => {
						const active = !searching && activeBand === entry.id;
						const matched = searching && catMatches(entry.id);
						return (
							<button
								key={entry.id}
								type="button"
								aria-current={active ? "true" : undefined}
								className={`flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-left font-sans text-[12.5px] transition-colors duration-100 ${
									active ? "bg-selected text-ink" : matched ? "text-ink hover:bg-hover" : "text-ink-soft hover:bg-hover hover:text-ink"
								}`}
								onClick={() => selectBand(entry.id)}
							>
								<span className="w-[15px] shrink-0 font-mono text-[9px] text-muted-soft">{String(index + 1).padStart(2, "0")}</span>
								{entry.label}
								{matched ? <span className="ml-auto size-[5px] shrink-0 rounded-full bg-signal" /> : null}
							</button>
						);
					})}
				</nav>

				<div className="flex min-w-0 flex-1 flex-col">
					<div className="shrink-0 px-6 pt-3 pb-2 md:px-10">
						<div className="relative">
							<Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
							<input
								autoFocus
								className={`${FIELD} h-9 pr-20 pl-9`}
								placeholder="Search settings"
								aria-label="Search settings"
								spellCheck={false}
								value={query}
								onChange={(event) => {
									setQuery(event.currentTarget.value);
									setOpen(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape" && query.trim() !== "") {
										event.preventDefault();
										event.stopPropagation();
										setQuery("");
									}
								}}
							/>
							{searching ? (
								<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[10px] text-muted">
									{totalMatches} {totalMatches === 1 ? "match" : "matches"}
								</span>
							) : null}
						</div>
					</div>

					<div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 md:px-10">
						<div className="mx-auto w-full max-w-[860px]">
							{searching
								? renderSearch()
								: CATEGORIES.map((entry, index) => (
										<section key={entry.id} id={`band-${entry.id}`}>
											<header className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-line bg-surface pt-[22px] pb-[9px]">
												<span className="font-mono text-[9px] tracking-[0.14em] text-muted-soft">{String(index + 1).padStart(2, "0")}</span>
												<h2 className="m-0 font-serif text-[23px] leading-tight font-medium tracking-[-0.015em] text-ink">{entry.label}</h2>
												<span className="ml-auto font-mono text-[9px] tracking-[0.06em] text-muted-soft">{bandCount(entry.id)}</span>
											</header>
											<p className="mt-3 mb-1.5 max-w-[60ch] font-sans text-[12.5px] leading-relaxed text-muted">{entry.intro}</p>
											{renderBand(entry.id)}
										</section>
									))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default SettingsDialog;
