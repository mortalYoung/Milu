import { createEffect, createMemo, createSignal, For, Index, indexArray, type JSX, Show } from "solid-js";
import type { CustomModel, CustomProvider, SandboxMode, ThemeMode, ToastPlacement } from "../../shared/rpc";
import { Button } from "../components/Button";
import { McpSettingsPanel } from "../components/McpSettingsPanel";
import { PickFile } from "../components/PickFile";
import { Select } from "../components/ui/select";
import { Switch as SwitchToggle } from "../components/ui/switch";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { useSettings } from "../lib/contexts/settings-context";
import { cn } from "../lib/utils";

export interface SettingsData {
	partner_profile_path: string;
	detect_instructions_file: string;
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	customProviders?: CustomProvider[];
	theme?: ThemeMode;
	toastPlacement?: ToastPlacement;
	dockSide?: "left" | "right";
	toastDurationMs?: number;
	skills_dirs?: string[];
	skills_watch?: boolean;
	skills_watch_delay_ms?: number;
	sendMessageIntervalSec?: number | null;
	shellContinuous?: boolean;
	memoryEnabled?: boolean;
	memoryIdleMinutes?: number;
	memoryMaxScenes?: number;
	commands_path?: string;
	retry?: { maxRetries?: number; baseDelayMs?: number };
	webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
	compaction?: {
		thresholdRatio?: number;
		digestMaxItems?: number;
		maxOverflowRetries?: number;
		prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
	};
	explorer?: { lineGap?: number };
	palette?: { searchIgnoreDirs?: string[] };
}

export interface RuntimeInfo {
	providers: { id: string; configured: boolean; baseUrl?: string; modelCount: number }[];
	allProviders: string[];
}

export interface SaveResult {
	ok: boolean;
	error?: string;
}

const CATS = [
	{ id: "general", label: "General" },
	{ id: "memory", label: "Memory" },
	{ id: "skills", label: "Skills" },
	{ id: "mcp", label: "MCP" },
	{ id: "webFetch", label: "Web Fetch" },
	{ id: "explorer", label: "Explorer" },
	{ id: "palette", label: "Palette" },
	{ id: "compaction", label: "Compaction" },
	{ id: "permission", label: "Permission" },
	{ id: "providers", label: "Providers" },
	{ id: "retry", label: "Retry" },
] as const;
type CatId = (typeof CATS)[number]["id"];

const DEFAULTS = {
	path: "~/.partner/",
	instructions: "AGENTS.md",
	commandsPath: "~/.config/letters/commands",
	retryMaxRetries: 2,
	retryBaseDelayMs: 500,
	theme: "system" as ThemeMode,
	sandbox: "workspace-write" as SandboxMode,
	toastPlacement: "bottomcenter" as ToastPlacement,
	dockSide: "right" as "left" | "right",
	toastDurationMs: 4000,
	skills_dirs: [".agents/skills"],
	skills_watch: true,
	skills_watch_delay_ms: 300,
	shellContinuous: true,
	memoryEnabled: true,
	memoryIdleMinutes: 5,
	memoryMaxScenes: 15,
	explorerLineGap: 0.2,
};

const EMPTY_CP = { id: "", name: "", baseUrl: "", models: [{ id: "", window: "" }], window: "", maxTokens: "" };
type CpForm = typeof EMPTY_CP;
type CpModelRow = CpForm["models"][number];

const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_56px_76px] items-center gap-2";

function SettingRow(props: { title: string; desc: string; modified?: boolean; q?: string; stacked?: boolean; children: JSX.Element }) {
	const head = () => (
		<div class="flex items-center gap-2">
			<span class="font-serif text-[13px] leading-tight text-ink">{props.q ? highlight(props.title, props.q) : props.title}</span>
			<Show when={props.modified}>
				<span class="flex items-center gap-1.5">
					<span class="size-[5px] shrink-0 rounded-full bg-seal" />
					<span class="font-sans text-[10px] font-medium text-seal">modified</span>
				</span>
			</Show>
		</div>
	);
	const body = () => <div class="mt-1 font-sans text-[11px] leading-snug text-body-muted">{props.q ? highlight(props.desc, props.q) : props.desc}</div>;
	if (props.stacked) {
		return (
			<div class="py-3.5">
				{head()}
				{body()}
				<div class="mt-3">{props.children}</div>
			</div>
		);
	}
	return (
		<div class="flex items-center gap-6 py-3.5">
			<div class="min-w-0 flex-1">
				{head()}
				{body()}
			</div>
			<div class="shrink-0">{props.children}</div>
		</div>
	);
}

function highlight(text: string, q: string): JSX.Element {
	const idx = text.toLowerCase().indexOf(q);
	if (idx < 0) return text;
	return (
		<>
			{text.slice(0, idx)}
			<span class="text-seal">{text.slice(idx, idx + q.length)}</span>
			{text.slice(idx + q.length)}
		</>
	);
}

function buildModels(rows: CpModelRow[]): CustomModel[] {
	return rows
		.filter((r) => r.id.trim())
		.map((r) => {
			const window = Number(r.window);
			return { id: r.id.trim(), ...(r.window.trim() && Number.isFinite(window) ? { contextWindow: window } : {}) };
		});
}

function ModelRows(props: { rows: CpModelRow[]; onChange: (rows: CpModelRow[]) => void }) {
	const items = indexArray<CpModelRow, JSX.Element>(
		() => props.rows,
		(row, i) => (
			<div class="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 py-2">
				<TextField class="min-w-0" value={row().id} onChange={(v) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, id: v } : r)))}>
					<TextFieldInput variant="compact" class="w-full" placeholder="model id" aria-label="Model id" spellcheck={false} />
				</TextField>
				<TextField class="w-[120px]" value={row().window} onChange={(v) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, window: v } : r)))}>
					<TextFieldInput variant="compact" class="w-full text-[10px]" placeholder="optional" aria-label="Context window" spellcheck={false} />
				</TextField>
				<button
					type="button"
					class="flex h-6 w-6 items-center justify-center rounded-[8px] font-sans text-[14px] leading-none text-muted transition-colors hover:bg-paper-hover hover:text-ink"
					aria-label={`remove model ${row().id || i + 1}`}
					onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}
				>
					×
				</button>
			</div>
		),
	);
	return (
		<div class="grid gap-1">
			<span class="font-sans text-[10px] font-medium uppercase tracking-[0.6px] text-muted">Models</span>
			<div class="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 px-1 font-sans text-[10px] text-muted">
				<span>Model</span>
				<span>Context window</span>
				<span />
			</div>
			<div class="divide-y divide-hairline rounded-[10px] border border-hairline px-3">{items()}</div>
			<button
				type="button"
				class="-mx-2 justify-self-start rounded-[8px] px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
				onClick={() => props.onChange([...props.rows, { id: "", window: "" }])}
			>
				+ add model
			</button>
		</div>
	);
}

function Field(props: { label: string; children: JSX.Element }) {
	return (
		<div class="grid gap-1">
			<span class="font-sans text-[10px] font-medium uppercase tracking-[0.6px] text-muted">{props.label}</span>
			{props.children}
		</div>
	);
}

export function SettingsView() {
	const settingsView = useSettings();
	const settingsData = () => settingsView.data()?.settings ?? null;
	const runtime = () => settingsView.data()?.runtime ?? null;
	const initial = settingsData();
	const [tab, setTab] = createSignal<CatId>("general");
	const [query, setQuery] = createSignal("");
	const [path, setPath] = createSignal("");
	const [commandsPath, setCommandsPath] = createSignal("");
	const [retryMaxRetries, setRetryMaxRetries] = createSignal("2");
	const [retryBaseDelayMs, setRetryBaseDelayMs] = createSignal("500");
	const [webFetchTimeout, setWebFetchTimeout] = createSignal("15000");
	const [webFetchMaxBytes, setWebFetchMaxBytes] = createSignal("1000000");
	const [webFetchMaxChars, setWebFetchMaxChars] = createSignal("50000");
	const [webFetchUserAgent, setWebFetchUserAgent] = createSignal("Letters-web-fetch/0.1");
	const [compactionThreshold, setCompactionThreshold] = createSignal("0.8");
	const [compactionDigestMaxItems, setCompactionDigestMaxItems] = createSignal("10");
	const [compactionOverflowRetries, setCompactionOverflowRetries] = createSignal("1");
	const [explorerLineGap, setExplorerLineGap] = createSignal("0.2");
	const [paletteIgnoreDirs, setPaletteIgnoreDirs] = createSignal("");
	const [instructionsFile, setInstructionsFile] = createSignal("");
	const [defaultSandboxMode, setDefaultSandboxMode] = createSignal<SandboxMode>("workspace-write");
	const [theme, setTheme] = createSignal<ThemeMode>("system");
	const [toastPlacement, setToastPlacement] = createSignal<ToastPlacement>("bottomcenter");
	const [dockSide, setDockSide] = createSignal<"left" | "right">("right");
	const [toastDurationMs, setToastDurationMs] = createSignal("4000");
	const [skillsDirs, setSkillsDirs] = createSignal<string[]>(initial?.skills_dirs?.length ? initial.skills_dirs : [".agents/skills"]);
	const [skillsWatch, setSkillsWatch] = createSignal(initial?.skills_watch ?? true);
	const [skillsWatchDelay, setSkillsWatchDelay] = createSignal(String(initial?.skills_watch_delay_ms ?? 300));
	const [shellContinuous, setShellContinuous] = createSignal(initial?.shellContinuous ?? true);
	const [memoryEnabled, setMemoryEnabled] = createSignal(initial?.memoryEnabled ?? true);
	const [memoryIdleMinutes, setMemoryIdleMinutes] = createSignal(String(initial?.memoryIdleMinutes ?? 5));
	const [memoryMaxScenes, setMemoryMaxScenes] = createSignal(String(initial?.memoryMaxScenes ?? 15));

	function persistSkillsDirs() {
		const dirs = skillsDirs()
			.map((d) => d.trim())
			.filter(Boolean);
		setSkillsDirs(dirs);
		void persist({ ...currentSettings(), skills_dirs: dirs });
	}

	createEffect(() => {
		const s = settingsData();
		if (!s) return;
		if (s.webFetch?.timeoutMs !== undefined) setWebFetchTimeout(String(s.webFetch.timeoutMs));
		if (s.webFetch?.maxBytes !== undefined) setWebFetchMaxBytes(String(s.webFetch.maxBytes));
		if (s.webFetch?.maxChars !== undefined) setWebFetchMaxChars(String(s.webFetch.maxChars));
		if (s.webFetch?.userAgent !== undefined) setWebFetchUserAgent(s.webFetch.userAgent);
		if (s.compaction?.thresholdRatio !== undefined) setCompactionThreshold(String(s.compaction.thresholdRatio));
		if (s.compaction?.digestMaxItems !== undefined) setCompactionDigestMaxItems(String(s.compaction.digestMaxItems));
		if (s.compaction?.maxOverflowRetries !== undefined) setCompactionOverflowRetries(String(s.compaction.maxOverflowRetries));
		if (s.explorer?.lineGap !== undefined) setExplorerLineGap(String(s.explorer.lineGap));
	});
	function updateSkillsDir(i: number, v: string) {
		setSkillsDirs((prev) => prev.map((d, idx) => (idx === i ? v : d)));
	}
	function addSkillsDir() {
		setSkillsDirs((prev) => [...prev, ""]);
	}
	function removeSkillsDir(i: number) {
		setSkillsDirs((prev) => prev.filter((_, idx) => idx !== i));
		persistSkillsDirs();
	}

	const [deliveryMode, setDeliveryMode] = createSignal<"unlimited" | "custom">("unlimited");
	const [deliverySec, setDeliverySec] = createSignal("20");
	const [added, setAdded] = createSignal<string[]>([]);
	const [customProviders, setCustomProviders] = createSignal<CustomProvider[] | null>(null);
	const [toAdd, setToAdd] = createSignal("");

	const [keys, setKeys] = createSignal<Record<string, string>>({});
	const [error, setError] = createSignal<string | null>(null);
	let errorTimer: ReturnType<typeof setTimeout> | undefined;
	let rootRef: HTMLDivElement | undefined;

	const [adding, setAdding] = createSignal(false);
	const [addKind, setAddKind] = createSignal<"builtin" | "custom">("builtin");
	const [cpAdvanced, setCpAdvanced] = createSignal(false);
	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editAdvanced, setEditAdvanced] = createSignal(false);
	const [keyEditId, setKeyEditId] = createSignal<string | null>(null);
	const [keyDraft, setKeyDraft] = createSignal("");
	const [cp, setCp] = createSignal({ ...EMPTY_CP });

	if (initial && path() === "" && initial.partner_profile_path !== path()) {
		setPath(initial.partner_profile_path);
	}
	if (initial && instructionsFile() === "" && initial.detect_instructions_file !== instructionsFile()) {
		setInstructionsFile(initial.detect_instructions_file);
	}
	if (initial && commandsPath() === "") {
		setCommandsPath(initial.commands_path?.trim() ? initial.commands_path : DEFAULTS.commandsPath);
	}
	if (initial && initial.retry?.maxRetries !== undefined && retryMaxRetries() === "2") {
		setRetryMaxRetries(String(initial.retry.maxRetries));
	}
	if (initial && initial.retry?.baseDelayMs !== undefined && retryBaseDelayMs() === "500") {
		setRetryBaseDelayMs(String(initial.retry.baseDelayMs));
	}
	if (initial && initial.webFetch?.timeoutMs !== undefined && webFetchTimeout() === "15000") {
		setWebFetchTimeout(String(initial.webFetch.timeoutMs));
	}
	if (initial && initial.webFetch?.maxBytes !== undefined && webFetchMaxBytes() === "1000000") {
		setWebFetchMaxBytes(String(initial.webFetch.maxBytes));
	}
	if (initial && initial.webFetch?.maxChars !== undefined && webFetchMaxChars() === "50000") {
		setWebFetchMaxChars(String(initial.webFetch.maxChars));
	}
	if (initial && initial.webFetch?.userAgent !== undefined && webFetchUserAgent() === "Letters-web-fetch/0.1") {
		setWebFetchUserAgent(initial.webFetch.userAgent);
	}
	if (initial && initial.compaction?.thresholdRatio !== undefined && compactionThreshold() === "0.8") {
		setCompactionThreshold(String(initial.compaction.thresholdRatio));
	}
	if (initial && initial.compaction?.digestMaxItems !== undefined && compactionDigestMaxItems() === "10") {
		setCompactionDigestMaxItems(String(initial.compaction.digestMaxItems));
	}
	if (initial && initial.compaction?.maxOverflowRetries !== undefined && compactionOverflowRetries() === "1") {
		setCompactionOverflowRetries(String(initial.compaction.maxOverflowRetries));
	}
	if (initial && initial.explorer?.lineGap !== undefined && explorerLineGap() === "0.2") {
		setExplorerLineGap(String(initial.explorer.lineGap));
	}
	if (initial && initial.palette?.searchIgnoreDirs !== undefined && paletteIgnoreDirs() === "") {
		setPaletteIgnoreDirs(initial.palette.searchIgnoreDirs.join(", "));
	}
	if (initial && initial.defaultSandboxMode && defaultSandboxMode() !== initial.defaultSandboxMode) {
		setDefaultSandboxMode(initial.defaultSandboxMode);
	}
	if (initial && initial.theme !== undefined && theme() !== initial.theme) {
		setTheme(initial.theme);
	}
	if (initial && initial.toastPlacement !== undefined && toastPlacement() !== initial.toastPlacement) {
		setToastPlacement(initial.toastPlacement);
	}
	if (initial && initial.dockSide !== undefined && dockSide() !== initial.dockSide) {
		setDockSide(initial.dockSide);
	}
	if (initial && initial.toastDurationMs !== undefined && toastDurationMs() === "4000") {
		setToastDurationMs(String(initial.toastDurationMs));
	}
	if (initial && initial.skills_dirs !== undefined && JSON.stringify(initial.skills_dirs) !== JSON.stringify(skillsDirs())) {
		setSkillsDirs(initial.skills_dirs);
	}
	if (initial && typeof initial.skills_watch === "boolean" && initial.skills_watch !== skillsWatch()) {
		setSkillsWatch(initial.skills_watch);
	}
	if (initial && typeof initial.skills_watch_delay_ms === "number" && String(initial.skills_watch_delay_ms) !== skillsWatchDelay()) {
		setSkillsWatchDelay(String(initial.skills_watch_delay_ms));
	}
	if (initial && typeof initial.shellContinuous === "boolean" && initial.shellContinuous !== shellContinuous()) {
		setShellContinuous(initial.shellContinuous);
	}
	if (initial && typeof initial.memoryEnabled === "boolean" && initial.memoryEnabled !== memoryEnabled()) {
		setMemoryEnabled(initial.memoryEnabled);
	}
	if (initial && typeof initial.memoryMaxScenes === "number" && String(initial.memoryMaxScenes) !== memoryMaxScenes()) {
		setMemoryMaxScenes(String(initial.memoryMaxScenes));
	}
	if (initial && typeof initial.memoryIdleMinutes === "number" && String(initial.memoryIdleMinutes) !== memoryIdleMinutes()) {
		setMemoryIdleMinutes(String(initial.memoryIdleMinutes));
	}

	if (initial && typeof initial.sendMessageIntervalSec === "number" && deliveryMode() === "unlimited") {
		setDeliveryMode("custom");
		setDeliverySec(String(initial.sendMessageIntervalSec));
	}
	if (initial && added().length === 0 && initial.providers?.length) {
		setAdded(initial.providers);
	}
	if (initial && customProviders() === null && initial.customProviders) {
		setCustomProviders(initial.customProviders);
	}

	const parsedDeliverySec = () => {
		const n = parseInt(deliverySec(), 10);
		return Number.isFinite(n) ? Math.max(20, n) : 20;
	};
	const parsePositiveInt = (value: string, fallback: number) => {
		const n = parseInt(value, 10);
		return Number.isFinite(n) && n >= 0 ? n : fallback;
	};
	const parseIgnoreDirs = () =>
		paletteIgnoreDirs()
			.split(/[,\n]/)
			.map((name) => name.trim())
			.filter(Boolean);

	const currentSettings = (): SettingsData => {
		const current = settingsData();
		return {
			partner_profile_path: path().trim() || "~/.partner/",
			detect_instructions_file: instructionsFile().trim() || "AGENTS.md",
			defaultSandboxMode: defaultSandboxMode(),
			providers: added(),
			customProviders: customProviders() ?? undefined,
			theme: theme(),
			toastPlacement: toastPlacement(),
			dockSide: dockSide(),
			toastDurationMs: parsePositiveInt(toastDurationMs(), DEFAULTS.toastDurationMs),
			skills_dirs: skillsDirs()
				.map((d) => d.trim())
				.filter(Boolean),
			skills_watch: skillsWatch(),
			skills_watch_delay_ms: parsePositiveInt(skillsWatchDelay(), DEFAULTS.skills_watch_delay_ms),
			sendMessageIntervalSec: deliveryMode() === "unlimited" ? null : parsedDeliverySec(),
			shellContinuous: shellContinuous(),
			memoryEnabled: memoryEnabled(),
			memoryIdleMinutes: parsePositiveInt(memoryIdleMinutes(), DEFAULTS.memoryIdleMinutes),
			memoryMaxScenes: parsePositiveInt(memoryMaxScenes(), DEFAULTS.memoryMaxScenes),
			commands_path: commandsPath().trim() || undefined,
			retry: {
				maxRetries: parsePositiveInt(retryMaxRetries(), DEFAULTS.retryMaxRetries),
				baseDelayMs: parsePositiveInt(retryBaseDelayMs(), DEFAULTS.retryBaseDelayMs),
			},
			webFetch: {
				timeoutMs: parsePositiveInt(webFetchTimeout(), 15000),
				maxBytes: parsePositiveInt(webFetchMaxBytes(), 1_000_000),
				maxChars: parsePositiveInt(webFetchMaxChars(), 50_000),
				userAgent: webFetchUserAgent().trim() || undefined,
			},
			compaction: {
				thresholdRatio: Number(compactionThreshold()) || 0.8,
				digestMaxItems: parsePositiveInt(compactionDigestMaxItems(), 10),
				maxOverflowRetries: parsePositiveInt(compactionOverflowRetries(), 1),
				...(current?.compaction?.prune ? { prune: current.compaction.prune } : {}),
			},
			explorer: {
				lineGap: Number(explorerLineGap()) || DEFAULTS.explorerLineGap,
			},
			...(parseIgnoreDirs().length > 0 ? { palette: { searchIgnoreDirs: parseIgnoreDirs() } } : {}),
		};
	};
	const flashError = (message: string) => {
		setError(message);
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => setError(null), 3000);
	};
	let saveChain: Promise<unknown> = Promise.resolve();

	const persist = async (settings: SettingsData, credentials?: Record<string, string>): Promise<boolean> => {
		const run = saveChain.then(() => settingsView.mutate.save(settings, credentials ?? {}));
		saveChain = run.catch(() => {});
		const res = await run;
		if (!res.ok) {
			flashError(res.error ?? "保存失败");
			return false;
		}
		return true;
	};

	const configured = (id: string) => runtime()?.providers.find((p) => p.id === id)?.configured ?? false;
	const runtimeRow = (id: string) => runtime()?.providers.find((p) => p.id === id);
	const addable = () => {
		const builtin = (runtime()?.allProviders ?? []).filter((p) => !added().includes(p));
		const custom = (customProviders() ?? []).map((d) => d.id).filter((id) => !added().includes(id));
		return [...builtin, ...custom];
	};
	const add = async () => {
		const id = toAdd() || addable()[0];
		const key = keys()[id];
		if (!id || !key) return;
		const nextProviders = [...added(), id];
		const ok = await persist({ ...currentSettings(), providers: nextProviders }, { [id]: key });
		if (!ok) return;
		setAdded(nextProviders);
		setToAdd("");
		setKeys((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		setAdding(false);
	};
	const remove = async (id: string) => {
		const nextProviders = added().filter((p) => p !== id);
		const nextCustom = (customProviders() ?? []).filter((d) => d.id !== id);
		const ok = await persist({
			...currentSettings(),
			providers: nextProviders,
			customProviders: nextCustom,
		});
		if (!ok) return;
		setAdded(nextProviders);
		setCustomProviders(nextCustom);
	};

	const customDef = (id: string) => customProviders()?.find((d) => d.id === id);
	const tableRows = createMemo(() => {
		const pending = (customProviders() ?? []).map((d) => d.id).filter((id) => !added().includes(id));
		return [...added(), ...pending];
	});
	const rowBaseUrl = (id: string) => runtimeRow(id)?.baseUrl ?? customDef(id)?.baseUrl;
	const rowModelCount = (id: string) => runtimeRow(id)?.modelCount ?? customDef(id)?.models.length ?? 0;
	const resetCp = () => {
		setCp({ ...EMPTY_CP });
		setCpAdvanced(false);
		setEditAdvanced(false);
	};
	const applyCustom = async () => {
		const id = cp().id.trim();
		const models = buildModels(cp().models);
		if (!id || !cp().baseUrl.trim() || models.length === 0) return;
		if ((customProviders() ?? []).some((d) => d.id === id)) {
			flashError(`Duplicate provider id "${id}".`);
			return;
		}
		const def: CustomProvider = {
			id,
			...(cp().name.trim() ? { name: cp().name.trim() } : {}),
			baseUrl: cp().baseUrl.trim(),
			models,
			...(cp().window.trim() && Number.isFinite(Number(cp().window)) ? { defaultContextWindow: Number(cp().window) } : {}),
			...(cp().maxTokens.trim() && Number.isFinite(Number(cp().maxTokens)) ? { defaultMaxTokens: Number(cp().maxTokens) } : {}),
		};
		const list = [...(customProviders() ?? []), def];
		const ok = await persist({ ...currentSettings(), customProviders: list });
		if (!ok) return;
		setCustomProviders(list);
		setAddKind("builtin");
		setToAdd(id);
		resetCp();
	};
	const toggleKey = (id: string) => {
		if (keyEditId() === id) {
			setKeyEditId(null);
			setKeyDraft("");
			return;
		}
		setEditingId(null);
		setAdding(false);
		setKeyDraft("");
		setKeyEditId(id);
	};
	const saveKey = async () => {
		const id = keyEditId();
		if (!id || !keyDraft().trim()) return;
		const ok = await persist(currentSettings(), { [id]: keyDraft().trim() });
		if (!ok) return;
		setKeyDraft("");
		setKeyEditId(null);
	};
	const clearKey = async () => {
		const id = keyEditId();
		if (!id) return;
		const ok = await persist(currentSettings(), { [id]: "" });
		if (!ok) return;
		setKeyDraft("");
		setKeyEditId(null);
	};
	const startEdit = (def: CustomProvider) => {
		setAdding(false);
		setAddKind("builtin");
		setKeyEditId(null);
		setCp({
			id: def.id,
			name: def.name ?? "",
			baseUrl: def.baseUrl,
			models: def.models.length ? def.models.map((m) => ({ id: m.id, window: m.contextWindow ? String(m.contextWindow) : "" })) : [{ id: "", window: "" }],
			window: def.defaultContextWindow ? String(def.defaultContextWindow) : "",
			maxTokens: def.defaultMaxTokens ? String(def.defaultMaxTokens) : "",
		});
		setEditingId(def.id);
		setEditAdvanced(false);
	};
	const saveCustomEdit = async () => {
		const id = editingId();
		const def = id ? customDef(id) : undefined;
		const models = buildModels(cp().models);
		if (!id || !def || !cp().baseUrl.trim() || models.length === 0) return;
		const next = {
			...def,
			...(cp().name.trim() ? { name: cp().name.trim() } : {}),
			baseUrl: cp().baseUrl.trim(),
			models,
			...(cp().window.trim() && Number.isFinite(Number(cp().window)) ? { defaultContextWindow: Number(cp().window) } : {}),
			...(cp().maxTokens.trim() && Number.isFinite(Number(cp().maxTokens)) ? { defaultMaxTokens: Number(cp().maxTokens) } : {}),
		};
		const list = (customProviders() ?? []).map((d) => (d.id === id ? next : d));
		const ok = await persist({ ...currentSettings(), customProviders: list });
		if (!ok) return;
		setCustomProviders(list);
		setEditingId(null);
	};
	const toggleCpAdvanced = () => setCpAdvanced(!cpAdvanced());

	const providersConfigured = () => (runtime()?.providers ?? []).filter((p) => p.configured).length;

	const rows = (): {
		id: string;
		title: string;
		desc: string;
		cats: CatId[];
		stacked?: boolean;
		modified: () => boolean;
		control: () => JSX.Element;
	}[] => [
		{
			id: "theme",
			title: "Theme",
			desc: "UI theme; system follows the OS.",
			cats: ["general"],
			stacked: true,
			modified: () => theme() !== DEFAULTS.theme,
			control: () => {
				const options: { value: ThemeMode; label: string; hint: string }[] = [
					{ value: "system", label: "System", hint: "Follow OS" },
					{ value: "light", label: "Light", hint: "Always light" },
					{ value: "dark", label: "Dark", hint: "Always dark" },
				];
				return (
					<div class="grid grid-cols-3 gap-2">
						{options.map((o) => (
							<button
								type="button"
								class={cn(
									"group flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors",
									theme() === o.value ? "border-seal/60 bg-seal/10" : "border-hairline bg-paper hover:border-ink-soft hover:bg-paper-hover",
								)}
								onClick={() => {
									setTheme(o.value);
									void persist({ ...currentSettings(), theme: o.value });
								}}
							>
								<span class={cn("font-sans text-[12px] leading-tight", theme() === o.value ? "text-seal" : "text-ink")}>{o.label}</span>
								<span class="font-sans text-[10px] leading-tight text-body-muted">{o.hint}</span>
							</button>
						))}
					</div>
				);
			},
		},
		{
			id: "dockSide",
			title: "Dock side",
			desc: "Dock Explorer and Git Changes to the left or right.",
			cats: ["general"],
			modified: () => dockSide() !== DEFAULTS.dockSide,
			control: () => (
				<Select
					class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[150px] rounded-[10px]"
					title="Dock side"
					ariaLabel="Dock side"
					portalMount={rootRef}
					value={dockSide()}
					onChange={(value) => {
						const side = value as "left" | "right";
						setDockSide(side);
						void persist({ ...currentSettings(), dockSide: side });
					}}
					options={[
						{ value: "left", label: "left" },
						{ value: "right", label: "right" },
					]}
				/>
			),
		},
		{
			id: "sandbox",
			title: "Default sandbox mode",
			desc: "Sandbox mode for newly created partners.",
			cats: ["permission"],
			modified: () => defaultSandboxMode() !== DEFAULTS.sandbox,
			control: () => (
				<Select
					class="h-[32px] w-[200px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[200px] rounded-[10px]"
					title="Default sandbox mode"
					ariaLabel="Default sandbox mode"
					portalMount={rootRef}
					value={defaultSandboxMode()}
					onChange={(value) => {
						const mode = value as SandboxMode;
						setDefaultSandboxMode(mode);
						void persist({ ...currentSettings(), defaultSandboxMode: mode });
					}}
					options={[
						{ value: "read-only", label: "read-only" },
						{ value: "workspace-write", label: "workspace-write" },
						{ value: "danger-full-access", label: "danger-full-access" },
					]}
				/>
			),
		},
		{
			id: "path",
			title: "Partner profile path",
			desc: "Directory where partner profiles are stored.",
			cats: ["general"],
			modified: () => {
				const p = path().trim();
				return p !== "" && p !== DEFAULTS.path;
			},
			control: () => (
				<PickFile
					class="w-[200px] shrink-0"
					value={path()}
					title="Partner profile path"
					ariaLabel="Partner profile path"
					onPick={(next) => {
						setPath(next);
						const saved = settingsData()?.partner_profile_path ?? DEFAULTS.path;
						if (next === saved) return;
						void persist({ ...currentSettings(), partner_profile_path: next });
					}}
				/>
			),
		},
		{
			id: "commandsPath",
			title: "Commands directory",
			desc: "Folder containing user-defined TS command modules (trusted plugin).",
			cats: ["general"],
			modified: () => {
				const p = commandsPath().trim();
				return p !== "" && p !== DEFAULTS.commandsPath;
			},
			control: () => (
				<PickFile
					class="w-[200px] shrink-0"
					value={commandsPath()}
					title="Commands directory"
					ariaLabel="Commands directory"
					onPick={(next) => {
						setCommandsPath(next);
						const saved = settingsData()?.commands_path?.trim() || DEFAULTS.commandsPath;
						if (next === saved) return;
						void persist({ ...currentSettings(), commands_path: next });
					}}
				/>
			),
		},
		{
			id: "webFetchTimeout",
			title: "Web fetch timeout (ms)",
			desc: "Max time a fetch may take before aborting.",
			cats: ["webFetch"],
			modified: () => parsePositiveInt(webFetchTimeout(), 15000) !== 15000,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={webFetchTimeout()} onChange={setWebFetchTimeout}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch timeout (ms)"
						aria-label="Web fetch timeout (ms)"
						onBlur={() => {
							const next = parsePositiveInt(webFetchTimeout(), 15000);
							const saved = settingsData()?.webFetch?.timeoutMs ?? 15000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: next,
									maxBytes: parsePositiveInt(webFetchMaxBytes(), 1_000_000),
									maxChars: parsePositiveInt(webFetchMaxChars(), 50_000),
									userAgent: webFetchUserAgent().trim() || undefined,
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchMaxBytes",
			title: "Web fetch max bytes",
			desc: "Response body size cap in bytes; larger responses are rejected.",
			cats: ["webFetch"],
			modified: () => parsePositiveInt(webFetchMaxBytes(), 1_000_000) !== 1_000_000,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={webFetchMaxBytes()} onChange={setWebFetchMaxBytes}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch max bytes"
						aria-label="Web fetch max bytes"
						onBlur={() => {
							const next = parsePositiveInt(webFetchMaxBytes(), 1_000_000);
							const saved = settingsData()?.webFetch?.maxBytes ?? 1_000_000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout(), 15000),
									maxBytes: next,
									maxChars: parsePositiveInt(webFetchMaxChars(), 50_000),
									userAgent: webFetchUserAgent().trim() || undefined,
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchMaxChars",
			title: "Web fetch max chars",
			desc: "Character cap for the text returned to the model.",
			cats: ["webFetch"],
			modified: () => parsePositiveInt(webFetchMaxChars(), 50_000) !== 50_000,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={webFetchMaxChars()} onChange={setWebFetchMaxChars}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch max chars"
						aria-label="Web fetch max chars"
						onBlur={() => {
							const next = parsePositiveInt(webFetchMaxChars(), 50_000);
							const saved = settingsData()?.webFetch?.maxChars ?? 50_000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout(), 15000),
									maxBytes: parsePositiveInt(webFetchMaxBytes(), 1_000_000),
									maxChars: next,
									userAgent: webFetchUserAgent().trim() || undefined,
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchUserAgent",
			title: "Web fetch user agent",
			desc: "User-Agent header sent with web_fetch requests.",
			cats: ["webFetch"],
			modified: () => webFetchUserAgent().trim() !== "Letters-web-fetch/0.1",
			control: () => (
				<TextField class="w-[200px] shrink-0" value={webFetchUserAgent()} onChange={setWebFetchUserAgent}>
					<TextFieldInput
						variant="compact"
						title="Web fetch user agent"
						aria-label="Web fetch user agent"
						onBlur={() => {
							const next = webFetchUserAgent().trim();
							const saved = settingsData()?.webFetch?.userAgent?.trim() ?? "Letters-web-fetch/0.1";
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout(), 15000),
									maxBytes: parsePositiveInt(webFetchMaxBytes(), 1_000_000),
									maxChars: parsePositiveInt(webFetchMaxChars(), 50_000),
									userAgent: next || undefined,
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
						spellcheck={false}
					/>
				</TextField>
			),
		},
		{
			id: "compactionThreshold",
			title: "Compaction threshold ratio",
			desc: "Auto-compact when usage reaches this fraction of the context window.",
			cats: ["compaction"],
			modified: () => (Number(compactionThreshold()) || 0.8) !== 0.8,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={compactionThreshold()} onChange={setCompactionThreshold}>
					<TextFieldInput
						type="number"
						min={0}
						max={1}
						step={0.05}
						variant="compact"
						title="Compaction threshold ratio"
						aria-label="Compaction threshold ratio"
						onBlur={() => {
							const next = Number(compactionThreshold()) || 0.8;
							const saved = settingsData()?.compaction?.thresholdRatio ?? 0.8;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: {
									digestMaxItems: parsePositiveInt(compactionDigestMaxItems(), 10),
									maxOverflowRetries: parsePositiveInt(compactionOverflowRetries(), 1),
									...(compactionThreshold() ? { thresholdRatio: next } : {}),
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "compactionDigestMaxItems",
			title: "Checkpoint digest items",
			desc: "Max memories carried in a checkpoint digest; the newest events are always reserved.",
			cats: ["compaction"],
			modified: () => parsePositiveInt(compactionDigestMaxItems(), 10) !== 10,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={compactionDigestMaxItems()} onChange={setCompactionDigestMaxItems}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Checkpoint digest items"
						aria-label="Checkpoint digest items"
						onBlur={() => {
							const next = parsePositiveInt(compactionDigestMaxItems(), 10);
							const saved = settingsData()?.compaction?.digestMaxItems ?? 10;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: {
									digestMaxItems: next,
									maxOverflowRetries: parsePositiveInt(compactionOverflowRetries(), 1),
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "compactionOverflowRetries",
			title: "Overflow retries",
			desc: "Max compact-and-retry attempts after a context overflow.",
			cats: ["compaction"],
			modified: () => parsePositiveInt(compactionOverflowRetries(), 1) !== 1,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={compactionOverflowRetries()} onChange={setCompactionOverflowRetries}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Overflow retries"
						aria-label="Overflow retries"
						onBlur={() => {
							const next = parsePositiveInt(compactionOverflowRetries(), 1);
							const saved = settingsData()?.compaction?.maxOverflowRetries ?? 1;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: {
									digestMaxItems: parsePositiveInt(compactionDigestMaxItems(), 10),
									maxOverflowRetries: next,
								},
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},

		{
			id: "retryMaxRetries",
			title: "Retry max attempts",
			desc: "Automatic retries on transient LLM errors; 0 disables retry.",
			cats: ["retry"],
			modified: () => parsePositiveInt(retryMaxRetries(), DEFAULTS.retryMaxRetries) !== DEFAULTS.retryMaxRetries,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={retryMaxRetries()} onChange={setRetryMaxRetries}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Retry max attempts"
						aria-label="Retry max attempts"
						onBlur={() => {
							const next = parsePositiveInt(retryMaxRetries(), DEFAULTS.retryMaxRetries);
							const saved = settingsData()?.retry?.maxRetries ?? DEFAULTS.retryMaxRetries;
							if (next === saved) return;
							void persist({ ...currentSettings(), retry: { maxRetries: next, baseDelayMs: parsePositiveInt(retryBaseDelayMs(), DEFAULTS.retryBaseDelayMs) } });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "retryBaseDelayMs",
			title: "Retry base delay (ms)",
			desc: "First retry waits this long; each retry doubles it.",
			cats: ["retry"],
			modified: () => parsePositiveInt(retryBaseDelayMs(), DEFAULTS.retryBaseDelayMs) !== DEFAULTS.retryBaseDelayMs,
			control: () => (
				<TextField class="w-[200px] shrink-0" value={retryBaseDelayMs()} onChange={setRetryBaseDelayMs}>
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Retry base delay (ms)"
						aria-label="Retry base delay (ms)"
						onBlur={() => {
							const next = parsePositiveInt(retryBaseDelayMs(), DEFAULTS.retryBaseDelayMs);
							const saved = settingsData()?.retry?.baseDelayMs ?? DEFAULTS.retryBaseDelayMs;
							if (next === saved) return;
							void persist({ ...currentSettings(), retry: { maxRetries: parsePositiveInt(retryMaxRetries(), DEFAULTS.retryMaxRetries), baseDelayMs: next } });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "instr",
			title: "Instructions file",
			desc: "Instruction file detected per workspace.",
			cats: ["general"],
			modified: () => {
				const i = instructionsFile().trim();
				return i !== "" && i !== DEFAULTS.instructions;
			},
			control: () => (
				<TextField class="w-[200px] shrink-0" value={instructionsFile()} onChange={setInstructionsFile}>
					<TextFieldInput
						variant="compact"
						title="Instructions file"
						aria-label="Instructions file"
						onBlur={() => {
							const next = instructionsFile().trim() || DEFAULTS.instructions;
							if (next === (settingsData()?.detect_instructions_file ?? DEFAULTS.instructions)) return;
							void persist({ ...currentSettings(), detect_instructions_file: next });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
						spellcheck={false}
					/>
				</TextField>
			),
		},
		{
			id: "interval",
			title: "Send message interval",
			desc: "How often visible updates are sent during a run; ∞ sends only the first and final message.",
			cats: ["general"],
			modified: () => deliveryMode() === "custom",
			control: () => (
				<div class="flex h-[32px] items-center gap-2">
					<Select
						class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
						itemClass="font-sans text-[12px]"
						contentClass="w-[150px] rounded-[10px]"
						title="Send message interval"
						ariaLabel="Send message interval"
						portalMount={rootRef}
						value={deliveryMode()}
						onChange={(value) => {
							const mode = value as "unlimited" | "custom";
							setDeliveryMode(mode);
							void persist({ ...currentSettings(), sendMessageIntervalSec: mode === "unlimited" ? null : parsedDeliverySec() });
						}}
						options={[
							{ value: "unlimited", label: "∞ first + last" },
							{ value: "custom", label: "custom" },
						]}
					/>
					<Show when={deliveryMode() === "custom"}>
						<TextField class="h-[32px] w-[90px] shrink-0 gap-0" value={deliverySec()} onChange={setDeliverySec}>
							<TextFieldInput
								type="number"
								min={20}
								variant="compact"
								title="Send message interval seconds"
								aria-label="Send message interval seconds"
								onBlur={() => {
									const sec = parsedDeliverySec();
									setDeliverySec(String(sec));
									void persist({ ...currentSettings(), sendMessageIntervalSec: sec });
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
								}}
							/>
						</TextField>
					</Show>
				</div>
			),
		},
		{
			id: "shellContinuous",
			title: "Continuous shell input",
			desc: "Keep shell mode active after sending; turn off to exit shell mode after each command.",
			cats: ["general"],
			modified: () => shellContinuous() !== DEFAULTS.shellContinuous,
			control: () => (
				<SwitchToggle
					checked={shellContinuous()}
					onChange={(on) => {
						setShellContinuous(on);
						void persist({ ...currentSettings(), shellContinuous: on });
					}}
				/>
			),
		},
		{
			id: "memoryEnabled",
			title: "Memory",
			desc: "Master switch for memory features: the memory tool, /memory, and background organization.",
			cats: ["memory"],
			modified: () => memoryEnabled() !== DEFAULTS.memoryEnabled,
			control: () => (
				<SwitchToggle
					checked={memoryEnabled()}
					onChange={(on) => {
						setMemoryEnabled(on);
						void persist({ ...currentSettings(), memoryEnabled: on });
					}}
				/>
			),
		},
		{
			id: "memoryIdleMinutes",
			title: "Memory idle delay",
			desc: "Minutes of silence before background memory organization runs; 0 disables it.",
			cats: ["memory"],
			modified: () => memoryIdleMinutes() !== String(DEFAULTS.memoryIdleMinutes),
			control: () => (
				<TextField class="h-[32px] w-[110px] shrink-0 gap-0" value={memoryIdleMinutes()} onChange={setMemoryIdleMinutes}>
					<TextFieldInput
						variant="compact"
						title="Memory idle delay (minutes)"
						aria-label="Memory idle delay"
						onBlur={() => {
							const next = parsePositiveInt(memoryIdleMinutes(), DEFAULTS.memoryIdleMinutes);
							setMemoryIdleMinutes(String(next));
							void persist({ ...currentSettings(), memoryIdleMinutes: next });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "memoryMaxScenes",
			title: "Max scene documents",
			desc: "Upper bound on active scene documents; at the limit the scene stage must merge existing scenes.",
			cats: ["memory"],
			modified: () => memoryMaxScenes() !== String(DEFAULTS.memoryMaxScenes),
			control: () => (
				<TextField class="h-[32px] w-[110px] shrink-0 gap-0" value={memoryMaxScenes()} onChange={setMemoryMaxScenes}>
					<TextFieldInput
						variant="compact"
						title="Max scene documents"
						aria-label="Max scene documents"
						onBlur={() => {
							const next = parsePositiveInt(memoryMaxScenes(), DEFAULTS.memoryMaxScenes);
							setMemoryMaxScenes(String(next));
							void persist({ ...currentSettings(), memoryMaxScenes: next });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "toastPlacement",
			title: "Toast placement",
			desc: "Where transient notifications appear.",
			cats: ["general"],
			modified: () => toastPlacement() !== DEFAULTS.toastPlacement,
			control: () => (
				<Select
					class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[150px] rounded-[10px]"
					title="Toast placement"
					ariaLabel="Toast placement"
					portalMount={rootRef}
					value={toastPlacement()}
					onChange={(value) => {
						const p = value as ToastPlacement;
						setToastPlacement(p);
						void persist({ ...currentSettings(), toastPlacement: p });
					}}
					options={[
						{ value: "topcenter", label: "top center" },
						{ value: "topright", label: "top right" },
						{ value: "bottomcenter", label: "bottom center" },
						{ value: "bottomright", label: "bottom right" },
					]}
				/>
			),
		},
		{
			id: "toastDuration",
			title: "Toast duration",
			desc: "Milliseconds before a toast auto-closes; 0 keeps it until dismissed.",
			cats: ["general"],
			modified: () => parsePositiveInt(toastDurationMs(), DEFAULTS.toastDurationMs) !== DEFAULTS.toastDurationMs,
			control: () => (
				<TextField class="h-[32px] w-[110px] shrink-0 gap-0" value={toastDurationMs()} onChange={setToastDurationMs}>
					<TextFieldInput
						type="number"
						min={0}
						step={500}
						variant="compact"
						title="Toast duration (ms)"
						aria-label="Toast duration (ms)"
						onBlur={() => {
							const next = parsePositiveInt(toastDurationMs(), DEFAULTS.toastDurationMs);
							setToastDurationMs(String(next));
							void persist({ ...currentSettings(), toastDurationMs: next });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "skillsDirs",
			title: "Skills directories",
			desc: "Each directory is scanned as <workspace>/<dir> (project) and <home>/<dir> (global).",
			cats: ["skills"],
			stacked: true,
			modified: () =>
				JSON.stringify(
					skillsDirs()
						.map((d) => d.trim())
						.filter(Boolean),
				) !== JSON.stringify(DEFAULTS.skills_dirs),
			control: () => (
				<div class="flex flex-col gap-1.5">
					<table class="w-full text-left">
						<thead>
							<tr>
								<th class="pb-1 font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Directory</th>
								<th class="w-10 pb-1" />
							</tr>
						</thead>
						<tbody>
							<Index each={skillsDirs()}>
								{(d, i) => (
									<tr>
										<td class="pb-1 pr-2">
											<TextField class="w-full" value={d()} onChange={(v) => updateSkillsDir(i, v)}>
												<TextFieldInput
													variant="compact"
													class="w-full"
													placeholder=".agents/skills"
													aria-label="Skills directory"
													spellcheck={false}
													onBlur={() => persistSkillsDirs()}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
													}}
												/>
											</TextField>
										</td>
										<td class="pb-1 text-right">
											<Button variant="ghost" size="sm" title="Remove directory" onClick={() => removeSkillsDir(i)}>
												×
											</Button>
										</td>
									</tr>
								)}
							</Index>
						</tbody>
					</table>
					<div>
						<Button variant="outline" size="sm" onClick={addSkillsDir}>
							Add directory
						</Button>
					</div>
				</div>
			),
		},
		{
			id: "skillsWatch",
			title: "Skill watching",
			desc: "Hot-reload skills on file changes.",
			cats: ["skills"],
			modified: () => skillsWatch() !== DEFAULTS.skills_watch,
			control: () => (
				<SwitchToggle
					checked={skillsWatch()}
					onChange={(on) => {
						setSkillsWatch(on);
						void persist({ ...currentSettings(), skills_watch: on });
					}}
				/>
			),
		},
		{
			id: "skillsWatchDelay",
			title: "Skill watch delay",
			desc: "Milliseconds to debounce before refreshing skills after a change.",
			cats: ["skills"],
			modified: () => parsePositiveInt(skillsWatchDelay(), DEFAULTS.skills_watch_delay_ms) !== DEFAULTS.skills_watch_delay_ms,
			control: () => (
				<TextField class="h-[32px] w-[110px] shrink-0 gap-0" value={skillsWatchDelay()} onChange={setSkillsWatchDelay}>
					<TextFieldInput
						type="number"
						min={0}
						step={100}
						variant="compact"
						title="Skill watch delay (ms)"
						aria-label="Skill watch delay (ms)"
						onBlur={() => {
							const next = parsePositiveInt(skillsWatchDelay(), DEFAULTS.skills_watch_delay_ms);
							setSkillsWatchDelay(String(next));
							void persist({ ...currentSettings(), skills_watch_delay_ms: next });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "explorerLineGap",
			title: "File preview line gap",
			desc: "Extra visual spacing between code lines; line-height is 1 + gap.",
			cats: ["explorer"],
			modified: () => Number(explorerLineGap()) !== DEFAULTS.explorerLineGap,
			control: () => (
				<TextField class="h-[32px] w-[110px] shrink-0 gap-0" value={explorerLineGap()} onChange={setExplorerLineGap}>
					<TextFieldInput
						type="number"
						min={0}
						max={1}
						step={0.05}
						variant="compact"
						title="File preview line gap"
						aria-label="File preview line gap"
						onBlur={() => {
							const parsed = Number(explorerLineGap());
							const next = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS.explorerLineGap;
							setExplorerLineGap(String(next));
							const saved = settingsData()?.explorer?.lineGap ?? DEFAULTS.explorerLineGap;
							if (next === saved) return;
							void persist({ ...currentSettings(), explorer: { lineGap: next } });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "paletteSearchIgnoreDirs",
			title: "File search ignore list",
			desc: "Directories (and files like .DS_Store) the Cmd+P file search skips. Leave empty for the built-in list.",
			cats: ["palette"],
			modified: () => parseIgnoreDirs().length > 0,
			control: () => (
				<TextField class="h-[32px] w-[280px] shrink-0 gap-0" value={paletteIgnoreDirs()} onChange={setPaletteIgnoreDirs}>
					<TextFieldInput
						variant="compact"
						placeholder=".git, node_modules, dist"
						title="File search ignore list"
						aria-label="File search ignore list"
						onBlur={() => {
							void persist(parseIgnoreDirs().length > 0 ? currentSettings() : { ...currentSettings(), palette: undefined });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
	];

	const q = createMemo(() => query().trim().toLowerCase());
	const searching = () => q() !== "";
	const matches = (text: string) => text.toLowerCase().includes(q());
	const matchedRows = createMemo(() => rows().filter((r) => matches(r.title) || matches(r.desc)));
	const providerMatches = createMemo(() => added().filter((id) => matches(id)));
	const totalMatches = createMemo(() => matchedRows().length + providerMatches().length);
	const catHasMatches = (cat: CatId) => (cat === "providers" ? providerMatches().length > 0 : matchedRows().some((r) => r.cats.includes(cat)));

	const selectCat = (cat: CatId) => {
		setTab(cat);
		setQuery("");
	};

	const providerFields = (readonlyId?: boolean) => (
		<>
			<Field label="ID">
				<TextField class="w-full" value={cp().id} onChange={(v) => setCp({ ...cp(), id: v })} readOnly={readonlyId}>
					<TextFieldInput variant="compact" class="w-full font-sans" placeholder="my-gateway" aria-label="Custom provider id" spellcheck={false} />
				</TextField>
			</Field>
			<Field label="Base URL">
				<TextField class="w-full" value={cp().baseUrl} onChange={(v) => setCp({ ...cp(), baseUrl: v })}>
					<TextFieldInput variant="compact" class="w-full font-sans" placeholder="https://gateway.example.com/v1" aria-label="Base URL" spellcheck={false} />
				</TextField>
			</Field>
			<ModelRows rows={cp().models} onChange={(models) => setCp({ ...cp(), models })} />
		</>
	);

	const providerAdvanced = (value: () => CpForm, set: (next: CpForm) => void, open: () => boolean, toggle: () => void) => (
		<>
			<button type="button" class="justify-self-start font-mono text-[10px] text-muted transition-colors hover:text-ink" onClick={toggle}>
				{open() ? "− Advanced" : "+ Advanced"}
			</button>
			<Show when={open()}>
				<div class="grid gap-3">
					<Field label="Name">
						<TextField class="w-full" value={value().name} onChange={(v) => set({ ...value(), name: v })}>
							<TextFieldInput variant="compact" class="w-full font-sans" placeholder="My Gateway" aria-label="Display name" spellcheck={false} />
						</TextField>
					</Field>
					<Field label="Window">
						<TextField class="w-full" value={value().window} onChange={(v) => set({ ...value(), window: v })}>
							<TextFieldInput variant="compact" class="w-full" placeholder="128000" aria-label="Default context window" spellcheck={false} />
						</TextField>
					</Field>
					<Field label="Max tokens">
						<TextField class="w-full" value={value().maxTokens} onChange={(v) => set({ ...value(), maxTokens: v })}>
							<TextFieldInput variant="compact" class="w-full" placeholder="8192" aria-label="Default max tokens" spellcheck={false} />
						</TextField>
					</Field>
				</div>
			</Show>
		</>
	);

	return (
		<div
			class="flex h-full min-h-0"
			ref={rootRef}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					setAdding(false);
					setEditingId(null);
					setKeyEditId(null);
					resetCp();
					setAddKind("builtin");
				}
			}}
		>
			<nav class="flex w-[184px] shrink-0 flex-col border-r border-hairline py-5">
				<div class="space-y-1.5 px-5">
					<For each={CATS}>
						{(cat) => (
							<button
								type="button"
								onClick={() => selectCat(cat.id)}
								class={cn(
									"flex h-[36px] w-full items-center rounded-[8px] px-3 text-left font-serif text-[13px] transition-colors",
									tab() === cat.id ? "bg-paper-hover text-ink" : "text-ink-soft hover:bg-paper-hover",
								)}
							>
								{cat.label}
								<Show when={searching() ? catHasMatches(cat.id) : cat.id === "providers" && providersConfigured() > 0}>
									<span class={cn("ml-auto size-[5px] shrink-0 rounded-full", searching() ? "bg-seal" : "bg-[#7FB069]")} />
								</Show>
							</button>
						)}
					</For>
				</div>
				<span class="mt-auto px-6 pb-2 font-serif text-[11px] text-muted">letters</span>
			</nav>

			<div class="flex min-h-0 flex-1 flex-col">
				<div class="px-6 pb-4 pt-3">
					<div class="relative">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" class="absolute left-3 top-1/2 size-[14px] -translate-y-1/2 text-muted">
							<circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6" />
							<path d="M10.2 10.2 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
						</svg>
						<TextField class="w-full" value={query()} onChange={setQuery}>
							<TextFieldInput
								variant="compact"
								class="pl-9 pr-14 font-sans"
								placeholder="Search settings"
								aria-label="Search settings"
								onKeyDown={(e) => {
									if (e.key === "Escape") setQuery("");
								}}
								spellcheck={false}
							/>
						</TextField>
						<Show when={searching()}>
							<span class="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
								{totalMatches()} {totalMatches() === 1 ? "match" : "matches"}
							</span>
						</Show>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
					<Show when={searching()}>
						<div class="space-y-4">
							<For each={CATS}>
								{(cat) => (
									<Show when={catHasMatches(cat.id)}>
										<div>
											<div class="mb-3 font-serif text-[16px] font-medium text-ink">{cat.label}</div>
											<div class="divide-y divide-hairline">
												<For each={matchedRows().filter((r) => r.cats.includes(cat.id))}>
													{(row) => (
														<SettingRow title={row.title} desc={row.desc} modified={row.modified()} q={q()} stacked={row.stacked}>
															{row.control()}
														</SettingRow>
													)}
												</For>
												<Show when={cat.id === "providers"}>
													<For each={providerMatches()}>
														{(id) => (
															<div class="flex items-center gap-2 py-3.5">
																<span class="font-serif text-[13px] text-ink">{highlight(id, q())}</span>
																<Show when={configured(id)}>
																	<span class="size-[5px] shrink-0 rounded-full bg-[#7FB069]" title="configured" />
																</Show>
															</div>
														)}
													</For>
												</Show>
											</div>
										</div>
									</Show>
								)}
							</For>
							<Show when={totalMatches() === 0}>
								<div class="pt-8 text-center">
									<div class="font-serif text-[14px] text-ink-soft">No matching settings</div>
									<div class="mt-1 font-sans text-[11px] text-body-muted">Try a different search.</div>
								</div>
							</Show>
						</div>
					</Show>
					<Show when={!searching()}>
						<For each={CATS}>
							{(cat) => (
								<Show when={tab() === cat.id && cat.id !== "providers" && cat.id !== "mcp"}>
									<div>
										<div class="mb-3 font-serif text-[16px] font-medium text-ink">{cat.label}</div>
										<div class="divide-y divide-hairline">
											<For each={rows().filter((r) => r.cats.includes(cat.id))}>
												{(row) => (
													<SettingRow title={row.title} desc={row.desc} modified={row.modified()} stacked={row.stacked}>
														{row.control()}
													</SettingRow>
												)}
											</For>
										</div>
									</div>
								</Show>
							)}
						</For>
						<Show when={tab() === "providers"}>
							<div>
								<div class="mb-3 font-serif text-[16px] font-medium text-ink">Providers</div>
								<Show when={tableRows().length} fallback={<div class="mb-3 font-mono text-[11px] text-muted">no providers added — add one below</div>}>
									<div class="divide-y divide-hairline">
										<div class={cn(COLS, "pb-1 font-sans text-[10px] text-muted")}>
											<span>Provider</span>
											<span>Base URL</span>
											<span>Models</span>
											<span class="text-right">…</span>
										</div>
										<For each={tableRows()}>
											{(id) => {
												const def = customDef(id);
												return (
													<>
														<div class={cn(COLS, "py-2")}>
															<span class="flex min-w-0 items-center gap-2">
																<span class="truncate font-serif text-[12px] text-ink">{id}</span>
																<Show when={configured(id)}>
																	<span class="size-[5px] shrink-0 rounded-full bg-[#7FB069]" title="configured" />
																</Show>
															</span>
															<span class="truncate font-mono text-[10px] text-body-muted" title={rowBaseUrl(id) ?? ""}>
																{rowBaseUrl(id)}
															</span>
															<span class="font-mono text-[10px] text-muted">{rowModelCount(id)}</span>
															<span class="flex items-center justify-end gap-1">
																<button
																	type="button"
																	class="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																	onClick={() => toggleKey(id)}
																>
																	key
																</button>
																<Show when={def}>
																	<button
																		type="button"
																		class="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																		onClick={() => {
																			const current = customDef(id);
																			if (current) startEdit(current);
																		}}
																	>
																		edit
																	</button>
																</Show>
																<button
																	type="button"
																	class="flex h-6 w-6 items-center justify-center rounded-[8px] font-sans text-[14px] leading-none text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																	aria-label={`remove ${id}`}
																	onClick={() => remove(id)}
																>
																	×
																</button>
															</span>
														</div>
														<Show when={keyEditId() === id}>
															<div class="py-3">
																<div class="flex items-center gap-2">
																	<TextField class="min-w-0 flex-1" value={keyDraft()} onChange={setKeyDraft}>
																		<TextFieldInput
																			variant="compact"
																			class="h-[30px] text-[11px]"
																			type="password"
																			placeholder={configured(id) ? "new key" : "sk-…"}
																			aria-label="API key"
																			spellcheck={false}
																			autocomplete="off"
																			onKeyDown={(e) => {
																				if (e.key === "Enter") void saveKey();
																				if (e.key === "Escape") toggleKey(id);
																			}}
																		/>
																	</TextField>
																	<button
																		type="button"
																		class="h-[30px] shrink-0 rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
																		disabled={!keyDraft().trim()}
																		onClick={saveKey}
																	>
																		Save
																	</button>
																	<Show when={configured(id)}>
																		<button
																			type="button"
																			class="h-[30px] shrink-0 rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
																			onClick={clearKey}
																		>
																			Clear
																		</button>
																	</Show>
																</div>
															</div>
														</Show>
														<Show when={editingId() === id}>
															<div class="py-3">
																<div class="grid gap-3">
																	{providerFields(true)}
																	{providerAdvanced(cp, setCp, editAdvanced, () => setEditAdvanced(!editAdvanced()))}
																</div>
																<div class="mt-3 flex justify-end gap-2">
																	<button
																		type="button"
																		class="h-[28px] rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
																		onClick={() => setEditingId(null)}
																	>
																		Cancel
																	</button>
																	<button
																		type="button"
																		class="h-[28px] rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
																		disabled={!cp().baseUrl.trim() || !cp().models.some((m) => m.id.trim())}
																		onClick={saveCustomEdit}
																	>
																		Save
																	</button>
																</div>
															</div>
														</Show>
													</>
												);
											}}
										</For>
									</div>
								</Show>
								<div class="mt-2 border-t border-hairline pt-2">
									<button
										type="button"
										class="-mx-2 rounded-[8px] px-2 py-1 font-sans text-[11px] text-ink-soft transition-colors hover:bg-paper-hover hover:text-ink"
										onClick={() => {
											if (adding()) {
												setAdding(false);
												resetCp();
												setAddKind("builtin");
											} else {
												setAdding(true);
												setEditingId(null);
												setKeyEditId(null);
												resetCp();
											}
										}}
									>
										{adding() ? "Cancel" : "+ Add provider"}
									</button>
									<Show when={adding()}>
										<div class="pt-2">
											<Show when={addKind() === "builtin"} fallback={<div class="pt-1" />}>
												<div class="grid gap-2">
													<Select
														class="h-[30px] w-40 rounded-[10px] font-sans text-[11px]"
														itemClass="font-sans text-[11px]"
														contentClass="w-40 rounded-[10px]"
														title="Add provider"
														ariaLabel="Add provider"
														placeholder="provider"
														portalMount={rootRef}
														value={toAdd() || addable()[0] || ""}
														onChange={(value) => setToAdd(value)}
														options={addable().map((p) => ({ value: p, label: p }))}
													/>
													<div class="flex items-center gap-2">
														<TextField
															class="min-w-0 flex-1"
															value={keys()[toAdd() || addable()[0] || ""] ?? ""}
															onChange={(v) => {
																const id = toAdd() || addable()[0];
																if (id) setKeys({ ...keys(), [id]: v });
															}}
														>
															<TextFieldInput
																variant="compact"
																class="h-[30px] text-[11px]"
																type="password"
																placeholder="api key（添加必填）"
																aria-label="New provider api key"
																spellcheck={false}
																autocomplete="off"
															/>
														</TextField>
														<button
															type="button"
															class="h-[30px] shrink-0 rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:cursor-default disabled:opacity-35"
															disabled={!(toAdd() || addable()[0]) || !keys()[toAdd() || addable()[0] || ""]}
															onClick={add}
														>
															ADD
														</button>
													</div>
												</div>
												<button
													type="button"
													class="-mx-2 mt-2 rounded-[8px] px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
													onClick={() => setAddKind("custom")}
												>
													+ custom provider
												</button>
											</Show>
											<Show when={addKind() === "custom"}>
												<div class="grid gap-3">
													{providerFields()}
													{providerAdvanced(cp, setCp, cpAdvanced, toggleCpAdvanced)}
												</div>
												<div class="mt-3 flex justify-end gap-2">
													<button
														type="button"
														class="h-[28px] rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
														onClick={() => setAddKind("builtin")}
													>
														Back
													</button>
													<button
														type="button"
														class="h-[28px] rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
														disabled={!cp().id.trim() || !cp().baseUrl.trim() || !cp().models.some((m) => m.id.trim())}
														onClick={applyCustom}
													>
														APPLY
													</button>
												</div>
											</Show>
										</div>
									</Show>
								</div>
							</div>
						</Show>
						<Show when={tab() === "mcp"}>
							<McpSettingsPanel />
						</Show>
					</Show>
				</div>
			</div>

			<Show when={error()}>
				<div class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12px] text-letter">{error()}</div>
			</Show>
		</div>
	);
}
