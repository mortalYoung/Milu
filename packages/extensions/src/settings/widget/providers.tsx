import { ArrowLeft, Check, Copy, KeyRound, List, LogIn, LogOut, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { ProviderMark } from "../../provider-marks.tsx";
import type { AddableProvider, AuthEventText, AuthLoginState, AuthPromptText, CustomModel, CustomProvider, ProviderRow, Settings, SettingsSnapshot } from "../index.ts";
import { button, FIELD, LINK, SheetPanel, SheetRow, ValueButton } from "./ui.tsx";

const LOGIN_POLL_MS = 400;
const SIGNED_IN_DWELL_MS = 2200;

function useEdgeFade(): [RefObject<HTMLDivElement | null>, string] {
	const ref = useRef<HTMLDivElement | null>(null);
	const [edges, setEdges] = useState({ above: false, below: false });

	useEffect(() => {
		const element = ref.current;
		if (element === null) return;
		let frame = 0;
		const measure = (): void => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const above = element.scrollTop > 2;
				const below = element.scrollTop + element.clientHeight < element.scrollHeight - 2;
				setEdges((current) => (current.above === above && current.below === below ? current : { above, below }));
			});
		};
		measure();
		element.addEventListener("scroll", measure, { passive: true });
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", measure);
			resize.disconnect();
		};
	}, []);

	return [ref, `edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""}`];
}

function IconButton(props: { label: string; tone?: "ink" | "danger"; disabled?: boolean; onClick: () => void; children: ReactNode }) {
	const tone = props.tone === "danger" ? "text-signal hover:bg-signal/10" : "text-ink-soft hover:bg-hover hover:text-ink";
	return (
		<button
			type="button"
			aria-label={props.label}
			title={props.label}
			disabled={props.disabled}
			onClick={props.onClick}
			className={`inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] transition-colors duration-100 disabled:cursor-default disabled:opacity-40 ${tone}`}
		>
			{props.children}
		</button>
	);
}

function ProviderPicker(props: { options: readonly AddableProvider[]; selected: string; onPick: (entry: AddableProvider) => void }) {
	const [ref, fade] = useEdgeFade();
	return (
		<div className="rounded-[8px] border border-line bg-canvas p-1.5">
			<div ref={ref} className={`${fade} max-h-56 overflow-y-auto`}>
				{props.options.map((entry) => (
					<button
						key={entry.id}
						type="button"
						role="option"
						aria-selected={props.selected === entry.id}
						className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-left font-mono text-[12px] transition-colors duration-100 ${props.selected === entry.id ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink"}`}
						onClick={() => props.onPick(entry)}
					>
						<ProviderMark provider={entry.id} size={13} />
						<span className="truncate">{entry.id}</span>
						{entry.name === undefined ? null : <span className="shrink-0 text-[10.5px] text-muted">{entry.name}</span>}
						<span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{entry.baseUrl ?? ""}</span>
					</button>
				))}
			</div>
		</div>
	);
}

interface ModelDraft {
	id: string;
	window: string;
}

interface CustomDraft {
	id: string;
	name: string;
	baseUrl: string;
	models: ModelDraft[];
	window: string;
	maxTokens: string;
}

const BUTTON_SM = { primary: button("primary", "small"), ghost: button("ghost", "small"), danger: button("danger", "small") } as const;

const LABEL = "font-mono text-[9px] tracking-[0.14em] text-muted-soft uppercase";
const HAIRLINE = "border-line-soft";
const ROW = "grid grid-cols-[88px_minmax(0,1fr)_auto] min-h-[34px] items-center gap-3";
const TABLE = "grid grid-cols-[minmax(0,1fr)_64px_96px_76px] items-center gap-3";

const EMPTY_CUSTOM: CustomDraft = { id: "", name: "", baseUrl: "", models: [{ id: "", window: "" }], window: "", maxTokens: "" };

function optionalNumber(value: string): number | undefined {
	const parsed = Number(value);
	return value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
}

function buildModels(rows: readonly ModelDraft[]): CustomModel[] {
	return rows
		.filter((row) => row.id.trim() !== "")
		.map((row) => {
			const contextWindow = optionalNumber(row.window);
			return { id: row.id.trim(), ...(contextWindow === undefined ? {} : { contextWindow }) };
		});
}

function draftOf(def: CustomProvider): CustomDraft {
	return {
		id: def.id,
		name: def.name ?? "",
		baseUrl: def.baseUrl,
		models:
			def.models.length > 0
				? def.models.map((model) => ({ id: model.id, window: model.contextWindow === undefined ? "" : String(model.contextWindow) }))
				: [{ id: "", window: "" }],
		window: def.defaultContextWindow === undefined ? "" : String(def.defaultContextWindow),
		maxTokens: def.defaultMaxTokens === undefined ? "" : String(def.defaultMaxTokens),
	};
}

function defOf(draft: CustomDraft): CustomProvider {
	const window = optionalNumber(draft.window);
	const maxTokens = optionalNumber(draft.maxTokens);
	return {
		id: draft.id.trim(),
		...(draft.name.trim() === "" ? {} : { name: draft.name.trim() }),
		baseUrl: draft.baseUrl.trim(),
		models: buildModels(draft.models),
		...(window === undefined ? {} : { defaultContextWindow: window }),
		...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
	};
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ModelRows(props: { rows: readonly ModelDraft[]; onChange: (rows: ModelDraft[]) => void }) {
	return (
		<div className="grid gap-1">
			<div className="grid grid-cols-[minmax(0,1fr)_120px_30px] items-center gap-3">
				<span className={LABEL}>model *</span>
				<span className={LABEL}>context window</span>
				<span />
			</div>
			{props.rows.map((row, index) => (
				<div className="grid grid-cols-[minmax(0,1fr)_120px_30px] items-center gap-3" key={index}>
					<input
						className={`${FIELD} w-full font-mono text-[12px]`}
						value={row.id}
						placeholder="model id"
						aria-label="Model ID"
						spellCheck={false}
						onChange={(event) => {
							const value = event.currentTarget.value;
							props.onChange(props.rows.map((each, at) => (at === index ? { ...each, id: value } : each)));
						}}
					/>
					<input
						className={`${FIELD} w-full`}
						value={row.window}
						aria-label="Context Window"
						spellCheck={false}
						onChange={(event) => {
							const value = event.currentTarget.value;
							props.onChange(props.rows.map((each, at) => (at === index ? { ...each, window: value } : each)));
						}}
					/>
					<button type="button" className={LINK} aria-label={`remove model ${row.id || index + 1}`} onClick={() => props.onChange(props.rows.filter((_, at) => at !== index))}>
						×
					</button>
				</div>
			))}
			<button type="button" className={`${LINK} justify-self-start py-1`} onClick={() => props.onChange([...props.rows, { id: "", window: "" }])}>
				+ add model
			</button>
		</div>
	);
}

function Chip(props: { tone: "ok" | "warn" | "bad" | "dim"; children: ReactNode }) {
	const tone =
		props.tone === "ok"
			? "border-accent-teal/40 text-accent-teal"
			: props.tone === "warn"
				? "border-accent-amber/45 text-accent-amber"
				: props.tone === "bad"
					? "border-signal/45 text-signal"
					: "border-line text-muted-soft";
	return (
		<span className={`inline-flex h-[17px] shrink-0 items-center rounded-[4px] border px-[5px] font-mono text-[8.5px] tracking-[0.08em] whitespace-nowrap uppercase ${tone}`}>
			{props.children}
		</span>
	);
}

function Section(props: { title: string; first?: boolean; children: ReactNode }) {
	return (
		<div className={`${props.first === true ? "pb-1" : `mt-6 border-t ${HAIRLINE} pt-4`} pb-1`}>
			<div className={`mb-2.5 ${LABEL}`}>{props.title}</div>
			{props.children}
		</div>
	);
}

function KeyRow(props: { label: string; className?: string; children: ReactNode }) {
	return (
		<div className={props.className ?? `${ROW} -mx-2 rounded-[6px] px-2`}>
			<span className={LABEL}>{props.label}</span>
			{props.children}
		</div>
	);
}

function sizeOf(value: number | undefined): string {
	if (value === undefined) return "—";
	if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`.replace(".0M", "M");
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

function costOf(cost: { readonly input: number; readonly output: number } | undefined): string {
	return cost === undefined ? "—" : `$${cost.input}/${cost.output}`;
}

function mergeModels(base: readonly CustomModel[], added: readonly ModelDraft[]): CustomModel[] {
	const fresh = buildModels(added);
	const kept = base.filter((model) => !fresh.some((each) => each.id === model.id));
	return [...kept, ...fresh];
}

function LoginLink(props: { url: string; label: string }) {
	return (
		<a href={props.url} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-link underline decoration-line-strong underline-offset-2 hover:text-ink">
			{props.label}
		</a>
	);
}

function shortUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return url;
	}
}

function CopyCode(props: { code: string }) {
	const [copied, setCopied] = useState(false);
	const copy = (): void => {
		const clipboard = navigator.clipboard;
		if (clipboard === undefined) return;
		void clipboard.writeText(props.code).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		});
	};
	return (
		<div className="flex items-center gap-1.5">
			<span className="font-mono text-[16px] tracking-[0.14em] text-ink select-all">{props.code}</span>
			<IconButton label={copied ? "Copied" : "Copy code"} onClick={copy}>
				{copied ? <Check size={13} /> : <Copy size={13} />}
			</IconButton>
		</div>
	);
}

function LoginEventLine(props: { event: AuthEventText }) {
	const event = props.event;
	if (event.kind === "auth_url")
		return (
			<div className="grid gap-1">
				<p className="m-0 font-mono text-[11.5px] leading-relaxed text-muted">
					Sign in at <LoginLink url={event.url} label={shortUrl(event.url)} />.
				</p>
				{event.instructions === undefined ? null : <span className="font-mono text-[11px] leading-relaxed text-muted">{event.instructions}</span>}
			</div>
		);
	if (event.kind === "device_code")
		return (
			<div className="grid gap-1">
				<span className={LABEL}>device activation code</span>
				<CopyCode code={event.userCode} />
				<p className="m-0 font-mono text-[11.5px] leading-relaxed text-muted">
					Open <LoginLink url={event.verificationUri} label={shortUrl(event.verificationUri)} /> and enter the code.
				</p>
			</div>
		);
	return (
		<div className="grid gap-1">
			<span className="font-mono text-[11px] leading-relaxed text-muted">{event.message}</span>
			{event.kind === "info" ? event.links?.map((link) => <LoginLink key={link.url} url={link.url} label={link.label ?? link.url} />) : null}
		</div>
	);
}

function LoginPanel(props: { state: AuthLoginState; onAnswer: (value: string | null) => void; onDismiss: () => void }) {
	const { state, onAnswer } = props;
	const prompt: AuthPromptText | null = state.prompt;
	const [text, setText] = useState("");
	const tone = state.status === "done" ? "border-accent-teal/45" : state.status === "failed" ? "border-signal/45" : "border-line";
	const optional = prompt?.kind === "text";
	const submit = (): void => {
		if (optional || text.trim() !== "") onAnswer(text);
	};
	return (
		<div className={`mt-2.5 grid gap-2.5 rounded-[10px] border bg-surface px-4 py-3.5 ${tone}`}>
			<div className="flex items-center gap-2">
				<span className={LABEL}>{state.label}</span>
				{state.status === "running" ? <span className="ml-auto font-mono text-[11px] text-muted-soft">signing in</span> : null}
				{state.status === "done" ? (
					<span className="ml-auto flex">
						<Chip tone="ok">signed in</Chip>
					</span>
				) : null}
				{state.status === "failed" ? (
					<span className="ml-auto flex">
						<Chip tone="bad">failed</Chip>
					</span>
				) : null}
			</div>
			{state.status === "done" ? (
				<div className="flex items-center gap-1.5">
					<Check size={14} className="shrink-0 text-accent-teal" />
					<span className="font-sans text-[13px] font-medium text-ink">Signed in</span>
				</div>
			) : state.status === "failed" ? (
				<div className="flex items-center gap-1.5">
					<X size={14} className="shrink-0 text-signal" />
					<span className="font-sans text-[13px] font-medium text-signal">Sign-in failed</span>
				</div>
			) : state.status === "cancelled" ? (
				<div className="flex items-center gap-1.5">
					<X size={14} className="shrink-0 text-muted-soft" />
					<span className="font-sans text-[13px] text-muted">Sign-in cancelled</span>
				</div>
			) : null}
			{state.status === "running" ? state.events.map((event, index) => <LoginEventLine key={index} event={event} />) : null}
			{prompt === null ? null : <span className="font-mono text-[11.5px] leading-relaxed text-muted">{prompt.message}</span>}
			{prompt === null ? null : prompt.kind === "select" ? (
				<div className="grid gap-0.5">
					{prompt.options.map((option) => (
						<button
							key={option.id}
							type="button"
							className="grid cursor-pointer gap-0.5 rounded-[6px] px-2 py-1 text-left transition-colors duration-100 hover:bg-hover"
							onClick={() => onAnswer(option.id)}
						>
							<span className="font-sans text-[12px] text-ink">{option.label}</span>
							{option.description === undefined ? null : <span className="font-mono text-[10.5px] text-muted">{option.description}</span>}
						</button>
					))}
				</div>
			) : (
				<div className="flex items-center gap-2">
					<input
						className={`${FIELD} min-w-0 flex-1 font-mono text-[11px]`}
						type={prompt.kind === "secret" ? "password" : "text"}
						placeholder={prompt.placeholder ?? ""}
						aria-label={prompt.message}
						autoComplete="off"
						spellCheck={false}
						value={text}
						onChange={(event) => setText(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
						}}
					/>
					<button type="button" className={button("primary", "small")} disabled={!optional && text.trim() === ""} onClick={submit}>
						Continue
					</button>
				</div>
			)}
			{state.error === undefined ? null : <span className="font-mono text-[11px] break-words text-signal">{state.error}</span>}
			{state.status === "done" ? null : (
				<div className="flex gap-1.5">
					{state.status === "running" ? (
						<button type="button" className={button("ghost", "small")} onClick={() => onAnswer(null)}>
							Cancel
						</button>
					) : (
						<button type="button" className={button("ghost", "small")} onClick={props.onDismiss}>
							Dismiss
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export function ProvidersBand(props: {
	snapshot: SettingsSnapshot;
	save: (patch: Partial<Settings>, credentials?: Record<string, string | null>) => Promise<void>;
	refresh: () => Promise<void>;
	action: (id: string, args?: unknown) => Promise<unknown>;
	focus?: string | null;
	onDetail?: (detail: boolean) => void;
}) {
	const { snapshot, save } = props;
	const seeded = (id: string): CustomDraft => {
		const saved = (snapshot.values.customProviders ?? []).find((def) => def.id === id);
		if (saved !== undefined) return draftOf(saved);
		const row = snapshot.providers.find((entry) => entry.id === id);
		return {
			id,
			name: "",
			baseUrl: row?.baseUrl ?? "",
			models: (row?.models ?? []).map((model) => ({ id: model.id, window: model.contextWindow === undefined ? "" : String(model.contextWindow) })),
			window: "",
			maxTokens: "",
		};
	};
	const [selected, setSelected] = useState<string | null>(() => props.focus ?? null);
	const [creating, setCreating] = useState(false);
	const [draft, setDraft] = useState<CustomDraft>(() => (props.focus === null || props.focus === undefined ? { ...EMPTY_CUSTOM } : seeded(props.focus)));
	const [keyDraft, setKeyDraft] = useState("");
	const [reveal, setReveal] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [defaultOpen, setDefaultOpen] = useState(false);
	const [step, setStep] = useState(1);
	const [picked, setPicked] = useState("");
	const [newKey, setNewKey] = useState("");
	const [modelsOpen, setModelsOpen] = useState(false);
	const [pickOpen, setPickOpen] = useState(false);
	const [login, setLogin] = useState<AuthLoginState | null>(null);
	const signedIn = useRef<string | null>(null);
	const loginStatus = login?.status ?? null;
	const loginProvider = login?.provider ?? null;

	useEffect(() => {
		if (loginStatus !== "running") return;
		const timer = window.setInterval(() => {
			void props.action("settings.loginPoll").then((next) => setLogin(next as AuthLoginState | null));
		}, LOGIN_POLL_MS);
		return () => window.clearInterval(timer);
	}, [loginStatus, props]);

	useEffect(() => {
		if (loginStatus !== "done" || loginProvider === null) return;
		if (signedIn.current !== loginProvider) {
			signedIn.current = loginProvider;
			void props.refresh();
		}
		const timer = window.setTimeout(() => setLogin(null), SIGNED_IN_DWELL_MS);
		return () => window.clearTimeout(timer);
	}, [loginStatus, loginProvider, props]);

	const ids = snapshot.values.providers ?? [];
	const customDefs = snapshot.values.customProviders ?? [];
	const rows = snapshot.providers;
	const addable = snapshot.addable;
	const rowOf = (id: string): ProviderRow | undefined => rows.find((row) => row.id === id);
	const existing = selected === null ? undefined : rowOf(selected);
	const known = addable.find((entry) => entry.id === draft.id.trim());
	const formRow = "grid grid-cols-[88px_minmax(0,1fr)_30px] min-h-[34px] items-center gap-3";
	const current: ProviderRow | undefined = creating
		? (existing ?? {
				id: draft.id,
				baseUrl: draft.baseUrl,
				custom: true,
				auth: "unset",
				models: [],
			})
		: existing;

	const go = (detail: boolean): void => {
		props.onDetail?.(detail);
	};

	const resetLogin = (): void => {
		if (login !== null && login.status === "running") void props.action("settings.loginAnswer", { value: null });
		setLogin(null);
	};

	const openDetail = (id: string): void => {
		resetLogin();
		setSelected(id);
		setCreating(false);
		setKeyDraft("");
		setReveal(false);
		setConfirmRemove(false);
		setModelsOpen(false);
		setPickOpen(false);
		setError(null);
		setDraft(seeded(id));
		go(true);
	};

	const openCreate = (): void => {
		setSelected(null);
		setCreating(true);
		setKeyDraft("");
		setReveal(false);
		setConfirmRemove(false);
		setModelsOpen(false);
		setPickOpen(false);
		setError(null);
		setDraft({ ...EMPTY_CUSTOM });
		go(true);
	};

	const back = (): void => {
		resetLogin();
		setSelected(null);
		setCreating(false);
		setConfirmRemove(false);
		setPickOpen(false);
		go(false);
	};

	const run = async (action: () => Promise<void>): Promise<void> => {
		try {
			await action();
			setError(null);
		} catch (saveError) {
			setError(reason(saveError));
		}
	};

	const saveKey = (id: string): void => {
		if (keyDraft.trim() === "") return;
		void run(async () => {
			await save({}, { [id]: keyDraft.trim() });
			setKeyDraft("");
			setReveal(false);
		});
	};

	const clearKey = (id: string): void => {
		void run(async () => {
			await save({}, { [id]: null });
			setKeyDraft("");
		});
	};

	const signIn = (id: string): void => {
		setError(null);
		signedIn.current = null;
		void props.action("settings.loginStart", { provider: id }).then(
			(state) => setLogin(state as AuthLoginState),
			(signInError: unknown) => setError(reason(signInError)),
		);
	};

	const answerLogin = (value: string | null): void => {
		void props.action("settings.loginAnswer", { value });
	};

	const signOut = (id: string): void => {
		void run(async () => {
			await props.action("settings.logout", { provider: id });
			await props.refresh();
		});
	};

	const saveModels = (id: string): void => {
		const saved = customDefs.find((entry) => entry.id === id);
		const def = { ...defOf({ ...draft, id }), models: mergeModels(saved?.models ?? [], draft.models) };
		const others = customDefs.filter((entry) => entry.id !== id);
		void run(async () => {
			await save({ customProviders: [...others, def] });
			setModelsOpen(false);
		});
	};

	const openModels = (id: string): void => {
		setDraft({ ...seeded(id), models: [{ id: "", window: "" }] });
		setModelsOpen(true);
	};

	const addProvider = (id: string, key: string): void => {
		void run(async () => {
			await save({ providers: [...ids, id] }, key.trim() === "" ? undefined : { [id]: key.trim() });
			setNewKey("");
			setPicked("");
			setStep(1);
			setSelected(null);
			setCreating(false);
			go(false);
		});
	};

	const removeProvider = (id: string): void => {
		void run(async () => {
			await save({ providers: ids.filter((each) => each !== id), customProviders: customDefs.filter((def) => def.id !== id) }, { [id]: null });
			setConfirmRemove(false);
			back();
		});
	};

	const defaultModel = snapshot.values.defaultModel;
	const groups = snapshot.modelOptions;

	const nameOf = (ref: { readonly provider: string; readonly modelId?: string }): string | undefined =>
		groups.find((group) => group.provider === ref.provider)?.models.find((model) => model.id === ref.modelId)?.name;

	const setDefault = (provider?: string, modelId?: string): void => {
		void run(async () => {
			await save({ defaultModel: provider === undefined ? undefined : { provider, modelId } });
			setDefaultOpen(false);
		});
	};

	const defaultDescription =
		defaultModel === undefined
			? snapshot.effective === null
				? "Not set — a session with no model of its own cannot run until a default is chosen."
				: `A session with no model of its own runs ${snapshot.effective.name}.`
			: "New sessions start here. Picking a model in a session with no messages also sets it.";

	// ——— list ———
	if (current === undefined) {
		if (rows.length === 0) {
			return (
				<div className="max-w-[520px]">
					<div className="mb-3.5 flex items-center gap-2.5">
						{["01 pick", "02 key"].map((label, index) => (
							<span key={label} className="contents">
								<span className={`font-mono text-[9px] tracking-[0.1em] uppercase ${step === index + 1 ? "text-ink" : step > index + 1 ? "text-accent-teal" : "text-muted-soft"}`}>
									{label}
								</span>
								{index === 0 ? <span className="text-[10px] text-line-strong">→</span> : null}
							</span>
						))}
					</div>
					{step === 1 ? (
						<>
							<div className="grid gap-0.5">
								{addable.map((entry) => (
									<button
										key={entry.id}
										type="button"
										role="radio"
										aria-checked={picked === entry.id}
										className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[7px] border px-2.5 py-1 text-left font-sans text-[12.5px] transition-colors duration-100 ${picked === entry.id ? "border-line bg-selected text-ink" : "border-transparent text-ink-soft hover:bg-hover hover:text-ink"}`}
										onClick={() => setPicked(entry.id)}
									>
										<ProviderMark provider={entry.id} size={13} />
										<span>{entry.id}</span>
									</button>
								))}
							</div>
							<button type="button" className={`${BUTTON_SM.primary} mt-3.5`} disabled={picked === ""} onClick={() => setStep(2)}>
								Continue
							</button>
						</>
					) : (
						<>
							<input
								className={`${FIELD} w-full font-mono text-[12px]`}
								type="password"
								placeholder="api key"
								aria-label="API key"
								autoComplete="off"
								value={newKey}
								onChange={(event) => setNewKey(event.currentTarget.value)}
							/>
							{error === null ? null : <div className="mt-2 font-mono text-[10px] text-signal">{error}</div>}
							<div className="mt-3.5 flex gap-2">
								<button type="button" className={BUTTON_SM.ghost} onClick={() => setStep(1)}>
									Back
								</button>
								<button type="button" className={BUTTON_SM.primary} onClick={() => addProvider(picked, newKey)}>
									Add provider
								</button>
							</div>
						</>
					)}
				</div>
			);
		}

		return (
			<div>
				<SheetRow
					rowKey="defaultModel"
					title="Default model"
					description={defaultDescription}
					control={
						<ValueButton
							value={defaultModel === undefined ? "Not set" : (nameOf(defaultModel) ?? defaultModel.modelId ?? "")}
							mono
							mode="panel"
							expanded={defaultOpen}
							onClick={() => setDefaultOpen(!defaultOpen)}
						/>
					}
					panel={
						defaultOpen ? (
							<SheetPanel label="defaultModel">
								<div className="grid max-h-64 gap-0.5 overflow-y-auto">
									{groups.map((group) => (
										<div key={group.provider}>
											<div className="px-2 pt-2 pb-1 font-mono text-[9px] tracking-[0.1em] text-muted-soft uppercase">{group.provider}</div>
											{group.models.map((model) => {
												const active = defaultModel?.provider === group.provider && defaultModel?.modelId === model.id;
												return (
													<button
														key={model.id}
														type="button"
														role="radio"
														aria-checked={active}
														className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-left font-sans text-[12.5px] transition-colors duration-100 ${active ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink"}`}
														onClick={() => setDefault(group.provider, model.id)}
													>
														<span className="truncate">{model.name}</span>
													</button>
												);
											})}
										</div>
									))}
								</div>
							</SheetPanel>
						) : undefined
					}
				/>

				{rows.map((row) => (
					<div
						key={row.id}
						role="button"
						tabIndex={0}
						data-row-key={`provider:${row.id}`}
						className="-mx-2 grid cursor-pointer grid-cols-[minmax(0,1fr)_14px] items-center gap-3 rounded-[6px] px-2 py-2 transition-colors duration-100 hover:bg-hover focus-visible:bg-hover"
						onClick={() => openDetail(row.id)}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								openDetail(row.id);
							}
						}}
					>
						<div className="min-w-0">
							<div className="flex items-center gap-2 font-sans text-[13px] leading-tight font-medium text-ink">
								<ProviderMark provider={row.id} size={13} className="text-ink-soft" />
								{row.id}
								{row.name === undefined ? null : <span className="truncate text-[11.5px] font-normal text-muted">{row.name}</span>}
								{row.custom ? <Chip tone="ok">custom</Chip> : null}
							</div>
							<div className="mt-1 font-mono text-[10.5px] leading-snug text-muted-soft">
								{row.baseUrl ?? "—"} · {row.models.length} models
							</div>
						</div>
						<span className="text-[13px] text-line-strong">›</span>
					</div>
				))}

				<div className="mx-2 my-2.5 border-t border-line-soft" />
				<div
					role="button"
					tabIndex={0}
					data-row-key="addProvider"
					className="-mx-2 grid cursor-pointer grid-cols-[minmax(0,1fr)_14px] items-center gap-3 rounded-[6px] px-2 py-2 transition-colors duration-100 hover:bg-hover focus-visible:bg-hover"
					onClick={openCreate}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							openCreate();
						}
					}}
				>
					<div className="min-w-0 font-sans text-[13px] leading-tight font-medium text-ink">Add provider</div>
					<span className="text-[13px] text-line-strong">›</span>
				</div>
			</div>
		);
	}

	// ——— detail ———
	const row = current;
	const models = draft.models;

	return (
		<div className="max-w-[680px]">
			<button
				type="button"
				className="-ml-2 mt-1.5 mb-2 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 font-sans text-[12px] font-medium text-ink-soft transition-colors duration-100 hover:bg-hover hover:text-ink"
				onClick={back}
			>
				<ArrowLeft size={13} className="shrink-0" />
				Providers
			</button>
			<div className="flex items-baseline gap-2.5">
				{creating ? null : <ProviderMark provider={row.id} size={18} className="self-center text-ink" />}
				<h4 className="m-0 font-sans text-[20px] font-semibold tracking-[-0.02em] text-ink">{creating ? (draft.id.trim() === "" ? "New provider" : draft.id.trim()) : row.id}</h4>
				{creating || row.name === undefined ? null : <span className="truncate font-sans text-[13px] text-muted">{row.name}</span>}
				{creating ? null : <span className="font-mono text-[11px] text-muted-soft">{row.models.length} models</span>}
				{creating ? null : <Chip tone={row.auth === "unset" ? "warn" : "ok"}>{row.auth === "unset" ? "missing" : row.auth === "oauth" ? "oauth" : "stored"}</Chip>}
			</div>
			{creating ? null : <p className="mt-1 mb-0 font-mono text-[11px] text-muted-soft">{row.baseUrl ?? "—"}</p>}

			{error === null ? null : <div className="mt-2 font-mono text-[10px] text-signal">{error}</div>}

			<Section title={creating ? "connection" : "auth"} first>
				{creating ? (
					<div className="mb-2 grid gap-2">
						<div className={formRow}>
							<span className={LABEL}>provider id *</span>
							<input
								className={`${FIELD} min-w-0 flex-1 font-mono text-[12px]`}
								value={draft.id}
								placeholder="my-provider"
								aria-label="Provider ID"
								spellCheck={false}
								onChange={(event) => {
									const id = event.currentTarget.value;
									const match = addable.find((entry) => entry.id === id.trim());
									setDraft({ ...draft, id, ...(match === undefined ? {} : { baseUrl: match.baseUrl ?? "" }) });
								}}
							/>
							<button
								type="button"
								aria-label="Pick from list"
								aria-expanded={pickOpen}
								className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
								onClick={() => setPickOpen(!pickOpen)}
							>
								<List size={13} />
							</button>
						</div>
						{pickOpen ? (
							<ProviderPicker
								options={addable}
								selected={draft.id.trim()}
								onPick={(entry) => {
									setDraft({ ...EMPTY_CUSTOM, id: entry.id, baseUrl: entry.baseUrl ?? "" });
									setPickOpen(false);
								}}
							/>
						) : null}
						<div className={formRow}>
							<span className={LABEL}>base url{known === undefined ? " *" : ""}</span>
							<input
								className={`${FIELD} min-w-0 flex-1 font-mono text-[12px] disabled:opacity-60`}
								value={draft.baseUrl}
								placeholder="https://host/v1"
								aria-label="Base URL"
								spellCheck={false}
								disabled={known !== undefined}
								onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value })}
							/>
							<span />
						</div>
					</div>
				) : null}
				<KeyRow label={creating ? "auth" : "credential"} className={creating ? formRow : undefined}>
					{reveal || creating ? (
						<input
							className={`${FIELD} min-w-0 font-mono text-[12px]`}
							type="password"
							placeholder={row.auth === "unset" ? "sk-…" : "new key"}
							aria-label={`API key for ${row.id}`}
							autoComplete="off"
							spellCheck={false}
							value={keyDraft}
							onChange={(event) => setKeyDraft(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (!creating && event.key === "Enter") saveKey(row.id);
							}}
						/>
					) : (
						<span className="truncate font-mono text-[11.5px] text-ink-soft">
							{row.auth === "oauth" ? `oauth · ${row.signIn?.label ?? "signed in"}` : row.auth === "api_key" ? "api key · ••••••••" : "not set"}
						</span>
					)}
					<span className="flex items-center gap-0.5">
						{creating ? (
							known?.signIn === undefined ? (
								<span className="size-[30px]" />
							) : (
								<IconButton label={`Sign in with ${known.signIn.label}`} onClick={() => signIn(known.id)}>
									<LogIn size={14} />
								</IconButton>
							)
						) : reveal ? (
							<>
								<IconButton label="Cancel" onClick={() => setReveal(false)}>
									<X size={14} />
								</IconButton>
								<IconButton label="Save key" disabled={keyDraft.trim() === ""} onClick={() => saveKey(row.id)}>
									<Check size={14} />
								</IconButton>
							</>
						) : (
							<>
								{row.signIn === undefined || row.auth === "oauth" ? null : (
									<IconButton label={`Sign in with ${row.signIn.label}`} onClick={() => signIn(row.id)}>
										<LogIn size={14} />
									</IconButton>
								)}
								{row.auth === "oauth" ? (
									<IconButton label="Sign out" tone="danger" onClick={() => signOut(row.id)}>
										<LogOut size={14} />
									</IconButton>
								) : (
									<IconButton label={row.auth === "api_key" ? "Replace key" : "Add key"} tone="danger" onClick={() => setReveal(true)}>
										<KeyRound size={14} />
									</IconButton>
								)}
								{row.auth === "api_key" ? (
									<IconButton label="Clear key" tone="danger" onClick={() => clearKey(row.id)}>
										<Trash2 size={14} />
									</IconButton>
								) : null}
							</>
						)}
					</span>
				</KeyRow>
				{login === null ? null : (
					<LoginPanel
						key={`${login.provider}:${login.prompt?.message ?? login.status}`}
						state={login}
						onAnswer={(value) => {
							answerLogin(value);
							if (value === null) setLogin(null);
						}}
						onDismiss={() => setLogin(null)}
					/>
				)}
			</Section>

			{creating && (known !== undefined || draft.id.trim() === "") ? null : (
				<Section title="models">
					{creating || row.models.length > 0 ? null : <p className="m-0 font-mono text-[10.5px] text-muted">No models yet.</p>}
					{row.models.length === 0 ? null : (
						<div className={`${TABLE} -mx-2 h-[26px] px-2`}>
							<span className={LABEL}>model</span>
							<span className={`${LABEL} text-right`}>context</span>
							<span className={LABEL}>input</span>
							<span className={`${LABEL} text-right`}>cost</span>
						</div>
					)}
					{row.models.map((model) => (
						<div key={model.id} className={`${TABLE} -mx-2 h-8 rounded-[6px] px-2 transition-colors duration-100 hover:bg-hover`}>
							<span className="flex min-w-0 items-center gap-2">
								<span className="truncate font-mono text-[11.5px] text-ink">{model.id}</span>
								{model.name === undefined ? null : <span className="truncate text-[11px] text-muted">{model.name}</span>}
								{model.custom ? <Chip tone="ok">custom</Chip> : null}
							</span>
							<span className="text-right font-mono text-[10.5px] text-muted tabular-nums">{sizeOf(model.contextWindow)}</span>
							<span className="truncate font-mono text-[10.5px] text-muted">{(model.input ?? []).join(" · ")}</span>
							<span className="text-right font-mono text-[10.5px] text-muted tabular-nums" title="usd per million tokens, in/out">
								{costOf(model.cost)}
							</span>
						</div>
					))}
					{creating ? <ModelRows rows={models} onChange={(next) => setDraft({ ...draft, models: next })} /> : null}
					{!creating && !row.custom ? null : modelsOpen ? (
						<div className="mt-2 grid gap-2">
							<ModelRows rows={models} onChange={(next) => setDraft({ ...draft, models: next })} />
							<div className="flex gap-2">
								<button type="button" className={BUTTON_SM.primary} disabled={buildModels(models).length === 0} onClick={() => saveModels(row.id)}>
									Save models
								</button>
								<button type="button" className={BUTTON_SM.ghost} onClick={() => setModelsOpen(false)}>
									Cancel
								</button>
							</div>
						</div>
					) : creating ? null : (
						<button type="button" className={`${BUTTON_SM.ghost} mt-2`} onClick={() => openModels(row.id)}>
							+ Add model
						</button>
					)}
				</Section>
			)}

			{creating ? null : (
				<div className="mt-2 border-t border-line-soft pt-4 pb-1">
					{confirmRemove ? (
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-signal/40 bg-signal/5 px-3 py-2">
							<span className="text-[11.5px] text-ink">
								Remove <strong>{row.id}</strong>? Its key goes with it.
							</span>
							<span className="flex gap-1.5">
								<button type="button" className={BUTTON_SM.ghost} onClick={() => setConfirmRemove(false)}>
									Cancel
								</button>
								<button type="button" className={BUTTON_SM.danger} onClick={() => removeProvider(row.id)}>
									Remove
								</button>
							</span>
						</div>
					) : (
						<button type="button" className={BUTTON_SM.danger} onClick={() => setConfirmRemove(true)}>
							Remove provider
						</button>
					)}
				</div>
			)}

			{creating ? (
				<div className="mt-3 flex gap-2">
					<button
						type="button"
						className={BUTTON_SM.primary}
						disabled={
							draft.id.trim() === "" ||
							rows.some((entry) => entry.id === draft.id.trim()) ||
							(known === undefined && (draft.baseUrl.trim() === "" || buildModels(draft.models).length === 0))
						}
						onClick={() => {
							void run(async () => {
								const id = draft.id.trim();
								await save(
									{
										providers: ids.includes(id) ? ids : [...ids, id],
										...(known === undefined ? { customProviders: [...customDefs.filter((entry) => entry.id !== id), defOf({ ...draft, id })] } : {}),
									},
									keyDraft.trim() === "" ? undefined : { [id]: keyDraft.trim() },
								);
								setCreating(false);
								back();
							});
						}}
					>
						Submit
					</button>
				</div>
			) : null}
		</div>
	);
}
