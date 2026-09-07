import { createSignal, onMount } from "solid-js";
import { rpc } from "../lib/rpc";
import { Select } from "./ui/select";
import { TextField, TextFieldInput } from "./ui/text-field";

const LIFECYCLES = [
	{ value: "lazy", label: "lazy" },
	{ value: "eager", label: "eager" },
	{ value: "keep-alive", label: "keep-alive" },
	{ value: "lazy-keep-alive", label: "lazy-keep-alive" },
];

export function McpSettingsPanel() {
	const [configFile, setConfigFile] = createSignal("~/.config/letters/mcp.json");
	const [idleTimeoutSec, setIdleTimeoutSec] = createSignal("60");
	const [defaultLifecycle, setDefaultLifecycle] = createSignal("lazy");
	const [maxBufferSize, setMaxBufferSize] = createSignal(String(10 * 1024 * 1024));
	const [saving, setSaving] = createSignal(false);
	const [message, setMessage] = createSignal<string | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	async function load() {
		const res = await rpc.request.mcp_get_config({});
		setConfigFile(res.configFile);
		setIdleTimeoutSec(String(res.config.idleTimeoutSec ?? 60));
		setDefaultLifecycle(res.config.defaultLifecycle ?? "lazy");
		setMaxBufferSize(String(res.config.maxBufferSize ?? 10 * 1024 * 1024));
	}

	async function save() {
		setSaving(true);
		setMessage(null);
		try {
			const res = await rpc.request.mcp_save_options({
				options: {
					...(configFile().trim() ? { configFile: configFile().trim() } : {}),
					idleTimeoutSec: Number(idleTimeoutSec()),
					defaultLifecycle: defaultLifecycle() as "lazy" | "eager" | "keep-alive" | "lazy-keep-alive",
					maxBufferSize: Number(maxBufferSize()),
				},
			});
			setMessage(res.ok ? "Saved" : (res.error ?? "Save failed"));
		} finally {
			setSaving(false);
		}
	}

	function queueSave() {
		setSaving(true);
		setMessage(null);
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 300);
	}

	onMount(() => void load());

	return (
		<div>
			<div class="mb-3 font-serif text-[16px] font-medium text-ink">MCP</div>
			<div class="divide-y divide-hairline">
				<div class="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div class="font-serif text-[13px] text-ink">Config file</div>
						<div class="mt-1 font-sans text-[11px] text-body-muted">Where MCP servers and options are stored.</div>
					</div>
					<TextField
						class="w-full"
						value={configFile()}
						onChange={(v) => {
							setConfigFile(v);
							queueSave();
						}}
					>
						<TextFieldInput variant="compact" class="w-full font-mono" placeholder="~/.config/letters/mcp.json" aria-label="Config file path" spellcheck={false} />
					</TextField>
				</div>
				<div class="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div class="font-serif text-[13px] text-ink">Idle timeout</div>
						<div class="mt-1 font-sans text-[11px] text-body-muted">Seconds before a lazy/eager server is disconnected after last use.</div>
					</div>
					<TextField
						class="w-full"
						value={idleTimeoutSec()}
						onChange={(v) => {
							setIdleTimeoutSec(v);
							queueSave();
						}}
					>
						<TextFieldInput variant="compact" class="w-full" type="number" aria-label="Idle timeout seconds" spellcheck={false} />
					</TextField>
				</div>
				<div class="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div class="font-serif text-[13px] text-ink">Default lifecycle</div>
						<div class="mt-1 font-sans text-[11px] text-body-muted">Lifecycle used for newly added MCP servers.</div>
					</div>
					<Select
						class="w-full"
						value={defaultLifecycle()}
						onChange={(v) => {
							setDefaultLifecycle(v);
							queueSave();
						}}
						options={LIFECYCLES}
						ariaLabel="Default lifecycle"
					/>
				</div>
				<div class="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div class="font-serif text-[13px] text-ink">Max buffer size</div>
						<div class="mt-1 font-sans text-[11px] text-body-muted">Maximum stdio message buffer size in bytes.</div>
					</div>
					<TextField
						class="w-full"
						value={maxBufferSize()}
						onChange={(v) => {
							setMaxBufferSize(v);
							queueSave();
						}}
					>
						<TextFieldInput variant="compact" class="w-full" type="number" aria-label="Max buffer size" spellcheck={false} />
					</TextField>
				</div>
			</div>
			<div class="mt-3 flex h-[28px] items-center justify-end gap-3">
				{saving() ? <span class="font-sans text-[11px] text-body-muted">saving…</span> : message() ? <span class="font-sans text-[11px] text-body-muted">{message()}</span> : null}
			</div>
		</div>
	);
}
