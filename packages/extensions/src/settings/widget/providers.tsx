import { useState } from "react";

import type { CustomModel, CustomProvider, ProviderRow, Settings, SettingsSnapshot } from "../index.ts";
import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD, LINK, Row, Select } from "./ui.tsx";

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

const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_56px_76px] items-center gap-2";

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

function ModelRows(props: { rows: readonly ModelDraft[]; onChange: (rows: ModelDraft[]) => void }) {
	return (
		<div className="grid gap-1">
			<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Models</span>
			<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 px-1 font-sans text-[10px] text-muted">
				<span>Model</span>
				<span>Context window</span>
				<span />
			</div>
			<div className="divide-y divide-line rounded-md border border-line px-3">
				{props.rows.map((row, index) => (
					<div className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 py-2" key={index}>
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
			</div>
			<button type="button" className={`${LINK} justify-self-start py-1`} onClick={() => props.onChange([...props.rows, { id: "", window: "" }])}>
				+ add model
			</button>
		</div>
	);
}

function CustomForm(props: { draft: CustomDraft; onChange: (next: CustomDraft) => void; onCancel: () => void; onApply: () => void; applyLabel: string }) {
	const [advanced, setAdvanced] = useState(false);
	const ready = props.draft.id.trim() !== "" && props.draft.baseUrl.trim() !== "" && props.draft.models.some((model) => model.id.trim() !== "");
	return (
		<div className="grid gap-3 pt-3">
			<div className="grid gap-1">
				<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Provider ID</span>
				<input
					className={`${FIELD} w-full font-mono text-[12px]`}
					value={props.draft.id}
					placeholder="my-gateway"
					aria-label="Provider ID"
					spellCheck={false}
					onChange={(event) => props.onChange({ ...props.draft, id: event.currentTarget.value })}
				/>
			</div>
			<div className="grid gap-1">
				<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Base URL</span>
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
				<div className="grid gap-3">
					<div className="grid gap-1">
						<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Name</span>
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
						<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Default Context Window</span>
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
						<span className="font-sans text-[10px] font-medium tracking-[0.6px] text-muted uppercase">Default Max Tokens</span>
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

export function ProvidersPanel(props: {
	snapshot: SettingsSnapshot;
	draft: Settings;
	save: (patch: Partial<Settings>, credentials?: Record<string, string | null>) => Promise<void>;
	refresh: () => Promise<void>;
}) {
	const { snapshot, draft, save, refresh } = props;
	const [adding, setAdding] = useState<"builtin" | "custom" | null>(null);
	const [picked, setPicked] = useState("");
	const [keyDraft, setKeyDraft] = useState("");
	const [keyEditId, setKeyEditId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [custom, setCustom] = useState<CustomDraft>({ ...EMPTY_CUSTOM });

	const addable = snapshot.addable;
	const target = picked !== "" ? picked : (addable[0] ?? "");

	const reset = () => {
		setAdding(null);
		setEditingId(null);
		setKeyEditId(null);
		setKeyDraft("");
		setCustom({ ...EMPTY_CUSTOM });
	};

	const added = draft.providers ?? [];
	const customDefs = draft.customProviders ?? [];
	const customDef = (id: string) => customDefs.find((def) => def.id === id);

	const addBuiltin = async () => {
		if (target === "" || keyDraft.trim() === "") return;
		await save({ providers: [...added, target] }, { [target]: keyDraft.trim() });
		await refresh();
		reset();
	};

	const remove = async (row: ProviderRow) => {
		await save({ providers: added.filter((id) => id !== row.id), customProviders: customDefs.filter((def) => def.id !== row.id) });
		await refresh();
		reset();
	};

	const saveKey = async () => {
		if (keyEditId === null) return;
		const key = keyDraft.trim();
		if (key === "") return;
		await save({}, { [keyEditId]: key });
		await refresh();
		reset();
	};

	const clearKey = async () => {
		if (keyEditId === null) return;
		await save({}, { [keyEditId]: null });
		await refresh();
		reset();
	};

	const applyCustom = async () => {
		const def = defOf(custom);
		if (def.id === "" || def.baseUrl === "" || def.models.length === 0) return;
		const next = [...customDefs.filter((each) => each.id !== def.id), def];
		await save({ customProviders: next, providers: added.includes(def.id) ? added : [...added, def.id] });
		await refresh();
		reset();
	};

	const saveCustomEdit = async () => {
		if (editingId === null) return;
		const def = defOf({ ...custom, id: editingId });
		if (def.baseUrl === "" || def.models.length === 0) return;
		await save({ customProviders: customDefs.map((each) => (each.id === editingId ? def : each)) });
		await refresh();
		reset();
	};

	const defaultKey = draft.defaultModel ? `${draft.defaultModel.provider}/${draft.defaultModel.modelId ?? ""}` : "";
	const options = [
		{ value: "", label: "Not set" },
		...snapshot.modelOptions.flatMap((group) => group.models.map((model) => ({ value: `${group.provider}/${model.id}`, label: `${group.provider} · ${model.name}` }))),
	];

	const setDefault = async (next: string): Promise<void> => {
		if (next === "") await save({ defaultModel: undefined });
		else {
			const at = next.indexOf("/");
			await save({ defaultModel: { provider: next.slice(0, at), modelId: next.slice(at + 1) } });
		}
		await refresh();
	};

	return (
		<div>
			<div className="mb-3 font-serif text-[16px] font-medium text-ink">Providers</div>
			<div className="divide-y divide-line">
				<Row
					title="Default model"
					description={
						draft.defaultModel === undefined
							? snapshot.effective
								? `A session with no model of its own runs ${snapshot.effective.provider} · ${snapshot.effective.modelId}.`
								: "Not set — a session with no model of its own cannot run until a default is chosen."
							: "New sessions start here. Picking a model in a session with no messages also sets it."
					}
				>
					<Select value={defaultKey} options={options} onChange={(next) => void setDefault(next)} ariaLabel="Default model" width="w-[260px]" />
				</Row>
			</div>
			{snapshot.providers.length > 0 ? (
				<div className="divide-y divide-line">
					<div className={`${COLS} pb-1 font-sans text-[10px] text-muted`}>
						<span>Provider</span>
						<span>Base URL</span>
						<span>Models</span>
						<span className="text-right">…</span>
					</div>
					{snapshot.providers.map((row) => (
						<div key={row.id}>
							<div className={`${COLS} py-2`}>
								<span className="flex min-w-0 items-center gap-2">
									<span className="truncate font-serif text-[13px] text-ink">{row.id}</span>
									{row.configured ? <span className="size-[5px] shrink-0 rounded-full bg-ink-soft" title="configured" /> : null}
								</span>
								<span className="truncate font-mono text-[10px] text-muted">{row.baseUrl ?? "—"}</span>
								<span className="font-mono text-[10px] text-muted">{row.modelCount}</span>
								<span className="flex items-center justify-end gap-1">
									<button
										type="button"
										className={LINK}
										onClick={() => {
											setEditingId(null);
											setAdding(null);
											setKeyDraft("");
											setKeyEditId(keyEditId === row.id ? null : row.id);
										}}
									>
										key
									</button>
									{row.custom ? (
										<button
											type="button"
											className={LINK}
											onClick={() => {
												const def = customDef(row.id);
												if (!def) return;
												setKeyEditId(null);
												setAdding(null);
												setCustom(draftOf(def));
												setEditingId(row.id);
											}}
										>
											edit
										</button>
									) : null}
									<button type="button" className={LINK} aria-label={`remove ${row.id}`} onClick={() => void remove(row)}>
										×
									</button>
								</span>
							</div>
							{keyEditId === row.id ? (
								<div className="flex items-center gap-2 py-3">
									<input
										className={`${FIELD} h-[30px] min-w-0 flex-1`}
										type="password"
										placeholder={row.configured ? "new key" : "sk-…"}
										aria-label="API Key"
										autoComplete="off"
										spellCheck={false}
										value={keyDraft}
										onChange={(event) => setKeyDraft(event.currentTarget.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") void saveKey();
											if (event.key === "Escape") setKeyEditId(null);
										}}
									/>
									<button type="button" className={BUTTON_PRIMARY} disabled={keyDraft.trim() === ""} onClick={() => void saveKey()}>
										Save
									</button>
									{row.configured ? (
										<button type="button" className={BUTTON_GHOST} onClick={() => void clearKey()}>
											Clear
										</button>
									) : null}
								</div>
							) : null}
							{editingId === row.id ? <CustomForm draft={custom} onChange={setCustom} onCancel={reset} onApply={() => void saveCustomEdit()} applyLabel="Save" /> : null}
						</div>
					))}
				</div>
			) : (
				<div className="mb-3 font-mono text-[12px] text-muted">no providers added — add one below</div>
			)}

			<div className="mt-2 border-t border-line pt-2">
				<button
					type="button"
					className={`${LINK} -mx-1 px-1 py-1`}
					onClick={() => {
						if (adding !== null) {
							reset();
							return;
						}
						setAdding("builtin");
						setEditingId(null);
						setKeyEditId(null);
					}}
				>
					{adding === null ? "+ Add Provider" : "Cancel"}
				</button>

				{adding === "builtin" ? (
					<div className="grid gap-2 pt-2">
						<div className="flex items-center gap-2">
							{addable.length > 0 ? (
								<select className={`${FIELD} h-[30px] w-40 cursor-pointer`} aria-label="Add Provider" value={target} onChange={(event) => setPicked(event.currentTarget.value)}>
									{addable.map((id) => (
										<option key={id} value={id}>
											{id}
										</option>
									))}
								</select>
							) : (
								<span className="font-mono text-[11px] text-muted">every provider is already added</span>
							)}
							<input
								className={`${FIELD} h-[30px] min-w-0 flex-1`}
								type="password"
								placeholder="api key (required to add)"
								aria-label="New Provider API Key"
								autoComplete="off"
								spellCheck={false}
								value={keyDraft}
								onChange={(event) => setKeyDraft(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void addBuiltin();
								}}
							/>
							<button type="button" className={BUTTON_PRIMARY} disabled={target === "" || keyDraft.trim() === ""} onClick={() => void addBuiltin()}>
								Add
							</button>
						</div>
						<button
							type="button"
							className={`${LINK} justify-self-start`}
							onClick={() => {
								setAdding("custom");
								setCustom({ ...EMPTY_CUSTOM });
							}}
						>
							+ custom provider
						</button>
					</div>
				) : null}

				{adding === "custom" ? (
					<div>
						<CustomForm draft={custom} onChange={setCustom} onCancel={() => setAdding("builtin")} onApply={() => void applyCustom()} applyLabel="Apply" />
					</div>
				) : null}
			</div>
		</div>
	);
}
