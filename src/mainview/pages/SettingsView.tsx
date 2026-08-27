import { createMemo, createSignal, For, indexArray, type JSX, Match, Show, Switch } from "solid-js";
import type { CustomModel, CustomProvider, SandboxMode, ThemeMode } from "../../shared/rpc";
import { Select } from "../components/ui/select";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { cn } from "../lib/utils";

export interface SettingsData {
	partner_profile_path: string;
	detect_instructions_file: string;
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	customProviders?: CustomProvider[];
	theme?: ThemeMode;
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
	{ id: "permission", label: "Permission" },
	{ id: "providers", label: "Providers" },
] as const;
type CatId = (typeof CATS)[number]["id"];

const DEFAULTS = {
	path: "~/.partner/",
	instructions: "AGENTS.md",
	theme: "system" as ThemeMode,
	sandbox: "workspace-write" as SandboxMode,
};

const EMPTY_CP = { id: "", name: "", baseUrl: "", models: [{ id: "", window: "" }], window: "", maxTokens: "" };
type CpForm = typeof EMPTY_CP;
type CpModelRow = CpForm["models"][number];

const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_56px_76px] items-center gap-2";

function SettingRow(props: { title: string; desc: string; modified?: boolean; q?: string; children: JSX.Element }) {
	return (
		<div class="flex min-h-[56px] items-center gap-5">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="font-serif text-[13px] leading-tight text-ink">{props.q ? highlight(props.title, props.q) : props.title}</span>
					<Show when={props.modified}>
						<span class="flex items-center gap-1.5">
							<span class="size-[5px] shrink-0 rounded-full bg-seal" />
							<span class="font-sans text-[10px] font-medium text-seal">modified</span>
						</span>
					</Show>
				</div>
				<div class="mt-1 font-sans text-[11px] leading-snug text-body-muted">{props.q ? highlight(props.desc, props.q) : props.desc}</div>
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

export function SettingsView(props: {
	settings: SettingsData | null;
	runtime: RuntimeInfo | null;
	onSave: (settings: SettingsData, credentials: Record<string, string>) => Promise<SaveResult>;
	onLoad: () => void;
}) {
	const [tab, setTab] = createSignal<CatId>("general");
	const [query, setQuery] = createSignal("");
	const [path, setPath] = createSignal("");
	const [instructionsFile, setInstructionsFile] = createSignal("");
	const [defaultSandboxMode, setDefaultSandboxMode] = createSignal<SandboxMode>("workspace-write");
	const [theme, setTheme] = createSignal<ThemeMode>("system");
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

	if (props.settings && path() === "" && props.settings.partner_profile_path !== path()) {
		setPath(props.settings.partner_profile_path);
	}
	if (props.settings && instructionsFile() === "" && props.settings.detect_instructions_file !== instructionsFile()) {
		setInstructionsFile(props.settings.detect_instructions_file);
	}
	if (props.settings && props.settings.defaultSandboxMode && defaultSandboxMode() !== props.settings.defaultSandboxMode) {
		setDefaultSandboxMode(props.settings.defaultSandboxMode);
	}
	if (props.settings && props.settings.theme !== undefined && theme() !== props.settings.theme) {
		setTheme(props.settings.theme);
	}
	if (props.settings && added().length === 0 && props.settings.providers?.length) {
		setAdded(props.settings.providers);
	}
	if (props.settings && customProviders() === null && props.settings.customProviders) {
		setCustomProviders(props.settings.customProviders);
	}
	if (!props.settings) props.onLoad();

	const currentSettings = (): SettingsData => ({
		partner_profile_path: path().trim() || "~/.partner/",
		detect_instructions_file: instructionsFile().trim() || "AGENTS.md",
		defaultSandboxMode: defaultSandboxMode(),
		providers: added(),
		customProviders: customProviders() ?? undefined,
		theme: theme(),
	});
	const flashError = (message: string) => {
		setError(message);
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => setError(null), 3000);
	};
	let saveChain: Promise<unknown> = Promise.resolve();

	const persist = async (settings: SettingsData, credentials?: Record<string, string>): Promise<boolean> => {
		const run = saveChain.then(() => props.onSave(settings, credentials ?? {}));
		saveChain = run.catch(() => {});
		const res = await run;
		if (!res.ok) {
			flashError(res.error ?? "保存失败");
			return false;
		}
		props.onLoad();
		return true;
	};

	const configured = (id: string) => props.runtime?.providers.find((p) => p.id === id)?.configured ?? false;
	const runtimeRow = (id: string) => props.runtime?.providers.find((p) => p.id === id);
	const addable = () => {
		const builtin = (props.runtime?.allProviders ?? []).filter((p) => !added().includes(p));
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

	const providersConfigured = () => (props.runtime?.providers ?? []).filter((p) => p.configured).length;

	const rows = (): {
		id: string;
		title: string;
		desc: string;
		cats: CatId[];
		modified: () => boolean;
		control: () => JSX.Element;
	}[] => [
		{
			id: "theme",
			title: "Theme",
			desc: "UI theme; system follows the OS.",
			cats: ["general"],
			modified: () => theme() !== DEFAULTS.theme,
			control: () => (
				<Select
					class="h-[32px] w-[200px] shrink-0 rounded-[10px] font-sans text-[12px]"
					itemClass="font-sans text-[12px]"
					contentClass="w-[200px] rounded-[10px]"
					title="Theme"
					ariaLabel="Theme"
					portalMount={rootRef}
					value={theme()}
					onChange={(value) => {
						const t = value as ThemeMode;
						setTheme(t);
						void persist({ ...currentSettings(), theme: t });
					}}
					options={[
						{ value: "system", label: "system" },
						{ value: "light", label: "light" },
						{ value: "dark", label: "dark" },
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
				<TextField class="w-[200px] shrink-0" value={path()} onChange={setPath}>
					<TextFieldInput
						variant="compact"
						title="Partner profile path"
						aria-label="Partner profile path"
						onBlur={() => void persist({ ...currentSettings(), partner_profile_path: path() })}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
						spellcheck={false}
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
						onBlur={() => void persist({ ...currentSettings(), detect_instructions_file: instructionsFile() })}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
						}}
						spellcheck={false}
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
			class="flex h-full"
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
			<nav class="flex w-[168px] shrink-0 flex-col border-r border-hairline py-4">
				<div class="space-y-1.5 px-4">
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
				<span class="mt-auto px-5 pb-1 font-serif text-[11px] text-muted">letters</span>
			</nav>

			<div class="flex min-h-0 flex-1 flex-col">
				<div class="px-3 pb-3 pt-2">
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

				<div class="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
					<Switch>
						<Match when={searching()}>
							<div class="space-y-4">
								<For each={CATS}>
									{(cat) => (
										<Show when={catHasMatches(cat.id)}>
											<div>
												<div class="mb-2 font-serif text-[15px] font-medium text-ink">{cat.label}</div>
												<div class="divide-y divide-hairline">
													<For each={matchedRows().filter((r) => r.cats.includes(cat.id))}>
														{(row) => (
															<SettingRow title={row.title} desc={row.desc} modified={row.modified()} q={q()}>
																{row.control()}
															</SettingRow>
														)}
													</For>
													<Show when={cat.id === "providers"}>
														<For each={providerMatches()}>
															{(id) => (
																<div class="flex min-h-[44px] items-center gap-2">
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
						</Match>
						<Match when={tab() === "general"}>
							<div>
								<div class="mb-2 font-serif text-[15px] font-medium text-ink">General</div>
								<div class="divide-y divide-hairline">
									<For each={rows().filter((r) => r.cats.includes("general"))}>
										{(row) => (
											<SettingRow title={row.title} desc={row.desc} modified={row.modified()}>
												{row.control()}
											</SettingRow>
										)}
									</For>
								</div>
							</div>
						</Match>
						<Match when={tab() === "permission"}>
							<div>
								<div class="mb-2 font-serif text-[15px] font-medium text-ink">Permission</div>
								<div class="divide-y divide-hairline">
									<For each={rows().filter((r) => r.cats.includes("permission"))}>
										{(row) => (
											<SettingRow title={row.title} desc={row.desc} modified={row.modified()}>
												{row.control()}
											</SettingRow>
										)}
									</For>
								</div>
							</div>
						</Match>
						<Match when={tab() === "providers"}>
							<div>
								<div class="mb-2 font-serif text-[15px] font-medium text-ink">Providers</div>
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
														<div class={cn(COLS, "min-h-[40px] py-1.5")}>
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
						</Match>
					</Switch>
				</div>
			</div>

			<Show when={error()}>
				<div class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12px] text-letter">{error()}</div>
			</Show>
		</div>
	);
}
