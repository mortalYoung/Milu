/**
 * SettingsView — split-pane settings: left nav (categories — a new setting is one nav item
 * + one pane), right content. Two editing models:
 * - string: click the value → inline edit → Enter/blur saves, Esc cancels
 * - array (providers): per-row ops — replace key in place, × removes (secret deleted),
 *   add row requires the api key
 * Everything saves immediately (no Save button): success is silent, failures surface in
 * a transient toast. Saved api keys are never previewed — only their configured state.
 */
import { createEffect, createSignal, For, Show } from "solid-js";
import type { SandboxMode, ThemeMode } from "../../shared/rpc";

export interface SettingsData {
	partner_profile_path: string;
	detect_instructions_file: string;
	/** The Permission setting: default sandbox mode for newly created partners. */
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	/** UI theme (system/light/dark). */
	theme?: ThemeMode;
}

export interface RuntimeInfo {
	providers: { id: string; configured: boolean }[];
	allProviders: string[];
}

export interface SaveResult {
	ok: boolean;
	error?: string;
}

/** String editing: click to edit, Enter/blur commits, Esc cancels. */
function EditableValue(props: { value: () => string; onCommit: (value: string) => Promise<void> }) {
	const [editing, setEditing] = createSignal(false);
	const [draft, setDraft] = createSignal("");
	let inputRef: HTMLInputElement | undefined;
	// Guards the commit-on-blur that fires right after commit-on-Enter (blur is async-late)
	let done = false;

	const start = () => {
		done = false;
		setDraft(props.value());
		setEditing(true);
	};
	const commit = async () => {
		if (done) return;
		done = true;
		setEditing(false);
		await props.onCommit(draft());
	};
	const cancel = () => {
		if (done) return;
		done = true;
		setEditing(false);
	};
	createEffect(() => {
		if (editing() && inputRef) {
			inputRef.focus();
			inputRef.select();
		}
	});

	return (
		<Show
			when={editing()}
			fallback={
				<span class="font-mono text-[12px] text-ink cursor-pointer px-1 border-b border-transparent hover:border-hairline" onClick={start}>
					{props.value()}
				</span>
			}
		>
			<input
				ref={inputRef}
				type="text"
				value={draft()}
				onInput={(e) => setDraft(e.currentTarget.value)}
				class="w-full bg-transparent border-b border-seal outline-none px-1 font-mono text-[12px] text-ink"
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void commit();
					}
					if (e.key === "Escape") cancel();
				}}
				onBlur={() => void commit()}
			/>
		</Show>
	);
}

export function SettingsView(props: {
	settings: SettingsData | null;
	runtime: RuntimeInfo | null;
	onSave: (settings: SettingsData, credentials: Record<string, string>) => Promise<SaveResult>;
	onLoad: () => void;
}) {
	const [tab, setTab] = createSignal<"general" | "permission" | "providers">("general");
	const [path, setPath] = createSignal("");
	const [instructionsFile, setInstructionsFile] = createSignal("");
	const [defaultSandboxMode, setDefaultSandboxMode] = createSignal<SandboxMode>("workspace-write");
	const [theme, setTheme] = createSignal<ThemeMode>("system");
	const [added, setAdded] = createSignal<string[]>([]);
	const [toAdd, setToAdd] = createSignal("");
	/** Keys typed this session (per provider) — non-empty entries go to .credentials.yaml on commit. */
	const [keys, setKeys] = createSignal<Record<string, string>>({});
	const [error, setError] = createSignal<string | null>(null);
	let errorTimer: ReturnType<typeof setTimeout> | undefined;

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
	if (!props.settings) props.onLoad();

	const currentSettings = (): SettingsData => ({
		partner_profile_path: path().trim() || "~/.partner/",
		detect_instructions_file: instructionsFile().trim() || "AGENTS.md",
		defaultSandboxMode: defaultSandboxMode(),
		providers: added(),
		theme: theme(),
	});
	const flashError = (message: string) => {
		setError(message);
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => setError(null), 3000);
	};
	// Saves are serialized: the backend diffs providers against the persisted file (read-modify-write),
	// so concurrent saves could both diff the same old value and miss a removal.
	let saveChain: Promise<unknown> = Promise.resolve();
	/** Immediate save: success is silent + refreshes the configured states, failure toasts. */
	const persist = async (settings: SettingsData, credentials?: Record<string, string>) => {
		const run = saveChain.then(() => props.onSave(settings, credentials ?? {}));
		saveChain = run.catch(() => {});
		const res = await run;
		if (!res.ok) {
			flashError(res.error ?? "保存失败");
			return;
		}
		// The runtime (per-provider configured states, nav dot) comes from get_settings — refresh it
		props.onLoad();
	};

	const configured = (id: string) => props.runtime?.providers.find((p) => p.id === id)?.configured ?? false;
	const addable = () => (props.runtime?.allProviders ?? []).filter((p) => !added().includes(p));
	const add = () => {
		const id = toAdd();
		const key = keys()[id];
		if (!id || !key) return; // adding a provider requires its api key
		setAdded([...added(), id]);
		setToAdd("");
		setKeys((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		void persist(currentSettings(), { [id]: key });
	};
	const remove = (id: string) => {
		setAdded(added().filter((p) => p !== id));
		// the backend diffs and deletes the provider's secret
		void persist(currentSettings());
	};
	const commitKey = (id: string) => {
		const key = keys()[id];
		if (!key) return;
		setKeys((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		void persist(currentSettings(), { [id]: key });
	};

	const providersConfigured = () => (props.runtime?.providers ?? []).filter((p) => p.configured).length;

	return (
		<div class="flex h-full">
			{/* Left nav: the settings catalog — a new setting is one item here + one pane */}
			<nav class="w-[168px] shrink-0 border-r border-hairline py-3">
				<button
					type="button"
					class={`flex items-center gap-2 h-[34px] px-4 w-full text-left font-serif text-[13px] font-medium border-l-2 transition-colors ${
						tab() === "general" ? "text-ink border-seal bg-paper-hover" : "text-ink-soft border-transparent hover:bg-paper-hover"
					}`}
					onClick={() => setTab("general")}
				>
					General
				</button>
				<button
					type="button"
					class={`flex items-center gap-2 h-[34px] px-4 w-full text-left font-serif text-[13px] font-medium border-l-2 transition-colors ${
						tab() === "permission" ? "text-ink border-seal bg-paper-hover" : "text-ink-soft border-transparent hover:bg-paper-hover"
					}`}
					onClick={() => setTab("permission")}
				>
					Permission
				</button>
				<button
					type="button"
					class={`flex items-center gap-2 h-[34px] px-4 w-full text-left font-serif text-[13px] font-medium border-l-2 transition-colors ${
						tab() === "providers" ? "text-ink border-seal bg-paper-hover" : "text-ink-soft border-transparent hover:bg-paper-hover"
					}`}
					onClick={() => setTab("providers")}
				>
					Providers
					<Show when={providersConfigured() > 0}>
						<span class="w-[5px] h-[5px] rounded-full bg-[#7FB069] ml-auto" />
					</Show>
				</button>
			</nav>

			{/* Content pane — fixed-height dialog: the right side scrolls, the nav stays put */}
			<div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-5">
				<Show when={tab() === "general"}>
					<div class="font-serif text-[15px] font-semibold text-ink mb-4">General</div>
					<div class="flex items-baseline gap-4 h-[38px]">
						<span class="flex-none w-[148px] font-serif text-[13px] font-medium text-ink-soft">Partner profile path</span>
						<EditableValue
							value={path}
							onCommit={async (value) => {
								setPath(value);
								await persist({ ...currentSettings(), partner_profile_path: value });
							}}
						/>
					</div>
					<div class="flex items-baseline gap-4 h-[38px]">
						<span class="flex-none w-[148px] font-serif text-[13px] font-medium text-ink-soft">Instructions file</span>
						<EditableValue
							value={instructionsFile}
							onCommit={async (value) => {
								setInstructionsFile(value);
								await persist({ ...currentSettings(), detect_instructions_file: value });
							}}
						/>
					</div>
					<div class="flex items-center gap-4 h-[38px]">
						<span class="flex-none w-[148px] font-serif text-[13px] font-medium text-ink-soft">Theme</span>
						<select
							class="flex-none w-[200px] h-[30px] px-2 bg-transparent border border-hairline rounded-[2px] font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
							value={theme()}
							onChange={(e) => {
								const t = e.currentTarget.value as ThemeMode;
								setTheme(t);
								void persist({ ...currentSettings(), theme: t });
							}}
						>
							<option value="system">system</option>
							<option value="light">light</option>
							<option value="dark">dark</option>
						</select>
					</div>
				</Show>

				<Show when={tab() === "permission"}>
					<div class="font-serif text-[15px] font-semibold text-ink mb-4">Permission</div>
					<div class="flex items-center gap-4 h-[38px]">
						<span class="flex-none w-[148px] font-serif text-[13px] font-medium text-ink-soft">Default sandbox mode</span>
						<select
							class="flex-none w-[200px] h-[30px] px-2 bg-transparent border border-hairline rounded-[2px] font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
							value={defaultSandboxMode()}
							onChange={(e) => {
								const mode = e.currentTarget.value as SandboxMode;
								setDefaultSandboxMode(mode);
								void persist({ ...currentSettings(), defaultSandboxMode: mode });
							}}
						>
							<option value="read-only">read-only</option>
							<option value="workspace-write">workspace-write</option>
							<option value="danger-full-access">danger-full-access</option>
						</select>
					</div>
				</Show>

				<Show when={tab() === "providers"}>
					<div class="font-serif text-[15px] font-semibold text-ink mb-4">Providers</div>
					<Show when={added().length} fallback={<span class="font-mono text-[12px] text-muted">no providers added — add one below</span>}>
						<For each={added()}>
							{(id) => (
								<div class="flex items-center gap-2 h-[38px] border-t border-hairline">
									<span class="flex-none w-[100px] font-mono text-[12px] text-ink">{id}</span>
									<input
										type="password"
										class="flex-1 min-w-0 h-[26px] px-2 bg-transparent border border-hairline rounded-[2px] font-mono text-[12px] text-ink-soft focus:border-seal focus:outline-none"
										placeholder={configured(id) ? "configured — 输入新值替换" : "sk-…"}
										value={keys()[id] ?? ""}
										onInput={(e) => setKeys({ ...keys(), [id]: e.currentTarget.value })}
										onBlur={() => commitKey(id)}
										spellcheck={false}
										autocomplete="off"
									/>
									<span class={`flex-none font-mono text-[11px] ${configured(id) ? "text-ink-soft" : "text-muted"}`}>{configured(id) ? "已配置" : "未配置"}</span>
									<button
										type="button"
										class="flex-none w-[24px] h-[24px] text-muted hover:text-ink hover:border hover:border-hairline rounded-[2px]"
										aria-label={`remove ${id}`}
										onClick={() => remove(id)}
									>
										×
									</button>
								</div>
							)}
						</For>
					</Show>
					<div class="flex items-center gap-2 mt-3 pt-3 border-t border-hairline">
						<select
							class="flex-none w-[128px] h-[30px] px-2 bg-transparent border border-hairline rounded-[2px] font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
							value={toAdd()}
							onChange={(e) => setToAdd(e.currentTarget.value)}
						>
							<option value="">— add provider —</option>
							{addable().map((p) => (
								<option value={p}>{p}</option>
							))}
						</select>
						<input
							type="password"
							class="flex-1 min-w-0 h-[30px] px-2 bg-transparent border border-hairline rounded-[2px] font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
							placeholder="api key（添加必填）"
							value={toAdd() ? (keys()[toAdd()] ?? "") : ""}
							onInput={(e) => toAdd() && setKeys({ ...keys(), [toAdd()]: e.currentTarget.value })}
							spellcheck={false}
							autocomplete="off"
						/>
						<button
							type="button"
							class="flex-none h-[30px] px-3 border border-ink rounded-[2px] font-sans text-[12px] font-semibold text-ink disabled:opacity-35 disabled:cursor-default"
							disabled={!toAdd() || !keys()[toAdd()]}
							onClick={add}
						>
							Add
						</button>
					</div>
				</Show>
			</div>

			{/* Failure toast — success is silent */}
			<Show when={error()}>
				<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-ink text-letter text-[12px] px-4 py-2 rounded-full">{error()}</div>
			</Show>
		</div>
	);
}
