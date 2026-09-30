import { useEffect, useRef, useState } from "react";
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
	const [configFile, setConfigFile] = useState("~/.config/letters/mcp.json");
	const [idleTimeoutSec, setIdleTimeoutSec] = useState("60");
	const [defaultLifecycle, setDefaultLifecycle] = useState("lazy");
	const [maxBufferSize, setMaxBufferSize] = useState(String(10 * 1024 * 1024));
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const stateRef = useRef({ configFile, idleTimeoutSec, defaultLifecycle, maxBufferSize });
	stateRef.current = { configFile, idleTimeoutSec, defaultLifecycle, maxBufferSize };

	async function load() {
		const res = await rpc.request.mcp_get_config({});
		setConfigFile(res.configFile);
		setIdleTimeoutSec(String(res.config.idleTimeoutSec ?? 60));
		setDefaultLifecycle(res.config.defaultLifecycle ?? "lazy");
		setMaxBufferSize(String(res.config.maxBufferSize ?? 10 * 1024 * 1024));
	}

	async function save() {
		const current = stateRef.current;
		setSaving(true);
		setMessage(null);
		try {
			const res = await rpc.request.mcp_save_options({
				options: {
					...(current.configFile.trim() ? { configFile: current.configFile.trim() } : {}),
					idleTimeoutSec: Number(current.idleTimeoutSec),
					defaultLifecycle: current.defaultLifecycle as "lazy" | "eager" | "keep-alive" | "lazy-keep-alive",
					maxBufferSize: Number(current.maxBufferSize),
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
		clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => void save(), 300);
	}

	useEffect(() => {
		void load();
		return () => clearTimeout(saveTimer.current);
	}, []);

	return (
		<div>
			<div className="mb-1 font-sans text-[10px] font-medium uppercase tracking-[0.6px] text-muted-soft">MCP</div>
			<div className="divide-y divide-line">
				<div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div className="font-serif text-[13.5px] text-ink">Config file</div>
						<div className="mt-1 font-sans text-[11.5px] text-muted">Where MCP servers and options are stored.</div>
					</div>
					<TextField className="w-full">
						<TextFieldInput
							variant="compact"
							className="w-full font-mono"
							value={configFile}
							onChange={(event) => {
								setConfigFile(event.currentTarget.value);
								queueSave();
							}}
							placeholder="~/.config/letters/mcp.json"
							aria-label="Config file path"
							spellCheck={false}
						/>
					</TextField>
				</div>
				<div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div className="font-serif text-[13.5px] text-ink">Idle timeout</div>
						<div className="mt-1 font-sans text-[11.5px] text-muted">Seconds before a lazy/eager server is disconnected after last use.</div>
					</div>
					<TextField className="w-full">
						<TextFieldInput
							variant="compact"
							className="w-full"
							type="number"
							value={idleTimeoutSec}
							onChange={(event) => {
								setIdleTimeoutSec(event.currentTarget.value);
								queueSave();
							}}
							aria-label="Idle timeout seconds"
							spellCheck={false}
						/>
					</TextField>
				</div>
				<div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div className="font-serif text-[13.5px] text-ink">Default lifecycle</div>
						<div className="mt-1 font-sans text-[11.5px] text-muted">Lifecycle used for newly added MCP servers.</div>
					</div>
					<Select
						class="w-full"
						value={defaultLifecycle}
						onChange={(value) => {
							setDefaultLifecycle(value);
							queueSave();
						}}
						options={LIFECYCLES}
						ariaLabel="Default lifecycle"
					/>
				</div>
				<div className="grid grid-cols-[minmax(0,1fr)_240px] items-center gap-6 py-3.5">
					<div>
						<div className="font-serif text-[13.5px] text-ink">Max buffer size</div>
						<div className="mt-1 font-sans text-[11.5px] text-muted">Maximum stdio message buffer size in bytes.</div>
					</div>
					<TextField className="w-full">
						<TextFieldInput
							variant="compact"
							className="w-full"
							type="number"
							value={maxBufferSize}
							onChange={(event) => {
								setMaxBufferSize(event.currentTarget.value);
								queueSave();
							}}
							aria-label="Max buffer size"
							spellCheck={false}
						/>
					</TextField>
				</div>
			</div>
			<div className="mt-3 flex h-[28px] items-center justify-end gap-3">
				{saving ? <span className="font-sans text-[11.5px] text-muted">saving…</span> : message ? <span className="font-sans text-[11.5px] text-muted">{message}</span> : null}
			</div>
		</div>
	);
}
