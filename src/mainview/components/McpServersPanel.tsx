import { useEffect, useState } from "react";
import { mcpStateColor } from "../lib/mcp";
import { rpc } from "../lib/rpc";
import { Button } from "./Button";
import type { PartnerItem } from "./ConversationList";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select } from "./ui/select";
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "./ui/text-field";

type McpServerItem = Awaited<ReturnType<typeof rpc.request.mcp_list>>["servers"][number];
type Lifecycle = "lazy" | "eager" | "keep-alive" | "lazy-keep-alive";

const LIFECYCLES = [
	{ value: "lazy", label: "lazy" },
	{ value: "eager", label: "eager" },
	{ value: "keep-alive", label: "keep-alive" },
	{ value: "lazy-keep-alive", label: "lazy-keep-alive" },
];

function envToText(env: Record<string, string> | undefined): string {
	if (!env) return "";
	return Object.entries(env)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

function parseEnvText(text: string): { ok: true; value?: Record<string, string> } | { ok: false; error: string } {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return { ok: true };
	const value: Record<string, string> = {};
	for (const line of lines) {
		const eq = line.indexOf("=");
		if (eq <= 0) return { ok: false, error: `Invalid env line: ${line}` };
		value[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return { ok: true, value };
}

export function McpServersPanel() {
	const [servers, setServers] = useState<McpServerItem[]>([]);
	const [partners, setPartners] = useState<PartnerItem[]>([]);
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [envText, setEnvText] = useState("");
	const [lifecycle, setLifecycle] = useState<Lifecycle>("lazy");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [testing, setTesting] = useState<Record<string, boolean>>({});
	const [testResult, setTestResult] = useState<Record<string, string>>({});

	async function load() {
		const [{ servers: list }, { partners: ps }] = await Promise.all([rpc.request.mcp_list({}), rpc.request.list_partners({})]);
		setServers(list);
		setPartners(ps);
	}

	useEffect(() => {
		void load();
	}, []);

	function startAdd() {
		setEditing(null);
		setName("");
		setCommand("");
		setArgs("");
		setEnvText("");
		setLifecycle("lazy");
		setError(null);
		setFormOpen(true);
	}

	function startEdit(server: McpServerItem) {
		setEditing(server.name);
		setName(server.name);
		setCommand(server.transport.command);
		setArgs(server.transport.args?.join(" ") ?? "");
		setEnvText(envToText(server.transport.env));
		setLifecycle(server.lifecycle ?? "lazy");
		setError(null);
		setFormOpen(true);
	}

	async function saveServer() {
		const trimmedName = name.trim();
		const trimmedCommand = command.trim();
		if (!trimmedName || !trimmedCommand) {
			setError("Name and command are required");
			return;
		}
		setBusy(true);
		try {
			const env = parseEnvText(envText);
			if (!env.ok) {
				setError(env.error);
				return;
			}
			const next: McpServerItem[] = editing
				? servers.map((server) =>
						server.name === editing
							? {
									...server,
									name: trimmedName,
									lifecycle: lifecycle,
									transport: {
										type: "stdio",
										command: trimmedCommand,
										...(args.trim() ? { args: args.trim().split(/\s+/) } : {}),
										...(env.value ? { env: env.value } : {}),
									},
								}
							: server,
					)
				: [
						...servers,
						{
							name: trimmedName,
							lifecycle: lifecycle,
							transport: {
								type: "stdio",
								command: trimmedCommand,
								...(args.trim() ? { args: args.trim().split(/\s+/) } : {}),
								...(env.value ? { env: env.value } : {}),
							},
							state: "stopped",
							toolCount: 0,
							grantedPartners: [],
						},
					];
			const res = await rpc.request.mcp_save_servers({ servers: next });
			if (!res.ok) {
				setError(res.error ?? "Save failed");
				return;
			}
			setFormOpen(false);
			await load();
		} finally {
			setBusy(false);
		}
	}

	async function removeServer(server: McpServerItem) {
		await rpc.request.mcp_set_partners({ name: server.name, partners: [] });
		const res = await rpc.request.mcp_save_servers({ servers: servers.filter((item) => item.name !== server.name) });
		if (res.ok) await load();
	}

	async function testServer(serverName: string) {
		setTesting((prev) => ({ ...prev, [serverName]: true }));
		setTestResult((prev) => ({ ...prev, [serverName]: "" }));
		try {
			const res = await rpc.request.mcp_test({ name: serverName });
			setTestResult((prev) => ({ ...prev, [serverName]: res.ok ? `ok · ${res.toolCount ?? 0} tools` : (res.error ?? "failed") }));
			await load();
		} finally {
			setTesting((prev) => ({ ...prev, [serverName]: false }));
		}
	}

	async function togglePartner(serverName: string, partnerName: string, on: boolean) {
		const server = servers.find((item) => item.name === serverName);
		const next = server ? (on ? [...server.grantedPartners, partnerName] : server.grantedPartners.filter((p) => p !== partnerName)) : on ? [partnerName] : [];
		await rpc.request.mcp_set_partners({ name: serverName, partners: next });
		await load();
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="font-serif text-[16px] font-semibold text-ink">MCP servers</h2>
					<p className="mt-0.5 font-sans text-[11px] text-body-muted">Configure local stdio servers and grant them to partners.</p>
				</div>
				<Button variant="outline" size="sm" onClick={startAdd}>
					+ Add server
				</Button>
			</div>

			<Dialog
				open={formOpen}
				onOpenChange={(open) => {
					if (!open) {
						setFormOpen(false);
						setError(null);
					}
				}}
			>
				<DialogContent className="w-[560px] max-w-[560px] bg-letter p-0 gap-0">
					<DialogHeader className="border-b border-hairline px-5 pb-3 pt-4">
						<DialogTitle className="font-serif text-[15px] font-semibold text-ink">{editing ? `Edit ${editing}` : "Add MCP server"}</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4 px-5 py-4">
						<div className="grid grid-cols-2 gap-3">
							<TextField className="min-w-0">
								<TextFieldLabel>Name</TextFieldLabel>
								<TextFieldInput
									value={name}
									onChange={(event) => setName(event.currentTarget.value)}
									variant="compact"
									placeholder="github"
									aria-label="Server name"
									disabled={editing != null}
									spellCheck={false}
								/>
							</TextField>
							<div>
								<span className="mb-1 block font-sans text-[11px] font-medium uppercase tracking-[0.6px] text-muted">Lifecycle</span>
								<Select class="w-full" value={lifecycle} onChange={(value) => setLifecycle(value as Lifecycle)} options={LIFECYCLES} ariaLabel="Lifecycle" />
							</div>
						</div>
						<TextField className="min-w-0">
							<TextFieldLabel>Command</TextFieldLabel>
							<TextFieldInput
								value={command}
								onChange={(event) => setCommand(event.currentTarget.value)}
								variant="compact"
								placeholder="npx"
								aria-label="Command"
								spellCheck={false}
							/>
						</TextField>
						<TextField className="min-w-0">
							<TextFieldLabel>Args</TextFieldLabel>
							<TextFieldInput
								value={args}
								onChange={(event) => setArgs(event.currentTarget.value)}
								variant="compact"
								placeholder="-y @modelcontextprotocol/server-github"
								aria-label="Args"
								spellCheck={false}
							/>
						</TextField>
						<TextField className="min-w-0">
							<TextFieldLabel>Env</TextFieldLabel>
							<TextFieldTextArea
								className="min-h-[72px] font-mono text-[12px]"
								value={envText}
								onChange={(event) => setEnvText(event.currentTarget.value)}
								placeholder={"KEY=value\nANOTHER=value"}
								aria-label="Environment variables"
								spellCheck={false}
							/>
						</TextField>
					</div>
					<DialogFooter className="border-t border-hairline px-5 py-4">
						<div className="flex w-full items-center justify-between gap-3">
							{error && <span className="font-sans text-[11px] text-seal">{error}</span>}
							<div className="ml-auto flex gap-2">
								<Button variant="ghost" size="sm" disabled={busy} onClick={() => setFormOpen(false)}>
									Cancel
								</Button>
								<Button variant="seal" size="sm" disabled={busy} onClick={() => void saveServer()}>
									{editing ? "Save" : "Add"}
								</Button>
							</div>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div className="space-y-2">
				{servers.map((server) => (
					<div className="rounded-[10px] border border-hairline bg-letter p-3" key={server.name}>
						<div className="flex items-center gap-3">
							<span className={"size-2 shrink-0 rounded-full " + mcpStateColor(server.state)} title={server.state} />
							<span className="min-w-0 flex-1">
								<span className="block truncate font-serif text-[14px] font-semibold text-ink">{server.name}</span>
								<span className="block truncate font-mono text-[10px] text-body-muted">
									{server.transport.command} {server.transport.args?.join(" ") ?? ""}
								</span>
							</span>
							<span className="shrink-0 font-mono text-[10px] text-muted">{server.lifecycle ?? "lazy"}</span>
							<span className="shrink-0 font-mono text-[10px] text-muted">{server.toolCount} tools</span>
							{testResult[server.name] && <span className="shrink-0 font-mono text-[10px] text-muted">{testResult[server.name]}</span>}
							<button
								type="button"
								className="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink disabled:opacity-50"
								disabled={testing[server.name]}
								onClick={() => void testServer(server.name)}
							>
								{testing[server.name] ? "…" : "test"}
							</button>
							<button
								type="button"
								className="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
								onClick={() => startEdit(server)}
							>
								edit
							</button>
							<button
								type="button"
								className="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-seal"
								onClick={() => void removeServer(server)}
							>
								delete
							</button>
						</div>
						{server.error && <div className="mt-2 rounded-[6px] bg-seal-soft px-2 py-1 font-mono text-[10px] text-seal">{server.error}</div>}
						<div className="mt-2 flex flex-wrap gap-1">
							{partners.map((partner) => (
								<label
									key={partner.name}
									className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-hairline px-2 py-1 font-sans text-[11px] text-ink-soft transition-colors hover:bg-paper-hover"
								>
									<input
										type="checkbox"
										className="accent-[var(--color-seal)]"
										checked={server.grantedPartners.includes(partner.name)}
										onChange={(event) => void togglePartner(server.name, partner.name, event.currentTarget.checked)}
									/>
									<span className="size-4 rounded-full bg-paper-deep text-center font-sans text-[9px] leading-4 text-ink">{partner.name.charAt(0)}</span>
									<span>{partner.name}</span>
								</label>
							))}
							{partners.length === 0 && <span className="font-sans text-[11px] text-muted">no partners</span>}
						</div>
					</div>
				))}
				{servers.length === 0 && !formOpen && (
					<div className="rounded-[10px] border border-dashed border-hairline px-4 py-8 text-center font-sans text-[12px] text-muted">
						No MCP servers configured — add one above.
					</div>
				)}
			</div>
		</div>
	);
}
