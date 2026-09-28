import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { CustomModel, CustomProvider, SandboxMode, ThemeMode, ToastPlacement } from "../../shared/rpc";
import { Button } from "../components/Button";
import { McpSettingsPanel } from "../components/McpSettingsPanel";
import { PickFile } from "../components/PickFile";
import { Select } from "../components/ui/select";
import { Switch as SwitchToggle } from "../components/ui/switch";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { useSettings } from "../lib/contexts/settings-context";
import type { SettingsData } from "../lib/settings";
import { cn } from "../lib/utils";

const CATS = [
	{ id: "general", label: "General" },
	{ id: "tools", label: "MCP & Tools" },
	{ id: "skills", label: "Skills" },
	{ id: "memory", label: "Memory" },
	{ id: "retry", label: "Retry" },
	{ id: "compaction", label: "Compaction" },
	{ id: "permission", label: "Permission" },
	{ id: "providers", label: "Providers" },
] as const;
type CatId = (typeof CATS)[number]["id"];

const DEFAULTS = {
	path: "~/.partner/",
	instructions: "AGENTS.md",
	commandsPath: "~/.config/letters/commands",
	retryMaxRetries: 2,
	retryBaseDelayMs: 500,
	bashTimeoutSec: 15,
	strictDelete: true,
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
	memoryPendingRounds: 10,
	explorerLineGap: 0.2,
	explorerFoldBraces: true,
	explorerFoldMarkdown: true,
	highlightMaxLineLength: 3000,
	highlightTimeLimit: 500,
};

const EMPTY_CP = { id: "", name: "", baseUrl: "", models: [{ id: "", window: "" }], window: "", maxTokens: "" };
type CpForm = typeof EMPTY_CP;
type CpModelRow = CpForm["models"][number];

const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_56px_76px] items-center gap-2";

function parsePositiveInt(value: string, fallback: number) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function SettingRow(props: { title: string; desc: string; modified?: boolean; q?: string; stacked?: boolean; children: React.ReactNode }) {
	const head = (
		<div className="flex items-center gap-2">
			<span className="font-serif text-[13px] leading-tight text-ink">{props.q ? highlight(props.title, props.q) : props.title}</span>
			{props.modified && (
				<span className="flex items-center gap-1.5">
					<span className="size-[5px] shrink-0 rounded-full bg-seal" />
					<span className="font-sans text-[10px] font-medium text-seal">modified</span>
				</span>
			)}
		</div>
	);
	const body = <div className="mt-1 font-sans text-[11px] leading-snug text-body-muted">{props.q ? highlight(props.desc, props.q) : props.desc}</div>;
	if (props.stacked) {
		return (
			<div className="py-3.5">
				{head}
				{body}
				<div className="mt-3">{props.children}</div>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-6 py-3.5">
			<div className="min-w-0 flex-1">
				{head}
				{body}
			</div>
			<div className="shrink-0">{props.children}</div>
		</div>
	);
}

function highlight(text: string, q: string): React.ReactNode {
	const idx = text.toLowerCase().indexOf(q);
	if (idx < 0) return text;
	return (
		<>
			{text.slice(0, idx)}
			<span className="text-seal">{text.slice(idx, idx + q.length)}</span>
			{text.slice(idx + q.length)}
		</>
	);
}

function buildModels(rows: CpModelRow[]): CustomModel[] {
	return rows
		.filter((r) => r.id.trim())
		.map((r) => {
			const contextWindow = Number(r.window);
			return { id: r.id.trim(), ...(r.window.trim() && Number.isFinite(contextWindow) ? { contextWindow } : {}) };
		});
}

function ModelRows(props: { rows: CpModelRow[]; onChange: (rows: CpModelRow[]) => void }) {
	return (
		<div className="grid gap-1">
			<span className="font-sans text-[10px] font-medium uppercase tracking-[0.6px] text-muted">Models</span>
			<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 px-1 font-sans text-[10px] text-muted">
				<span>Model</span>
				<span>Context window</span>
				<span />
			</div>
			<div className="divide-y divide-hairline rounded-[10px] border border-hairline px-3">
				{props.rows.map((row, i) => (
					<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 py-2" key={i}>
						<TextField className="min-w-0">
							<TextFieldInput
								variant="compact"
								className="w-full"
								value={row.id}
								onChange={(event) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, id: event.currentTarget.value } : r)))}
								placeholder="model id"
								aria-label="Model id"
								spellCheck={false}
							/>
						</TextField>
						<TextField className="w-[120px]">
							<TextFieldInput
								variant="compact"
								className="w-full text-[10px]"
								value={row.window}
								onChange={(event) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, window: event.currentTarget.value } : r)))}
								placeholder="optional"
								aria-label="Context window"
								spellCheck={false}
							/>
						</TextField>
						<button
							type="button"
							className="flex h-6 w-6 items-center justify-center rounded-[8px] font-sans text-[14px] leading-none text-muted transition-colors hover:bg-paper-hover hover:text-ink"
							aria-label={`remove model ${row.id || i + 1}`}
							onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}
						>
							×
						</button>
					</div>
				))}
			</div>
			<button
				type="button"
				className="-mx-2 justify-self-start rounded-[8px] px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
				onClick={() => props.onChange([...props.rows, { id: "", window: "" }])}
			>
				+ add model
			</button>
		</div>
	);
}

function Field(props: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid gap-1">
			<span className="font-sans text-[10px] font-medium uppercase tracking-[0.6px] text-muted">{props.label}</span>
			{props.children}
		</div>
	);
}

export function SettingsView() {
	const settingsView = useSettings();
	const snapshot = useStore(settingsView.store, (state) => state.snapshot);
	const settingsData = snapshot.settings;
	const runtime = snapshot.runtime;
	const initial = useRef(settingsData).current;

	const [tab, setTab] = useState<CatId>("general");
	const [query, setQuery] = useState("");
	const [path, setPath] = useState(() => initial?.partner_profile_path ?? "");
	const [commandsPath, setCommandsPath] = useState(() => (initial?.commands_path?.trim() ? initial.commands_path : DEFAULTS.commandsPath));
	const [retryMaxRetries, setRetryMaxRetries] = useState(() => String(initial?.retry?.maxRetries ?? DEFAULTS.retryMaxRetries));
	const [retryBaseDelayMs, setRetryBaseDelayMs] = useState(() => String(initial?.retry?.baseDelayMs ?? DEFAULTS.retryBaseDelayMs));
	const [bashTimeoutSec, setBashTimeoutSec] = useState(() => String(initial?.bash?.timeoutSec ?? DEFAULTS.bashTimeoutSec));
	const [strictDelete, setStrictDelete] = useState(() => initial?.delete?.strict ?? DEFAULTS.strictDelete);
	const [webFetchTimeout, setWebFetchTimeout] = useState(() => String(initial?.webFetch?.timeoutMs ?? 15000));
	const [webFetchMaxBytes, setWebFetchMaxBytes] = useState(() => String(initial?.webFetch?.maxBytes ?? 1_000_000));
	const [webFetchMaxChars, setWebFetchMaxChars] = useState(() => String(initial?.webFetch?.maxChars ?? 50_000));
	const [webFetchUserAgent, setWebFetchUserAgent] = useState(() => initial?.webFetch?.userAgent ?? "Letters-web-fetch/0.1");
	const [compactionThreshold, setCompactionThreshold] = useState(() => String(initial?.compaction?.thresholdRatio ?? 0.8));
	const [compactionDigestMaxItems, setCompactionDigestMaxItems] = useState(() => String(initial?.compaction?.digestMaxItems ?? 10));
	const [compactionOverflowRetries, setCompactionOverflowRetries] = useState(() => String(initial?.compaction?.maxOverflowRetries ?? 1));
	const [explorerLineGap, setExplorerLineGap] = useState(() => String(initial?.explorer?.lineGap ?? DEFAULTS.explorerLineGap));
	const [explorerFoldBraces, setExplorerFoldBraces] = useState(() => initial?.explorer?.fold?.braces ?? DEFAULTS.explorerFoldBraces);
	const [explorerFoldMarkdown, setExplorerFoldMarkdown] = useState(() => initial?.explorer?.fold?.markdown ?? DEFAULTS.explorerFoldMarkdown);
	const [highlightMaxLineLength, setHighlightMaxLineLength] = useState(() => String(initial?.highlight?.tokenizeMaxLineLength ?? DEFAULTS.highlightMaxLineLength));
	const [highlightTimeLimit, setHighlightTimeLimit] = useState(() => String(initial?.highlight?.tokenizeTimeLimit ?? DEFAULTS.highlightTimeLimit));
	const [paletteIgnoreDirs, setPaletteIgnoreDirs] = useState(() => initial?.palette?.searchIgnoreDirs?.join(", ") ?? "");
	const [instructionsFile, setInstructionsFile] = useState(() => initial?.detect_instructions_file ?? "");
	const [defaultSandboxMode, setDefaultSandboxMode] = useState<SandboxMode>(() => initial?.defaultSandboxMode ?? DEFAULTS.sandbox);
	const [theme, setTheme] = useState<ThemeMode>(() => initial?.theme ?? DEFAULTS.theme);
	const [toastPlacement, setToastPlacement] = useState<ToastPlacement>(() => initial?.toastPlacement ?? DEFAULTS.toastPlacement);
	const [dockSide, setDockSide] = useState<"left" | "right">(() => initial?.dockSide ?? DEFAULTS.dockSide);
	const [toastDurationMs, setToastDurationMs] = useState(() => String(initial?.toastDurationMs ?? DEFAULTS.toastDurationMs));
	const [skillsDirs, setSkillsDirs] = useState<string[]>(() => (initial?.skills_dirs?.length ? initial.skills_dirs : [".agents/skills"]));
	const [skillsWatch, setSkillsWatch] = useState(() => initial?.skills_watch ?? DEFAULTS.skills_watch);
	const [skillsWatchDelay, setSkillsWatchDelay] = useState(() => String(initial?.skills_watch_delay_ms ?? DEFAULTS.skills_watch_delay_ms));
	const [shellContinuous, setShellContinuous] = useState(() => initial?.shellContinuous ?? DEFAULTS.shellContinuous);
	const [memoryEnabled, setMemoryEnabled] = useState(() => initial?.memoryEnabled ?? DEFAULTS.memoryEnabled);
	const [memoryIdleMinutes, setMemoryIdleMinutes] = useState(() => String(initial?.memoryIdleMinutes ?? DEFAULTS.memoryIdleMinutes));
	const [memoryMaxScenes, setMemoryMaxScenes] = useState(() => String(initial?.memoryMaxScenes ?? DEFAULTS.memoryMaxScenes));
	const [memoryPendingRounds, setMemoryPendingRounds] = useState(() => String(initial?.memoryPendingRounds ?? DEFAULTS.memoryPendingRounds));
	const [deliveryMode, setDeliveryMode] = useState<"unlimited" | "custom">(() => (typeof initial?.sendMessageIntervalSec === "number" ? "custom" : "unlimited"));
	const [deliverySec, setDeliverySec] = useState(() => String(initial?.sendMessageIntervalSec ?? 20));
	const [added, setAdded] = useState<string[]>(() => initial?.providers ?? []);
	const [customProviders, setCustomProviders] = useState<CustomProvider[] | null>(() => initial?.customProviders ?? null);
	const [toAdd, setToAdd] = useState("");
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [addKind, setAddKind] = useState<"builtin" | "custom">("builtin");
	const [cpAdvanced, setCpAdvanced] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editAdvanced, setEditAdvanced] = useState(false);
	const [keyEditId, setKeyEditId] = useState<string | null>(null);
	const [keyDraft, setKeyDraft] = useState("");
	const [cp, setCp] = useState<CpForm>({ ...EMPTY_CP });

	const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const rootRef = useRef<HTMLDivElement>(null);
	const saveChain = useRef<Promise<unknown>>(Promise.resolve());
	const applied = useRef(initial != null);

	useEffect(() => {
		const s = settingsData;
		if (!s) return;
		if (!applied.current) {
			applied.current = true;
			setPath(s.partner_profile_path);
			setInstructionsFile(s.detect_instructions_file);
			setCommandsPath(s.commands_path?.trim() ? s.commands_path : DEFAULTS.commandsPath);
			if (s.retry?.maxRetries !== undefined) setRetryMaxRetries(String(s.retry.maxRetries));
			if (s.retry?.baseDelayMs !== undefined) setRetryBaseDelayMs(String(s.retry.baseDelayMs));
			if (s.bash?.timeoutSec !== undefined) setBashTimeoutSec(String(s.bash.timeoutSec));
			if (s.compaction?.thresholdRatio !== undefined) setCompactionThreshold(String(s.compaction.thresholdRatio));
			if (s.compaction?.digestMaxItems !== undefined) setCompactionDigestMaxItems(String(s.compaction.digestMaxItems));
			if (s.compaction?.maxOverflowRetries !== undefined) setCompactionOverflowRetries(String(s.compaction.maxOverflowRetries));
			if (s.explorer?.lineGap !== undefined) setExplorerLineGap(String(s.explorer.lineGap));
			if (s.delete?.strict !== undefined) setStrictDelete(s.delete.strict);
			if (s.explorer?.fold?.braces !== undefined) setExplorerFoldBraces(s.explorer.fold.braces);
			if (s.explorer?.fold?.markdown !== undefined) setExplorerFoldMarkdown(s.explorer.fold.markdown);
			if (s.highlight?.tokenizeMaxLineLength !== undefined) setHighlightMaxLineLength(String(s.highlight.tokenizeMaxLineLength));
			if (s.highlight?.tokenizeTimeLimit !== undefined) setHighlightTimeLimit(String(s.highlight.tokenizeTimeLimit));
			if (s.palette?.searchIgnoreDirs !== undefined) setPaletteIgnoreDirs(s.palette.searchIgnoreDirs.join(", "));
			if (s.defaultSandboxMode) setDefaultSandboxMode(s.defaultSandboxMode);
			if (s.theme !== undefined) setTheme(s.theme);
			if (s.toastPlacement !== undefined) setToastPlacement(s.toastPlacement);
			if (s.dockSide !== undefined) setDockSide(s.dockSide);
			if (s.toastDurationMs !== undefined) setToastDurationMs(String(s.toastDurationMs));
			if (s.skills_dirs !== undefined) setSkillsDirs(s.skills_dirs);
			if (typeof s.skills_watch === "boolean") setSkillsWatch(s.skills_watch);
			if (typeof s.skills_watch_delay_ms === "number") setSkillsWatchDelay(String(s.skills_watch_delay_ms));
			if (typeof s.shellContinuous === "boolean") setShellContinuous(s.shellContinuous);
			if (typeof s.memoryEnabled === "boolean") setMemoryEnabled(s.memoryEnabled);
			if (typeof s.memoryMaxScenes === "number") setMemoryMaxScenes(String(s.memoryMaxScenes));
			if (typeof s.memoryIdleMinutes === "number") setMemoryIdleMinutes(String(s.memoryIdleMinutes));
			if (typeof s.memoryPendingRounds === "number") setMemoryPendingRounds(String(s.memoryPendingRounds));
			if (typeof s.sendMessageIntervalSec === "number") {
				setDeliveryMode("custom");
				setDeliverySec(String(s.sendMessageIntervalSec));
			}
			if (s.providers?.length) setAdded(s.providers);
			if (s.customProviders) setCustomProviders(s.customProviders);
		}
		if (s.webFetch?.timeoutMs !== undefined) setWebFetchTimeout(String(s.webFetch.timeoutMs));
		if (s.webFetch?.maxBytes !== undefined) setWebFetchMaxBytes(String(s.webFetch.maxBytes));
		if (s.webFetch?.maxChars !== undefined) setWebFetchMaxChars(String(s.webFetch.maxChars));
		if (s.webFetch?.userAgent !== undefined) setWebFetchUserAgent(s.webFetch.userAgent);
	}, [settingsData]);

	useEffect(() => () => clearTimeout(errorTimer.current), []);

	const parsedDeliverySec = () => {
		const n = parseInt(deliverySec, 10);
		return Number.isFinite(n) ? Math.max(20, n) : 20;
	};
	const parseIgnoreDirs = () =>
		paletteIgnoreDirs
			.split(/[,\n]/)
			.map((name) => name.trim())
			.filter(Boolean);

	const currentSettings = (): SettingsData => {
		const current = settingsData;
		return {
			partner_profile_path: path.trim() || "~/.partner/",
			detect_instructions_file: instructionsFile.trim() || "AGENTS.md",
			defaultSandboxMode,
			providers: added,
			customProviders: customProviders ?? undefined,
			theme,
			toastPlacement,
			dockSide,
			toastDurationMs: parsePositiveInt(toastDurationMs, DEFAULTS.toastDurationMs),
			skills_dirs: skillsDirs.map((dir) => dir.trim()).filter(Boolean),
			skills_watch: skillsWatch,
			skills_watch_delay_ms: parsePositiveInt(skillsWatchDelay, DEFAULTS.skills_watch_delay_ms),
			sendMessageIntervalSec: deliveryMode === "unlimited" ? null : parsedDeliverySec(),
			shellContinuous,
			memoryEnabled,
			memoryIdleMinutes: parsePositiveInt(memoryIdleMinutes, DEFAULTS.memoryIdleMinutes),
			memoryMaxScenes: parsePositiveInt(memoryMaxScenes, DEFAULTS.memoryMaxScenes),
			memoryPendingRounds: parsePositiveInt(memoryPendingRounds, DEFAULTS.memoryPendingRounds),
			commands_path: commandsPath.trim() || undefined,
			retry: {
				maxRetries: parsePositiveInt(retryMaxRetries, DEFAULTS.retryMaxRetries),
				baseDelayMs: parsePositiveInt(retryBaseDelayMs, DEFAULTS.retryBaseDelayMs),
			},
			bash: { timeoutSec: parsePositiveInt(bashTimeoutSec, DEFAULTS.bashTimeoutSec) },
			webFetch: {
				timeoutMs: parsePositiveInt(webFetchTimeout, 15000),
				maxBytes: parsePositiveInt(webFetchMaxBytes, 1_000_000),
				maxChars: parsePositiveInt(webFetchMaxChars, 50_000),
				userAgent: webFetchUserAgent.trim() || undefined,
			},
			compaction: {
				thresholdRatio: Number(compactionThreshold) || 0.8,
				digestMaxItems: parsePositiveInt(compactionDigestMaxItems, 10),
				maxOverflowRetries: parsePositiveInt(compactionOverflowRetries, 1),
				...(current?.compaction?.prune ? { prune: current.compaction.prune } : {}),
			},
			delete: { strict: strictDelete },
			explorer: {
				lineGap: Number(explorerLineGap) || DEFAULTS.explorerLineGap,
				fold: { braces: explorerFoldBraces, markdown: explorerFoldMarkdown },
			},
			highlight: {
				tokenizeMaxLineLength: parsePositiveInt(highlightMaxLineLength, DEFAULTS.highlightMaxLineLength),
				tokenizeTimeLimit: parsePositiveInt(highlightTimeLimit, DEFAULTS.highlightTimeLimit),
			},
			...(parseIgnoreDirs().length > 0 ? { palette: { searchIgnoreDirs: parseIgnoreDirs() } } : {}),
		};
	};

	const flashError = (message: string) => {
		setError(message);
		clearTimeout(errorTimer.current);
		errorTimer.current = setTimeout(() => setError(null), 3000);
	};

	const persist = async (settings: SettingsData, credentials?: Record<string, string>): Promise<boolean> => {
		const run = saveChain.current.then(() => settingsView.mutate.save(settings, credentials ?? {}));
		saveChain.current = run.catch(() => {});
		const res = await run;
		if (!res.ok) {
			flashError(res.error ?? "保存失败");
			return false;
		}
		return true;
	};

	function persistSkillsDirs(next?: string[]) {
		const dirs = (next ?? skillsDirs).map((dir) => dir.trim()).filter(Boolean);
		if (next) setSkillsDirs(next);
		void persist({ ...currentSettings(), skills_dirs: dirs });
	}

	function persistExplorer(patch: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } }) {
		const current = currentSettings();
		const explorer = current.explorer ?? {};
		void persist({ ...current, explorer: { ...explorer, ...patch, fold: { ...explorer.fold, ...patch.fold } } });
	}

	const updateSkillsDir = (i: number, value: string) => setSkillsDirs((prev) => prev.map((dir, idx) => (idx === i ? value : dir)));
	const addSkillsDir = () => setSkillsDirs((prev) => [...prev, ""]);
	const removeSkillsDir = (i: number) => {
		const next = skillsDirs.filter((_, idx) => idx !== i);
		setSkillsDirs(next);
		persistSkillsDirs(next);
	};

	const configured = (id: string) => runtime?.providers.find((p) => p.id === id)?.configured ?? false;
	const runtimeRow = (id: string) => runtime?.providers.find((p) => p.id === id);
	const addable = () => {
		const builtin = (runtime?.allProviders ?? []).filter((p) => !added.includes(p));
		const custom = (customProviders ?? []).map((def) => def.id).filter((id) => !added.includes(id));
		return [...builtin, ...custom];
	};

	const add = async () => {
		const id = toAdd || addable()[0];
		const key = id ? keys[id] : undefined;
		if (!id || !key) return;
		const nextProviders = [...added, id];
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
		const nextProviders = added.filter((p) => p !== id);
		const nextCustom = (customProviders ?? []).filter((def) => def.id !== id);
		const ok = await persist({ ...currentSettings(), providers: nextProviders, customProviders: nextCustom });
		if (!ok) return;
		setAdded(nextProviders);
		setCustomProviders(nextCustom);
	};

	const customDef = (id: string) => customProviders?.find((def) => def.id === id);
	const pendingCustom = (customProviders ?? []).map((def) => def.id).filter((id) => !added.includes(id));
	const tableRows = [...added, ...pendingCustom];
	const rowBaseUrl = (id: string) => runtimeRow(id)?.baseUrl ?? customDef(id)?.baseUrl;
	const rowModelCount = (id: string) => runtimeRow(id)?.modelCount ?? customDef(id)?.models.length ?? 0;

	const resetCp = () => {
		setCp({ ...EMPTY_CP });
		setCpAdvanced(false);
		setEditAdvanced(false);
	};

	const applyCustom = async () => {
		const id = cp.id.trim();
		const models = buildModels(cp.models);
		if (!id || !cp.baseUrl.trim() || models.length === 0) return;
		if ((customProviders ?? []).some((def) => def.id === id)) {
			flashError(`Duplicate provider id "${id}".`);
			return;
		}
		const def: CustomProvider = {
			id,
			...(cp.name.trim() ? { name: cp.name.trim() } : {}),
			baseUrl: cp.baseUrl.trim(),
			models,
			...(cp.window.trim() && Number.isFinite(Number(cp.window)) ? { defaultContextWindow: Number(cp.window) } : {}),
			...(cp.maxTokens.trim() && Number.isFinite(Number(cp.maxTokens)) ? { defaultMaxTokens: Number(cp.maxTokens) } : {}),
		};
		const list = [...(customProviders ?? []), def];
		const ok = await persist({ ...currentSettings(), customProviders: list });
		if (!ok) return;
		setCustomProviders(list);
		setAddKind("builtin");
		setToAdd(id);
		resetCp();
	};

	const toggleKey = (id: string) => {
		if (keyEditId === id) {
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
		const id = keyEditId;
		if (!id || !keyDraft.trim()) return;
		const ok = await persist(currentSettings(), { [id]: keyDraft.trim() });
		if (!ok) return;
		setKeyDraft("");
		setKeyEditId(null);
	};

	const clearKey = async () => {
		const id = keyEditId;
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
			models: def.models.length ? def.models.map((model) => ({ id: model.id, window: model.contextWindow ? String(model.contextWindow) : "" })) : [{ id: "", window: "" }],
			window: def.defaultContextWindow ? String(def.defaultContextWindow) : "",
			maxTokens: def.defaultMaxTokens ? String(def.defaultMaxTokens) : "",
		});
		setEditingId(def.id);
		setEditAdvanced(false);
	};

	const saveCustomEdit = async () => {
		const id = editingId;
		const def = id ? customDef(id) : undefined;
		const models = buildModels(cp.models);
		if (!id || !def || !cp.baseUrl.trim() || models.length === 0) return;
		const next = {
			...def,
			...(cp.name.trim() ? { name: cp.name.trim() } : {}),
			baseUrl: cp.baseUrl.trim(),
			models,
			...(cp.window.trim() && Number.isFinite(Number(cp.window)) ? { defaultContextWindow: Number(cp.window) } : {}),
			...(cp.maxTokens.trim() && Number.isFinite(Number(cp.maxTokens)) ? { defaultMaxTokens: Number(cp.maxTokens) } : {}),
		};
		const list = (customProviders ?? []).map((item) => (item.id === id ? next : item));
		const ok = await persist({ ...currentSettings(), customProviders: list });
		if (!ok) return;
		setCustomProviders(list);
		setEditingId(null);
	};

	const providersConfigured = (runtime?.providers ?? []).filter((p) => p.configured).length;

	const numberField = (value: string, setValue: (next: string) => void, opts: { title: string; ariaLabel: string; min?: number; max?: number; step?: number; width: string }) => (
		<TextField className={`${opts.width} shrink-0 gap-0`}>
			<TextFieldInput
				type="number"
				min={opts.min}
				max={opts.max}
				step={opts.step}
				variant="compact"
				title={opts.title}
				aria-label={opts.ariaLabel}
				value={value}
				onChange={(event) => setValue(event.currentTarget.value)}
				onBlur={() => {
					const next = parsePositiveInt(value, 0);
					if (String(next) !== value) setValue(String(next));
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
				}}
			/>
		</TextField>
	);

	const rows: { id: string; title: string; desc: string; cats: CatId[]; stacked?: boolean; modified: boolean; control: React.ReactNode }[] = [
		{
			id: "theme",
			title: "Theme",
			desc: "UI theme; system follows the OS.",
			cats: ["general"],
			stacked: true,
			modified: theme !== DEFAULTS.theme,
			control: (
				<div className="grid grid-cols-3 gap-2">
					{(
						[
							{ value: "system" as ThemeMode, label: "System", hint: "Follow OS" },
							{ value: "light" as ThemeMode, label: "Light", hint: "Always light" },
							{ value: "dark" as ThemeMode, label: "Dark", hint: "Always dark" },
						] as const
					).map((option) => (
						<button
							type="button"
							key={option.value}
							className={cn(
								"group flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors",
								theme === option.value ? "border-seal/60 bg-seal/10" : "border-hairline bg-paper hover:border-ink-soft hover:bg-paper-hover",
							)}
							onClick={() => {
								setTheme(option.value);
								void persist({ ...currentSettings(), theme: option.value });
							}}
						>
							<span className={cn("font-sans text-[12px] leading-tight", theme === option.value ? "text-seal" : "text-ink")}>{option.label}</span>
							<span className="font-sans text-[10px] leading-tight text-body-muted">{option.hint}</span>
						</button>
					))}
				</div>
			),
		},
		{
			id: "dockSide",
			title: "Dock side",
			desc: "Dock Explorer and Git Changes to the left or right.",
			cats: ["general"],
			modified: dockSide !== DEFAULTS.dockSide,
			control: (
				<Select
					class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[150px] rounded-[10px]"
					title="Dock side"
					ariaLabel="Dock side"
					portalMount={rootRef.current}
					value={dockSide}
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
			modified: defaultSandboxMode !== DEFAULTS.sandbox,
			control: (
				<Select
					class="h-[32px] w-[200px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[200px] rounded-[10px]"
					title="Default sandbox mode"
					ariaLabel="Default sandbox mode"
					portalMount={rootRef.current}
					value={defaultSandboxMode}
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
			modified: path.trim() !== "" && path.trim() !== DEFAULTS.path,
			control: (
				<PickFile
					class="w-[200px] shrink-0"
					value={path}
					title="Partner profile path"
					ariaLabel="Partner profile path"
					onPick={(next) => {
						setPath(next);
						const saved = settingsData?.partner_profile_path ?? DEFAULTS.path;
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
			modified: commandsPath.trim() !== "" && commandsPath.trim() !== DEFAULTS.commandsPath,
			control: (
				<PickFile
					class="w-[200px] shrink-0"
					value={commandsPath}
					title="Commands directory"
					ariaLabel="Commands directory"
					onPick={(next) => {
						setCommandsPath(next);
						const saved = settingsData?.commands_path?.trim() || DEFAULTS.commandsPath;
						if (next === saved) return;
						void persist({ ...currentSettings(), commands_path: next });
					}}
				/>
			),
		},
		{
			id: "bashTimeout",
			title: "Bash timeout (s)",
			desc: "Max time a bash command may run before its process group is killed.",
			cats: ["tools"],
			modified: parsePositiveInt(bashTimeoutSec, DEFAULTS.bashTimeoutSec) !== DEFAULTS.bashTimeoutSec,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={1}
						variant="compact"
						title="Bash timeout (s)"
						aria-label="Bash timeout (s)"
						value={bashTimeoutSec}
						onChange={(event) => setBashTimeoutSec(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(bashTimeoutSec, DEFAULTS.bashTimeoutSec);
							const saved = settingsData?.bash?.timeoutSec ?? DEFAULTS.bashTimeoutSec;
							if (next === saved) return;
							void persist({ ...currentSettings(), bash: { timeoutSec: next } });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchTimeout",
			title: "Web fetch timeout (ms)",
			desc: "Max time a fetch may take before aborting.",
			cats: ["tools"],
			modified: parsePositiveInt(webFetchTimeout, 15000) !== 15000,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch timeout (ms)"
						aria-label="Web fetch timeout (ms)"
						value={webFetchTimeout}
						onChange={(event) => setWebFetchTimeout(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(webFetchTimeout, 15000);
							const saved = settingsData?.webFetch?.timeoutMs ?? 15000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: next,
									maxBytes: parsePositiveInt(webFetchMaxBytes, 1_000_000),
									maxChars: parsePositiveInt(webFetchMaxChars, 50_000),
									userAgent: webFetchUserAgent.trim() || undefined,
								},
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchMaxBytes",
			title: "Web fetch max bytes",
			desc: "Response body size cap in bytes; larger responses are rejected.",
			cats: ["tools"],
			modified: parsePositiveInt(webFetchMaxBytes, 1_000_000) !== 1_000_000,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch max bytes"
						aria-label="Web fetch max bytes"
						value={webFetchMaxBytes}
						onChange={(event) => setWebFetchMaxBytes(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(webFetchMaxBytes, 1_000_000);
							const saved = settingsData?.webFetch?.maxBytes ?? 1_000_000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout, 15000),
									maxBytes: next,
									maxChars: parsePositiveInt(webFetchMaxChars, 50_000),
									userAgent: webFetchUserAgent.trim() || undefined,
								},
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchMaxChars",
			title: "Web fetch max chars",
			desc: "Character cap for the text returned to the model.",
			cats: ["tools"],
			modified: parsePositiveInt(webFetchMaxChars, 50_000) !== 50_000,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Web fetch max chars"
						aria-label="Web fetch max chars"
						value={webFetchMaxChars}
						onChange={(event) => setWebFetchMaxChars(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(webFetchMaxChars, 50_000);
							const saved = settingsData?.webFetch?.maxChars ?? 50_000;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout, 15000),
									maxBytes: parsePositiveInt(webFetchMaxBytes, 1_000_000),
									maxChars: next,
									userAgent: webFetchUserAgent.trim() || undefined,
								},
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "webFetchUserAgent",
			title: "Web fetch user agent",
			desc: "User-Agent header sent with web_fetch requests.",
			cats: ["tools"],
			modified: webFetchUserAgent.trim() !== "Letters-web-fetch/0.1",
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						variant="compact"
						title="Web fetch user agent"
						aria-label="Web fetch user agent"
						value={webFetchUserAgent}
						onChange={(event) => setWebFetchUserAgent(event.currentTarget.value)}
						onBlur={() => {
							const next = webFetchUserAgent.trim();
							const saved = settingsData?.webFetch?.userAgent?.trim() ?? "Letters-web-fetch/0.1";
							if (next === saved) return;
							void persist({
								...currentSettings(),
								webFetch: {
									timeoutMs: parsePositiveInt(webFetchTimeout, 15000),
									maxBytes: parsePositiveInt(webFetchMaxBytes, 1_000_000),
									maxChars: parsePositiveInt(webFetchMaxChars, 50_000),
									userAgent: next || undefined,
								},
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
						spellCheck={false}
					/>
				</TextField>
			),
		},
		{
			id: "compactionThreshold",
			title: "Compaction threshold ratio",
			desc: "Auto-compact when usage reaches this fraction of the context window.",
			cats: ["compaction"],
			modified: (Number(compactionThreshold) || 0.8) !== 0.8,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						max={1}
						step={0.05}
						variant="compact"
						title="Compaction threshold ratio"
						aria-label="Compaction threshold ratio"
						value={compactionThreshold}
						onChange={(event) => setCompactionThreshold(event.currentTarget.value)}
						onBlur={() => {
							const next = Number(compactionThreshold) || 0.8;
							const saved = settingsData?.compaction?.thresholdRatio ?? 0.8;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: {
									digestMaxItems: parsePositiveInt(compactionDigestMaxItems, 10),
									maxOverflowRetries: parsePositiveInt(compactionOverflowRetries, 1),
									...(compactionThreshold ? { thresholdRatio: next } : {}),
								},
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: parsePositiveInt(compactionDigestMaxItems, 10) !== 10,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Checkpoint digest items"
						aria-label="Checkpoint digest items"
						value={compactionDigestMaxItems}
						onChange={(event) => setCompactionDigestMaxItems(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(compactionDigestMaxItems, 10);
							const saved = settingsData?.compaction?.digestMaxItems ?? 10;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: { digestMaxItems: next, maxOverflowRetries: parsePositiveInt(compactionOverflowRetries, 1) },
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "compactionOverflowRetries",
			title: "Compact-and-retry attempts",
			desc: "Max compact-and-retry attempts after a context overflow.",
			cats: ["compaction"],
			modified: parsePositiveInt(compactionOverflowRetries, 1) !== 1,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Compact-and-retry attempts"
						aria-label="Compact-and-retry attempts"
						value={compactionOverflowRetries}
						onChange={(event) => setCompactionOverflowRetries(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(compactionOverflowRetries, 1);
							const saved = settingsData?.compaction?.maxOverflowRetries ?? 1;
							if (next === saved) return;
							void persist({
								...currentSettings(),
								compaction: { digestMaxItems: parsePositiveInt(compactionDigestMaxItems, 10), maxOverflowRetries: next },
							});
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: parsePositiveInt(retryMaxRetries, DEFAULTS.retryMaxRetries) !== DEFAULTS.retryMaxRetries,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Retry max attempts"
						aria-label="Retry max attempts"
						value={retryMaxRetries}
						onChange={(event) => setRetryMaxRetries(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(retryMaxRetries, DEFAULTS.retryMaxRetries);
							const saved = settingsData?.retry?.maxRetries ?? DEFAULTS.retryMaxRetries;
							if (next === saved) return;
							void persist({ ...currentSettings(), retry: { maxRetries: next, baseDelayMs: parsePositiveInt(retryBaseDelayMs, DEFAULTS.retryBaseDelayMs) } });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: parsePositiveInt(retryBaseDelayMs, DEFAULTS.retryBaseDelayMs) !== DEFAULTS.retryBaseDelayMs,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Retry base delay (ms)"
						aria-label="Retry base delay (ms)"
						value={retryBaseDelayMs}
						onChange={(event) => setRetryBaseDelayMs(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(retryBaseDelayMs, DEFAULTS.retryBaseDelayMs);
							const saved = settingsData?.retry?.baseDelayMs ?? DEFAULTS.retryBaseDelayMs;
							if (next === saved) return;
							void persist({ ...currentSettings(), retry: { maxRetries: parsePositiveInt(retryMaxRetries, DEFAULTS.retryMaxRetries), baseDelayMs: next } });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: instructionsFile.trim() !== "" && instructionsFile.trim() !== DEFAULTS.instructions,
			control: (
				<TextField className="w-[200px] shrink-0">
					<TextFieldInput
						variant="compact"
						title="Instructions file"
						aria-label="Instructions file"
						value={instructionsFile}
						onChange={(event) => setInstructionsFile(event.currentTarget.value)}
						onBlur={() => {
							const next = instructionsFile.trim() || DEFAULTS.instructions;
							if (next === (settingsData?.detect_instructions_file ?? DEFAULTS.instructions)) return;
							void persist({ ...currentSettings(), detect_instructions_file: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
						spellCheck={false}
					/>
				</TextField>
			),
		},
		{
			id: "interval",
			title: "Send message interval",
			desc: "How often visible updates are sent during a run; ∞ sends only the first and final message.",
			cats: ["general"],
			modified: deliveryMode === "custom",
			control: (
				<div className="flex h-[32px] items-center gap-2">
					<Select
						class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
						itemClass="font-sans text-[12px]"
						contentClass="w-[150px] rounded-[10px]"
						title="Send message interval"
						ariaLabel="Send message interval"
						portalMount={rootRef.current}
						value={deliveryMode}
						onChange={(value) => {
							const next = value as "unlimited" | "custom";
							setDeliveryMode(next);
							void persist({ ...currentSettings(), sendMessageIntervalSec: next === "unlimited" ? null : parsedDeliverySec() });
						}}
						options={[
							{ value: "unlimited", label: "∞ first + last" },
							{ value: "custom", label: "custom" },
						]}
					/>
					{deliveryMode === "custom" && (
						<TextField className="h-[32px] w-[90px] shrink-0 gap-0">
							<TextFieldInput
								type="number"
								min={20}
								variant="compact"
								title="Send message interval seconds"
								aria-label="Send message interval seconds"
								value={deliverySec}
								onChange={(event) => setDeliverySec(event.currentTarget.value)}
								onBlur={() => {
									const sec = parsedDeliverySec();
									setDeliverySec(String(sec));
									void persist({ ...currentSettings(), sendMessageIntervalSec: sec });
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
								}}
							/>
						</TextField>
					)}
				</div>
			),
		},
		{
			id: "shellContinuous",
			title: "Continuous shell input",
			desc: "Keep shell mode active after sending; turn off to leave shell mode as soon as a command is sent.",
			cats: ["general"],
			modified: shellContinuous !== DEFAULTS.shellContinuous,
			control: (
				<SwitchToggle
					checked={shellContinuous}
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
			modified: memoryEnabled !== DEFAULTS.memoryEnabled,
			control: (
				<SwitchToggle
					checked={memoryEnabled}
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
			modified: memoryIdleMinutes !== String(DEFAULTS.memoryIdleMinutes),
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Memory idle delay (minutes)"
						aria-label="Memory idle delay"
						value={memoryIdleMinutes}
						onChange={(event) => setMemoryIdleMinutes(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(memoryIdleMinutes, DEFAULTS.memoryIdleMinutes);
							setMemoryIdleMinutes(String(next));
							void persist({ ...currentSettings(), memoryIdleMinutes: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "memoryPendingRounds",
			title: "Memory rounds before organize",
			desc: "User rounds since the last checkpoint before background memory organization runs; 0 disables it.",
			cats: ["memory"],
			modified: memoryPendingRounds !== String(DEFAULTS.memoryPendingRounds),
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						variant="compact"
						title="Memory rounds before organize"
						aria-label="Memory rounds before organize"
						value={memoryPendingRounds}
						onChange={(event) => setMemoryPendingRounds(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(memoryPendingRounds, DEFAULTS.memoryPendingRounds);
							setMemoryPendingRounds(String(next));
							void persist({ ...currentSettings(), memoryPendingRounds: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: memoryMaxScenes !== String(DEFAULTS.memoryMaxScenes),
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={1}
						variant="compact"
						title="Max scene documents"
						aria-label="Max scene documents"
						value={memoryMaxScenes}
						onChange={(event) => setMemoryMaxScenes(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(memoryMaxScenes, DEFAULTS.memoryMaxScenes);
							setMemoryMaxScenes(String(next));
							void persist({ ...currentSettings(), memoryMaxScenes: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: toastPlacement !== DEFAULTS.toastPlacement,
			control: (
				<Select
					class="h-[32px] w-[150px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[150px] rounded-[10px]"
					title="Toast placement"
					ariaLabel="Toast placement"
					portalMount={rootRef.current}
					value={toastPlacement}
					onChange={(value) => {
						const placement = value as ToastPlacement;
						setToastPlacement(placement);
						void persist({ ...currentSettings(), toastPlacement: placement });
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
			modified: parsePositiveInt(toastDurationMs, DEFAULTS.toastDurationMs) !== DEFAULTS.toastDurationMs,
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						step={500}
						variant="compact"
						title="Toast duration (ms)"
						aria-label="Toast duration (ms)"
						value={toastDurationMs}
						onChange={(event) => setToastDurationMs(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(toastDurationMs, DEFAULTS.toastDurationMs);
							setToastDurationMs(String(next));
							void persist({ ...currentSettings(), toastDurationMs: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
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
			modified: JSON.stringify(skillsDirs.map((dir) => dir.trim()).filter(Boolean)) !== JSON.stringify(DEFAULTS.skills_dirs),
			control: (
				<div className="flex flex-col gap-1.5">
					<table className="w-full text-left">
						<thead>
							<tr>
								<th className="pb-1 font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Directory</th>
								<th className="w-10 pb-1" />
							</tr>
						</thead>
						<tbody>
							{skillsDirs.map((dir, i) => (
								<tr key={i}>
									<td className="pb-1 pr-2">
										<TextField className="w-full">
											<TextFieldInput
												variant="compact"
												className="w-full"
												value={dir}
												onChange={(event) => updateSkillsDir(i, event.currentTarget.value)}
												placeholder=".agents/skills"
												aria-label="Skills directory"
												spellCheck={false}
												onBlur={() => persistSkillsDirs()}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
												}}
											/>
										</TextField>
									</td>
									<td className="pb-1 text-right">
										<Button variant="ghost" size="sm" title="Remove directory" onClick={() => removeSkillsDir(i)}>
											×
										</Button>
									</td>
								</tr>
							))}
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
			modified: skillsWatch !== DEFAULTS.skills_watch,
			control: (
				<SwitchToggle
					checked={skillsWatch}
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
			modified: parsePositiveInt(skillsWatchDelay, DEFAULTS.skills_watch_delay_ms) !== DEFAULTS.skills_watch_delay_ms,
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						step={100}
						variant="compact"
						title="Skill watch delay (ms)"
						aria-label="Skill watch delay (ms)"
						value={skillsWatchDelay}
						onChange={(event) => setSkillsWatchDelay(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(skillsWatchDelay, DEFAULTS.skills_watch_delay_ms);
							setSkillsWatchDelay(String(next));
							void persist({ ...currentSettings(), skills_watch_delay_ms: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "strictDelete",
			title: "Strict delete mode",
			desc: "Refuse `rm`/`rmdir` in bash and only allow the rm tool after a move to the trash has failed. Turn it off to let bash delete directly.",
			cats: ["permission"],
			modified: strictDelete !== DEFAULTS.strictDelete,
			control: (
				<SwitchToggle
					checked={strictDelete}
					onChange={(on) => {
						setStrictDelete(on);
						void persist({ ...currentSettings(), delete: { strict: on } });
					}}
				/>
			),
		},
		{
			id: "explorerLineGap",
			title: "File preview line gap",
			desc: "Extra visual spacing between code lines; line-height is 1 + gap.",
			cats: ["general"],
			modified: Number(explorerLineGap) !== DEFAULTS.explorerLineGap,
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						max={1}
						step={0.05}
						variant="compact"
						title="File preview line gap"
						aria-label="File preview line gap"
						value={explorerLineGap}
						onChange={(event) => setExplorerLineGap(event.currentTarget.value)}
						onBlur={() => {
							const parsed = Number(explorerLineGap);
							const next = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS.explorerLineGap;
							setExplorerLineGap(String(next));
							const saved = settingsData?.explorer?.lineGap ?? DEFAULTS.explorerLineGap;
							if (next === saved) return;
							void persistExplorer({ lineGap: next });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "explorerFoldBraces",
			title: "Fold code",
			desc: "Fold blocks, objects and elements in the reader's code, for the languages it parses: ts, tsx, js, jsx, python, html, css, json, yaml, xml.",
			cats: ["general"],
			modified: explorerFoldBraces !== DEFAULTS.explorerFoldBraces,
			control: (
				<SwitchToggle
					checked={explorerFoldBraces}
					onChange={(on) => {
						setExplorerFoldBraces(on);
						void persistExplorer({ fold: { braces: on } });
					}}
				/>
			),
		},
		{
			id: "explorerFoldMarkdown",
			title: "Fold markdown",
			desc: "Fold sections in a raw markdown file.",
			cats: ["general"],
			modified: explorerFoldMarkdown !== DEFAULTS.explorerFoldMarkdown,
			control: (
				<SwitchToggle
					checked={explorerFoldMarkdown}
					onChange={(on) => {
						setExplorerFoldMarkdown(on);
						void persistExplorer({ fold: { markdown: on } });
					}}
				/>
			),
		},
		{
			id: "highlightMaxLineLength",
			title: "Highlight line length limit",
			desc: "Code lines longer than this many characters are shown unhighlighted; 0 lifts the limit.",
			cats: ["general"],
			modified: parsePositiveInt(highlightMaxLineLength, DEFAULTS.highlightMaxLineLength) !== DEFAULTS.highlightMaxLineLength,
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						step={500}
						variant="compact"
						title="Highlight line length limit (characters)"
						aria-label="Highlight line length limit (characters)"
						value={highlightMaxLineLength}
						onChange={(event) => setHighlightMaxLineLength(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(highlightMaxLineLength, DEFAULTS.highlightMaxLineLength);
							setHighlightMaxLineLength(String(next));
							const saved = settingsData?.highlight?.tokenizeMaxLineLength ?? DEFAULTS.highlightMaxLineLength;
							if (next === saved) return;
							void persist(currentSettings());
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "highlightTimeLimit",
			title: "Highlight time limit",
			desc: "Milliseconds shiki may spend tokenizing one line before it gives up.",
			cats: ["general"],
			modified: parsePositiveInt(highlightTimeLimit, DEFAULTS.highlightTimeLimit) !== DEFAULTS.highlightTimeLimit,
			control: (
				<TextField className="h-[32px] w-[110px] shrink-0 gap-0">
					<TextFieldInput
						type="number"
						min={0}
						step={100}
						variant="compact"
						title="Highlight time limit (ms)"
						aria-label="Highlight time limit (ms)"
						value={highlightTimeLimit}
						onChange={(event) => setHighlightTimeLimit(event.currentTarget.value)}
						onBlur={() => {
							const next = parsePositiveInt(highlightTimeLimit, DEFAULTS.highlightTimeLimit);
							setHighlightTimeLimit(String(next));
							const saved = settingsData?.highlight?.tokenizeTimeLimit ?? DEFAULTS.highlightTimeLimit;
							if (next === saved) return;
							void persist(currentSettings());
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
		{
			id: "paletteSearchIgnoreDirs",
			title: "File search ignore list",
			desc: "Directories (and files like .DS_Store) the Cmd+P file search skips. Leave empty for the built-in list.",
			cats: ["general"],
			modified: parseIgnoreDirs().length > 0,
			control: (
				<TextField className="h-[32px] w-[280px] shrink-0 gap-0">
					<TextFieldInput
						variant="compact"
						placeholder=".git, node_modules, dist"
						title="File search ignore list"
						aria-label="File search ignore list"
						value={paletteIgnoreDirs}
						onChange={(event) => setPaletteIgnoreDirs(event.currentTarget.value)}
						onBlur={() => {
							void persist(parseIgnoreDirs().length > 0 ? currentSettings() : { ...currentSettings(), palette: undefined });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
						}}
					/>
				</TextField>
			),
		},
	];

	const q = query.trim().toLowerCase();
	const searching = q !== "";
	const matches = (text: string) => text.toLowerCase().includes(q);
	const matchedRows = rows.filter((row) => matches(row.title) || matches(row.desc));
	const providerMatches = added.filter((id) => matches(id));
	const totalMatches = matchedRows.length + providerMatches.length;
	const catHasMatches = (cat: CatId) => (cat === "providers" ? providerMatches.length > 0 : matchedRows.some((row) => row.cats.includes(cat)));

	const selectCat = (cat: CatId) => {
		setTab(cat);
		setQuery("");
	};

	const providerFields = (readonlyId?: boolean) => (
		<>
			<Field label="ID">
				<TextField className="w-full">
					<TextFieldInput
						variant="compact"
						className="w-full font-sans"
						value={cp.id}
						onChange={(event) => setCp({ ...cp, id: event.currentTarget.value })}
						readOnly={readonlyId}
						placeholder="my-gateway"
						aria-label="Custom provider id"
						spellCheck={false}
					/>
				</TextField>
			</Field>
			<Field label="Base URL">
				<TextField className="w-full">
					<TextFieldInput
						variant="compact"
						className="w-full font-sans"
						value={cp.baseUrl}
						onChange={(event) => setCp({ ...cp, baseUrl: event.currentTarget.value })}
						placeholder="https://gateway.example.com/v1"
						aria-label="Base URL"
						spellCheck={false}
					/>
				</TextField>
			</Field>
			<ModelRows rows={cp.models} onChange={(models) => setCp({ ...cp, models })} />
		</>
	);

	const providerAdvanced = (value: CpForm, set: (next: CpForm) => void, open: boolean, toggle: () => void) => (
		<>
			<button type="button" className="justify-self-start font-mono text-[10px] text-muted transition-colors hover:text-ink" onClick={toggle}>
				{open ? "− Advanced" : "+ Advanced"}
			</button>
			{open && (
				<div className="grid gap-3">
					<Field label="Name">
						<TextField className="w-full">
							<TextFieldInput
								variant="compact"
								className="w-full font-sans"
								value={value.name}
								onChange={(event) => set({ ...value, name: event.currentTarget.value })}
								placeholder="My Gateway"
								aria-label="Display name"
								spellCheck={false}
							/>
						</TextField>
					</Field>
					<Field label="Window">
						<TextField className="w-full">
							<TextFieldInput
								variant="compact"
								className="w-full"
								value={value.window}
								onChange={(event) => set({ ...value, window: event.currentTarget.value })}
								placeholder="128000"
								aria-label="Default context window"
								spellCheck={false}
							/>
						</TextField>
					</Field>
					<Field label="Max tokens">
						<TextField className="w-full">
							<TextFieldInput
								variant="compact"
								className="w-full"
								value={value.maxTokens}
								onChange={(event) => set({ ...value, maxTokens: event.currentTarget.value })}
								placeholder="8192"
								aria-label="Default max tokens"
								spellCheck={false}
							/>
						</TextField>
					</Field>
				</div>
			)}
		</>
	);

	void numberField;

	return (
		<div
			className="flex h-full min-h-0"
			ref={rootRef}
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				const hadEdit = adding || editingId != null || keyEditId != null;
				setAdding(false);
				setEditingId(null);
				setKeyEditId(null);
				resetCp();
				setAddKind("builtin");
				if (hadEdit) event.preventDefault();
			}}
		>
			<nav className="flex w-[184px] shrink-0 flex-col border-r border-hairline py-5">
				<div className="space-y-1.5 px-5">
					{CATS.map((cat) => (
						<button
							type="button"
							key={cat.id}
							onClick={() => selectCat(cat.id)}
							className={cn(
								"flex h-[36px] w-full items-center rounded-[8px] px-3 text-left font-serif text-[13px] transition-colors",
								tab === cat.id ? "bg-paper-hover text-ink" : "text-ink-soft hover:bg-paper-hover",
							)}
						>
							{cat.label}
							{(searching ? catHasMatches(cat.id) : cat.id === "providers" && providersConfigured > 0) && (
								<span className={cn("ml-auto size-[5px] shrink-0 rounded-full", searching ? "bg-seal" : "bg-[#7FB069]")} />
							)}
						</button>
					))}
				</div>
				<span className="mt-auto px-6 pb-2 font-serif text-[11px] text-muted">letters</span>
			</nav>

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="px-6 pb-4 pt-3">
					<div className="relative">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 size-[14px] -translate-y-1/2 text-muted">
							<circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.6" />
							<path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
						</svg>
						<TextField className="w-full">
							<TextFieldInput
								variant="compact"
								className="pl-9 pr-14 font-sans"
								placeholder="Search settings"
								aria-label="Search settings"
								value={query}
								onChange={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape" && query.trim()) {
										event.preventDefault();
										setQuery("");
									}
								}}
								spellCheck={false}
							/>
						</TextField>
						{searching && (
							<span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
								{totalMatches} {totalMatches === 1 ? "match" : "matches"}
							</span>
						)}
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
					{searching ? (
						<div className="space-y-4">
							{CATS.map((cat) => (
								<div key={cat.id}>
									{catHasMatches(cat.id) && (
										<div>
											<div className="mb-3 font-serif text-[16px] font-medium text-ink">{cat.label}</div>
											<div className="divide-y divide-hairline">
												{matchedRows
													.filter((row) => row.cats.includes(cat.id))
													.map((row) => (
														<SettingRow key={row.id} title={row.title} desc={row.desc} modified={row.modified} q={q} stacked={row.stacked}>
															{row.control}
														</SettingRow>
													))}
												{cat.id === "providers" &&
													providerMatches.map((id) => (
														<div className="flex items-center gap-2 py-3.5" key={id}>
															<span className="font-serif text-[13px] text-ink">{highlight(id, q)}</span>
															{configured(id) && <span className="size-[5px] shrink-0 rounded-full bg-[#7FB069]" title="configured" />}
														</div>
													))}
											</div>
										</div>
									)}
								</div>
							))}
							{totalMatches === 0 && (
								<div className="pt-8 text-center">
									<div className="font-serif text-[14px] text-ink-soft">No matching settings</div>
									<div className="mt-1 font-sans text-[11px] text-body-muted">Try a different search.</div>
								</div>
							)}
						</div>
					) : (
						<>
							{CATS.map((cat) => (
								<div key={cat.id}>
									{tab === cat.id && cat.id !== "providers" && (
										<div>
											<div className="mb-3 font-serif text-[16px] font-medium text-ink">{cat.label}</div>
											{cat.id === "tools" && <McpSettingsPanel />}
											<div className="divide-y divide-hairline">
												{rows
													.filter((row) => row.cats.includes(cat.id))
													.map((row) => (
														<SettingRow key={row.id} title={row.title} desc={row.desc} modified={row.modified} stacked={row.stacked}>
															{row.control}
														</SettingRow>
													))}
											</div>
										</div>
									)}
								</div>
							))}
							{tab === "providers" && (
								<div>
									<div className="mb-3 font-serif text-[16px] font-medium text-ink">Providers</div>
									{tableRows.length > 0 ? (
										<div className="divide-y divide-hairline">
											<div className={cn(COLS, "pb-1 font-sans text-[10px] text-muted")}>
												<span>Provider</span>
												<span>Base URL</span>
												<span>Models</span>
												<span className="text-right">…</span>
											</div>
											{tableRows.map((id) => {
												const def = customDef(id);
												return (
													<div key={id}>
														<div className={cn(COLS, "py-2")}>
															<span className="flex min-w-0 items-center gap-2">
																<span className="truncate font-serif text-[12px] text-ink">{id}</span>
																{configured(id) && <span className="size-[5px] shrink-0 rounded-full bg-[#7FB069]" title="configured" />}
															</span>
															<span className="truncate font-mono text-[10px] text-body-muted" title={rowBaseUrl(id) ?? ""}>
																{rowBaseUrl(id)}
															</span>
															<span className="font-mono text-[10px] text-muted">{rowModelCount(id)}</span>
															<span className="flex items-center justify-end gap-1">
																<button
																	type="button"
																	className="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																	onClick={() => toggleKey(id)}
																>
																	key
																</button>
																{def && (
																	<button
																		type="button"
																		className="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																		onClick={() => {
																			const target = customDef(id);
																			if (target) startEdit(target);
																		}}
																	>
																		edit
																	</button>
																)}
																<button
																	type="button"
																	className="flex h-6 w-6 items-center justify-center rounded-[8px] font-sans text-[14px] leading-none text-muted transition-colors hover:bg-paper-hover hover:text-ink"
																	aria-label={`remove ${id}`}
																	onClick={() => void remove(id)}
																>
																	×
																</button>
															</span>
														</div>
														{keyEditId === id && (
															<div className="py-3">
																<div className="flex items-center gap-2">
																	<TextField className="min-w-0 flex-1">
																		<TextFieldInput
																			variant="compact"
																			className="h-[30px] text-[11px]"
																			type="password"
																			placeholder={configured(id) ? "new key" : "sk-…"}
																			aria-label="API key"
																			spellCheck={false}
																			autoComplete="off"
																			value={keyDraft}
																			onChange={(event) => setKeyDraft(event.currentTarget.value)}
																			onKeyDown={(event) => {
																				if (event.key === "Enter") void saveKey();
																				if (event.key === "Escape") toggleKey(id);
																			}}
																		/>
																	</TextField>
																	<button
																		type="button"
																		className="h-[30px] shrink-0 rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
																		disabled={!keyDraft.trim()}
																		onClick={() => void saveKey()}
																	>
																		Save
																	</button>
																	{configured(id) && (
																		<button
																			type="button"
																			className="h-[30px] shrink-0 rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
																			onClick={() => void clearKey()}
																		>
																			Clear
																		</button>
																	)}
																</div>
															</div>
														)}
														{editingId === id && (
															<div className="py-3">
																<div className="grid gap-3">
																	{providerFields(true)}
																	{providerAdvanced(cp, setCp, editAdvanced, () => setEditAdvanced(!editAdvanced))}
																</div>
																<div className="mt-3 flex justify-end gap-2">
																	<button
																		type="button"
																		className="h-[28px] rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
																		onClick={() => setEditingId(null)}
																	>
																		Cancel
																	</button>
																	<button
																		type="button"
																		className="h-[28px] rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
																		disabled={!cp.baseUrl.trim() || !cp.models.some((model) => model.id.trim())}
																		onClick={() => void saveCustomEdit()}
																	>
																		Save
																	</button>
																</div>
															</div>
														)}
													</div>
												);
											})}
										</div>
									) : (
										<div className="mb-3 font-mono text-[11px] text-muted">no providers added — add one below</div>
									)}
									<div className="mt-2 border-t border-hairline pt-2">
										<button
											type="button"
											className="-mx-2 rounded-[8px] px-2 py-1 font-sans text-[11px] text-ink-soft transition-colors hover:bg-paper-hover hover:text-ink"
											onClick={() => {
												if (adding) {
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
											{adding ? "Cancel" : "+ Add provider"}
										</button>
										{adding && (
											<div className="pt-2">
												{addKind === "builtin" ? (
													<>
														<div className="grid gap-2">
															<Select
																class="h-[30px] w-40 rounded-[10px] font-sans text-[11px]"
																itemClass="font-sans text-[11px]"
																contentClass="w-40 rounded-[10px]"
																title="Add provider"
																ariaLabel="Add provider"
																placeholder="provider"
																portalMount={rootRef.current}
																value={toAdd || addable()[0] || ""}
																onChange={(value) => setToAdd(value)}
																options={addable().map((provider) => ({ value: provider, label: provider }))}
															/>
															<div className="flex items-center gap-2">
																<TextField className="min-w-0 flex-1">
																	<TextFieldInput
																		variant="compact"
																		className="h-[30px] text-[11px]"
																		type="password"
																		placeholder="api key（添加必填）"
																		aria-label="New provider api key"
																		spellCheck={false}
																		autoComplete="off"
																		value={keys[toAdd || addable()[0] || ""] ?? ""}
																		onChange={(event) => {
																			const id = toAdd || addable()[0];
																			if (id) setKeys({ ...keys, [id]: event.currentTarget.value });
																		}}
																	/>
																</TextField>
																<button
																	type="button"
																	className="h-[30px] shrink-0 rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:cursor-default disabled:opacity-35"
																	disabled={!(toAdd || addable()[0]) || !keys[toAdd || addable()[0] || ""]}
																	onClick={() => void add()}
																>
																	ADD
																</button>
															</div>
														</div>
														<button
															type="button"
															className="-mx-2 mt-2 rounded-[8px] px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
															onClick={() => setAddKind("custom")}
														>
															+ custom provider
														</button>
													</>
												) : (
													<>
														<div className="grid gap-3">
															{providerFields()}
															{providerAdvanced(cp, setCp, cpAdvanced, () => setCpAdvanced(!cpAdvanced))}
														</div>
														<div className="mt-3 flex justify-end gap-2">
															<button
																type="button"
																className="h-[28px] rounded-[10px] border border-hairline px-3 font-sans text-[11px] text-ink-soft transition-colors hover:text-ink"
																onClick={() => setAddKind("builtin")}
															>
																Back
															</button>
															<button
																type="button"
																className="h-[28px] rounded-[10px] bg-ink px-3 font-sans text-[11px] font-semibold text-paper disabled:opacity-35"
																disabled={!cp.id.trim() || !cp.baseUrl.trim() || !cp.models.some((model) => model.id.trim())}
																onClick={() => void applyCustom()}
															>
																APPLY
															</button>
														</div>
													</>
												)}
											</div>
										)}
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>

			{error && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12px] text-letter">{error}</div>}
		</div>
	);
}
