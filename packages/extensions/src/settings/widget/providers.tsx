import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import type { CustomModel, CustomProvider, ProviderRow, Settings, SettingsSnapshot } from "../index.ts";
import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD, LINK, SheetPanel, SheetRow, ValueButton } from "./ui.tsx";

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
			<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 font-mono text-[9px] tracking-[0.1em] text-muted-soft uppercase">
				<span>Model</span>
				<span>Context window</span>
				<span />
			</div>
			{props.rows.map((row, index) => (
				<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2" key={index}>
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
						placeholder="optional"
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

function CustomForm(props: { draft: CustomDraft; onChange: (next: CustomDraft) => void; onCancel: () => void; onApply: () => void; applyLabel: string; lockId?: boolean }) {
	const [advanced, setAdvanced] = useState(false);
	const ready = props.draft.id.trim() !== "" && props.draft.baseUrl.trim() !== "" && props.draft.models.some((model) => model.id.trim() !== "");
	return (
		<div className="grid gap-3">
			<div className="grid gap-1">
				<span className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Provider ID</span>
				<input
					className={`${FIELD} w-full font-mono text-[12px]`}
					value={props.draft.id}
					placeholder="my-gateway"
					aria-label="Provider ID"
					spellCheck={false}
					disabled={props.lockId === true}
					onChange={(event) => props.onChange({ ...props.draft, id: event.currentTarget.value })}
				/>
			</div>
			<div className="grid gap-1">
				<span className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Base URL</span>
				<input
					className={`${FIELD} w-full`}
					value={props.draft.baseUrl}
					placeholder="https://gateway.example.com/v1"
					aria-label="Base URL"
					spellCheck={false}
					onChange={(event) => props.onChange({ ...props.draft, baseUrl: event.currentTarget.value })}
				/>
			</div>
			<ModelRows rows={props.draft.models} onChange={(models) => props.onChange({ ...props.draft, models })} />
			<button type="button" className={`${LINK} justify-self-start`} onClick={() => setAdvanced(!advanced)}>
				{advanced ? "− Advanced" : "+ Advanced"}
			</button>
			{advanced ? (
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<div className="grid gap-1">
						<span className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Name</span>
						<input
							className={`${FIELD} w-full`}
							value={props.draft.name}
							placeholder="My Gateway"
							aria-label="Display Name"
							spellCheck={false}
							onChange={(event) => props.onChange({ ...props.draft, name: event.currentTarget.value })}
						/>
					</div>
					<div className="grid gap-1">
						<span className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Default Context</span>
						<input
							className={`${FIELD} w-full`}
							value={props.draft.window}
							placeholder="128000"
							aria-label="Default Context Window"
							spellCheck={false}
							onChange={(event) => props.onChange({ ...props.draft, window: event.currentTarget.value })}
						/>
					</div>
					<div className="grid gap-1">
						<span className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Default Max Tokens</span>
						<input
							className={`${FIELD} w-full`}
							value={props.draft.maxTokens}
							placeholder="8192"
							aria-label="Default Max Tokens"
							spellCheck={false}
							onChange={(event) => props.onChange({ ...props.draft, maxTokens: event.currentTarget.value })}
						/>
					</div>
				</div>
			) : null}
			<div className="flex justify-end gap-2">
				<button type="button" className={BUTTON_GHOST} onClick={props.onCancel}>
					Cancel
				</button>
				<button type="button" className={BUTTON_PRIMARY} disabled={!ready} onClick={props.onApply}>
					{props.applyLabel}
				</button>
			</div>
		</div>
	);
}

function optionClass(active: boolean): string {
	return `flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-left font-sans text-[12.5px] transition-colors duration-100 ${active ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink"}`;
}

export function ProvidersBand(props: {
	snapshot: SettingsSnapshot;
	save: (patch: Partial<Settings>, credentials?: Record<string, string | null>) => Promise<void>;
	open: string | null;
	onOpen: (key: string | null) => void;
}) {
	const { snapshot, save, open, onOpen } = props;
	const [picked, setPicked] = useState("");
	const [addKey, setAddKey] = useState("");
	const [addMode, setAddMode] = useState<"builtin" | "custom">("builtin");
	const [custom, setCustom] = useState<CustomDraft>({ ...EMPTY_CUSTOM });
	const [keyDraft, setKeyDraft] = useState("");
	const [reveal, setReveal] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const ids = snapshot.values.providers ?? [];
	const customDefs = snapshot.values.customProviders ?? [];
	const customDef = (id: string): CustomProvider | undefined => customDefs.find((def) => def.id === id);
	const known = (id: string): ProviderRow | undefined => snapshot.providers.find((row) => row.id === id);
	const addable = snapshot.addable;
	const target = picked !== "" ? picked : (addable[0] ?? "");

	const resetAdd = (): void => {
		setPicked("");
		setAddKey("");
		setAddMode("builtin");
		setCustom({ ...EMPTY_CUSTOM });
	};

	const openProvider = (id: string): void => {
		setKeyDraft("");
		setReveal(false);
		setConfirmRemove(null);
		setError(null);
		const def = customDef(id);
		setCustom(def === undefined ? { ...EMPTY_CUSTOM } : draftOf(def));
		onOpen(`provider:${id}`);
	};

	const openAdd = (): void => {
		resetAdd();
		setError(null);
		onOpen("addProvider");
	};

	const run = async (action: () => Promise<void>): Promise<void> => {
		try {
			await action();
			setError(null);
		} catch (saveError) {
			setError(reason(saveError));
		}
	};

	const currentDefault = snapshot.values.defaultModel;
	const defaultKey = currentDefault === undefined ? "" : `${currentDefault.provider}/${currentDefault.modelId ?? ""}`;
	const defaultValue = currentDefault === undefined ? "Not set" : `${currentDefault.provider} · ${currentDefault.modelId ?? ""}`;
	const groups = snapshot.modelOptions;
	const orphan = currentDefault !== undefined && !groups.some((group) => group.provider === currentDefault.provider);
	const defaultDescription =
		currentDefault === undefined
			? snapshot.effective === null
				? "Not set — a session with no model of its own cannot run until a default is chosen."
				: `A session with no model of its own runs ${snapshot.effective.provider} · ${snapshot.effective.modelId}.`
			: "New sessions start here. Picking a model in a session with no messages also sets it.";

	const setDefault = (provider?: string, modelId?: string): void => {
		void run(async () => {
			await save({ defaultModel: provider === undefined ? undefined : { provider, modelId } });
			onOpen(null);
		});
	};

	const saveKey = (id: string): void => {
		const key = keyDraft.trim();
		if (key === "") return;
		void run(async () => {
			await save({}, { [id]: key });
			setKeyDraft("");
			onOpen(null);
		});
	};

	const clearKey = (id: string): void => {
		void run(async () => {
			await save({}, { [id]: null });
			setKeyDraft("");
			onOpen(null);
		});
	};

	const remove = (id: string): void => {
		void run(async () => {
			await save({ providers: ids.filter((each) => each !== id), customProviders: customDefs.filter((def) => def.id !== id) }, { [id]: null });
			setConfirmRemove(null);
			onOpen(null);
		});
	};

	const addBuiltin = (): void => {
		if (target === "" || addKey.trim() === "") return;
		void run(async () => {
			await save({ providers: [...ids, target] }, { [target]: addKey.trim() });
			resetAdd();
			onOpen(null);
		});
	};

	const addCustom = (): void => {
		const def = defOf(custom);
		if (def.id === "" || def.baseUrl === "" || def.models.length === 0) return;
		if (ids.includes(def.id)) return;
		void run(async () => {
			await save({ providers: [...ids, def.id], customProviders: [...customDefs.filter((each) => each.id !== def.id), def] });
			resetAdd();
			onOpen(null);
		});
	};

	const saveCustom = (id: string): void => {
		const def = defOf({ ...custom, id });
		if (def.baseUrl === "" || def.models.length === 0) return;
		void run(async () => {
			await save({ customProviders: customDefs.map((each) => (each.id === id ? def : each)) });
			onOpen(null);
		});
	};

	const defaultPanel =
		open === "model" ? (
			<SheetPanel label="defaultModel">
				{error === null ? null : <div className="mb-2 font-mono text-[10px] text-signal">{error}</div>}
				<div className="grid gap-0.5">
					<button type="button" role="radio" aria-checked={currentDefault === undefined} className={optionClass(currentDefault === undefined)} onClick={() => setDefault()}>
						<span>Not set</span>
						<span className="ml-auto font-mono text-[9px] text-muted-soft">none</span>
					</button>
					{groups.map((group) => (
						<div key={group.provider}>
							<div className="px-2 pt-2 pb-1 font-mono text-[9px] tracking-[0.1em] text-muted-soft uppercase">{group.provider}</div>
							{group.models.map((model) => {
								const value = `${group.provider}/${model.id}`;
								const active = defaultKey === value;
								return (
									<button key={value} type="button" role="radio" aria-checked={active} className={optionClass(active)} onClick={() => setDefault(group.provider, model.id)}>
										<span className="truncate font-mono text-[11px]">{model.id}</span>
										<span className="ml-auto truncate text-[11px] text-muted">{model.name}</span>
									</button>
								);
							})}
						</div>
					))}
				</div>
				{orphan ? <div className="mt-2 font-mono text-[10px] text-signal">The current model's provider is not in settings. Pick another.</div> : null}
			</SheetPanel>
		) : undefined;

	const addPanel =
		open === "addProvider" ? (
			<SheetPanel label="new provider">
				{error === null ? null : <div className="mb-2 font-mono text-[10px] text-signal">{error}</div>}
				{addMode === "custom" ? (
					<div className="grid gap-2">
						<CustomForm draft={custom} onChange={setCustom} onCancel={() => setAddMode("builtin")} onApply={addCustom} applyLabel="Add provider" />
						{custom.id.trim() !== "" && ids.includes(custom.id.trim()) ? <div className="font-mono text-[10px] text-signal">That id is already in use.</div> : null}
					</div>
				) : (
					<div className="grid gap-2">
						{addable.length === 0 ? (
							<div className="font-mono text-[10.5px] text-muted">Every built-in provider is already added.</div>
						) : (
							<>
								<div className="grid gap-0.5">
									{addable.map((id) => (
										<button key={id} type="button" role="radio" aria-checked={target === id} className={optionClass(target === id)} onClick={() => setPicked(id)}>
											<span>{id}</span>
											<span className="ml-auto truncate font-mono text-[9.5px] text-muted">{known(id)?.baseUrl ?? ""}</span>
										</button>
									))}
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<input
										className={`${FIELD} h-[30px] min-w-[180px] flex-1 font-mono text-[12px]`}
										type="password"
										placeholder="api key"
										aria-label="New Provider API Key"
										autoComplete="off"
										spellCheck={false}
										value={addKey}
										onChange={(event) => setAddKey(event.currentTarget.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") addBuiltin();
										}}
									/>
									<button type="button" className={BUTTON_PRIMARY} disabled={target === "" || addKey.trim() === ""} onClick={addBuiltin}>
										Add provider
									</button>
								</div>
								<div className="font-mono text-[9.5px] text-muted">A key is required.</div>
							</>
						)}
						<button type="button" className={LINK} onClick={() => setAddMode("custom")}>
							+ custom provider
						</button>
					</div>
				)}
			</SheetPanel>
		) : undefined;

	return (
		<div>
			<SheetRow
				rowKey="model"
				title="Default model"
				description={defaultDescription}
				control={<ValueButton value={defaultValue} mono mode="panel" expanded={open === "model"} onClick={() => onOpen(open === "model" ? null : "model")} />}
				panel={defaultPanel}
			/>

			{snapshot.providers.map((row) => {
				const expanded = open === `provider:${row.id}`;
				const label = `provider · ${row.id}`;
				return (
					<SheetRow
						key={row.id}
						rowKey={`provider:${row.id}`}
						title={
							<span className="flex items-center gap-2">
								{row.id}
								{row.custom ? <span className="rounded border border-line px-1 py-px font-mono text-[8px] tracking-[0.07em] text-muted-soft uppercase">custom</span> : null}
							</span>
						}
						description={
							<span>
								<span className="font-mono text-[10.5px] tracking-[-0.01em]">{row.baseUrl ?? "—"}</span>
								<span> · {row.modelCount} models</span>
							</span>
						}
						control={
							<ValueButton value={row.configured ? "Key set" : "Add key"} mode="panel" expanded={expanded} onClick={() => (expanded ? onOpen(null) : openProvider(row.id))} />
						}
						panel={
							expanded ? (
								<SheetPanel label={label}>
									{error === null ? null : <div className="mb-2 font-mono text-[10px] text-signal">{error}</div>}
									<div className="grid gap-2.5">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={`inline-flex h-[18px] items-center rounded border px-1.5 font-mono text-[9px] tracking-[0.06em] uppercase ${
													row.configured ? "border-accent-teal/35 text-accent-teal" : "border-accent-amber/40 text-accent-amber"
												}`}
											>
												{row.configured ? "Key set" : "No key"}
											</span>
											<span className="font-mono text-[9.5px] text-muted">
												{row.configured ? "A new key replaces the stored one." : "A key is written once and never echoed back."}
											</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<input
												className={`${FIELD} h-[30px] min-w-[180px] flex-1 font-mono text-[12px]`}
												type={reveal ? "text" : "password"}
												placeholder={row.configured ? "new key" : "sk-…"}
												aria-label={`API key for ${row.id}`}
												autoComplete="off"
												spellCheck={false}
												value={keyDraft}
												onChange={(event) => setKeyDraft(event.currentTarget.value)}
												onKeyDown={(event) => {
													if (event.key === "Enter") saveKey(row.id);
													if (event.key === "Escape") onOpen(null);
												}}
											/>
											<button
												type="button"
												className="grid size-[30px] cursor-pointer place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
												aria-label={reveal ? "Hide key" : "Show key"}
												onClick={() => setReveal(!reveal)}
											>
												{reveal ? <EyeOff size={13} /> : <Eye size={13} />}
											</button>
											<button type="button" className={BUTTON_PRIMARY} disabled={keyDraft.trim() === ""} onClick={() => saveKey(row.id)}>
												Save key
											</button>
											{row.configured ? (
												<button type="button" className={BUTTON_GHOST} onClick={() => clearKey(row.id)}>
													Clear
												</button>
											) : null}
										</div>

										{row.custom ? (
											<div className="border-t border-line pt-3">
												<CustomForm draft={custom} onChange={setCustom} onCancel={() => onOpen(null)} onApply={() => saveCustom(row.id)} applyLabel="Save provider" lockId />
											</div>
										) : (
											<div className="flex items-baseline gap-2 border-t border-line pt-3">
												<span className="w-[62px] shrink-0 font-mono text-[9px] tracking-[0.1em] text-muted uppercase">Base URL</span>
												<span className="truncate font-mono text-[11px] text-muted">{row.baseUrl ?? "—"}</span>
											</div>
										)}

										<div className="flex justify-end border-t border-line pt-3">
											{confirmRemove === row.id ? (
												<div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-[8px] border border-signal/40 bg-signal/5 px-3 py-2">
													<span className="text-[11.5px] text-ink">
														Remove <strong>{row.id}</strong>? Its key goes with it.
													</span>
													<span className="flex gap-1.5">
														<button type="button" className={BUTTON_GHOST} onClick={() => setConfirmRemove(null)}>
															Cancel
														</button>
														<button type="button" className={BUTTON_PRIMARY} onClick={() => remove(row.id)}>
															Remove
														</button>
													</span>
												</div>
											) : (
												<button type="button" className={LINK} onClick={() => setConfirmRemove(row.id)}>
													Remove provider
												</button>
											)}
										</div>
									</div>
								</SheetPanel>
							) : undefined
						}
					/>
				);
			})}

			<SheetRow
				rowKey="addProvider"
				title="Add provider"
				description="A built-in needs a key; a custom provider needs an endpoint and at least one model."
				control={<ValueButton value="Set up" mode="panel" expanded={open === "addProvider"} onClick={() => (open === "addProvider" ? onOpen(null) : openAdd())} />}
				panel={addPanel}
			/>
		</div>
	);
}
