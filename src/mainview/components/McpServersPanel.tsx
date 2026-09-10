import { createSignal, For, onMount, Show } from "solid-js";
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

function statusColor(state: McpServerItem["state"]): string {
	if (state === "connected") return "bg-[#7FB069]";
	if (state === "error") return "bg-seal";
	if (state === "connecting") return "bg-[#D9A13B]";
	return "bg-muted";
}

export function McpServersPanel() {
	const [servers, setServers] = createSignal<McpServerItem[]>([]);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [formOpen, setFormOpen] = createSignal(false);
	const [editing, setEditing] = createSignal<string | null>(null);
	const [name, setName] = createSignal("");
	const [command, setCommand] = createSignal("");
	const [args, setArgs] = createSignal("");
	const [envText, setEnvText] = createSignal("");
	const [lifecycle, setLifecycle] = createSignal<Lifecycle>("lazy");
	const [error, setError] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [testing, setTesting] = createSignal<Record<string, boolean>>({});
	const [testResult, setTestResult] = createSignal<Record<string, string>>({});

	async function load() {
		const [{ servers: list }, { partners: ps }] = await Promise.all([rpc.request.mcp_list({}), rpc.request.list_partners({})]);
		setServers(list);
		setPartners(ps);
	}

	onMount(() => void load());

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
		const trimmedName = name().trim();
		const trimmedCommand = command().trim();
		if (!trimmedName || !trimmedCommand) {
			setError("Name and command are required");
			return;
		}
		setBusy(true);
		try {
			const env = parseEnvText(envText());
			if (!env.ok) {
				setError(env.error);
				return;
			}
			const current = servers();
			const next: McpServerItem[] = editing()
				? current.map((server) =>
						server.name === editing()
							? {
									...server,
									name: trimmedName,
									lifecycle: lifecycle(),
									transport: {
										type: "stdio",
										command: trimmedCommand,
										...(args().trim() ? { args: args().trim().split(/\s+/) } : {}),
										...(env.value ? { env: env.value } : {}),
									},
								}
							: server,
					)
				: [
						...current,
						{
							name: trimmedName,
							lifecycle: lifecycle(),
							transport: {
								type: "stdio",
								command: trimmedCommand,
								...(args().trim() ? { args: args().trim().split(/\s+/) } : {}),
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
		const res = await rpc.request.mcp_save_servers({ servers: servers().filter((s) => s.name !== server.name) });
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
		const server = servers().find((s) => s.name === serverName);
		const next = server ? (on ? [...server.grantedPartners, partnerName] : server.grantedPartners.filter((p) => p !== partnerName)) : on ? [partnerName] : [];
		await rpc.request.mcp_set_partners({ name: serverName, partners: next });
		await load();
	}

	return (
		<div class="flex flex-col gap-4">
			<div class="flex items-center justify-between gap-3">
				<div>
					<h2 class="font-serif text-[16px] font-semibold text-ink">MCP servers</h2>
					<p class="mt-0.5 font-sans text-[11px] text-body-muted">Configure local stdio servers and grant them to partners.</p>
				</div>
				<Button variant="outline" size="sm" onClick={startAdd}>
					+ Add server
				</Button>
			</div>

			<Dialog
				open={formOpen()}
				onOpenChange={(open) => {
					if (!open) {
						setFormOpen(false);
						setError(null);
					}
				}}
			>
				<DialogContent class="w-[560px] max-w-[560px] bg-letter p-0 gap-0">
					<DialogHeader class="border-b border-hairline px-5 pb-3 pt-4">
						<DialogTitle class="font-serif text-[15px] font-semibold text-ink">{editing() ? `Edit ${editing()}` : "Add MCP server"}</DialogTitle>
					</DialogHeader>
					<div class="grid gap-4 px-5 py-4">
						<div class="grid grid-cols-2 gap-3">
							<TextField class="min-w-0" value={name()} onChange={setName}>
								<TextFieldLabel>Name</TextFieldLabel>
								<TextFieldInput variant="compact" placeholder="github" aria-label="Server name" disabled={editing() != null} spellcheck={false} />
							</TextField>
							<div>
								<span class="mb-1 block font-sans text-[11px] font-medium uppercase tracking-[0.6px] text-muted">Lifecycle</span>
								<Select class="w-full" value={lifecycle()} onChange={(value) => setLifecycle(value as Lifecycle)} options={LIFECYCLES} ariaLabel="Lifecycle" />
							</div>
						</div>
						<TextField class="min-w-0" value={command()} onChange={setCommand}>
							<TextFieldLabel>Command</TextFieldLabel>
							<TextFieldInput variant="compact" placeholder="npx" aria-label="Command" spellcheck={false} />
						</TextField>
						<TextField class="min-w-0" value={args()} onChange={setArgs}>
							<TextFieldLabel>Args</TextFieldLabel>
							<TextFieldInput variant="compact" placeholder="-y @modelcontextprotocol/server-github" aria-label="Args" spellcheck={false} />
						</TextField>
						<TextField class="min-w-0" value={envText()} onChange={setEnvText}>
							<TextFieldLabel>Env</TextFieldLabel>
							<TextFieldTextArea class="min-h-[72px] font-mono text-[12px]" placeholder="KEY=value&#10;ANOTHER=value" aria-label="Environment variables" spellcheck={false} />
						</TextField>
					</div>
					<DialogFooter class="border-t border-hairline px-5 py-4">
						<div class="flex w-full items-center justify-between gap-3">
							<Show when={error()}>
								<span class="font-sans text-[11px] text-seal">{error()}</span>
							</Show>
							<div class="ml-auto flex gap-2">
								<Button variant="ghost" size="sm" disabled={busy()} onClick={() => setFormOpen(false)}>
									Cancel
								</Button>
								<Button variant="seal" size="sm" disabled={busy()} onClick={() => void saveServer()}>
									{editing() ? "Save" : "Add"}
								</Button>
							</div>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div class="space-y-2">
				<For each={servers()}>
					{(server) => (
						<div class="rounded-[10px] border border-hairline bg-letter p-3">
							<div class="flex items-center gap-3">
								<span class={"size-2 shrink-0 rounded-full " + statusColor(server.state)} title={server.state} />
								<span class="min-w-0 flex-1">
									<span class="block truncate font-serif text-[14px] font-semibold text-ink">{server.name}</span>
									<span class="block truncate font-mono text-[10px] text-body-muted">
										{server.transport.command} {server.transport.args?.join(" ") ?? ""}
									</span>
								</span>
								<span class="shrink-0 font-mono text-[10px] text-muted">{server.lifecycle ?? "lazy"}</span>
								<span class="shrink-0 font-mono text-[10px] text-muted">{server.toolCount} tools</span>
								{testResult()[server.name] && <span class="shrink-0 font-mono text-[10px] text-muted">{testResult()[server.name]}</span>}
								<button
									type="button"
									class="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink disabled:opacity-50"
									disabled={testing()[server.name]}
									onClick={() => void testServer(server.name)}
								>
									{testing()[server.name] ? "…" : "test"}
								</button>
								<button
									type="button"
									class="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-ink"
									onClick={() => startEdit(server)}
								>
									edit
								</button>
								<button
									type="button"
									class="h-6 rounded-[8px] px-1.5 font-mono text-[10px] text-muted transition-colors hover:bg-paper-hover hover:text-seal"
									onClick={() => void removeServer(server)}
								>
									delete
								</button>
							</div>
							<Show when={server.error}>
								<div class="mt-2 rounded-[6px] bg-seal-soft px-2 py-1 font-mono text-[10px] text-seal">{server.error}</div>
							</Show>
							<div class="mt-2 flex flex-wrap gap-1">
								<For each={partners()}>
									{(partner) => {
										const granted = server.grantedPartners.includes(partner.name);
										return (
											<label class="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-hairline px-2 py-1 font-sans text-[11px] text-ink-soft transition-colors hover:bg-paper-hover">
												<input
													type="checkbox"
													class="accent-[var(--color-seal)]"
													checked={granted}
													onChange={(e) => void togglePartner(server.name, partner.name, e.currentTarget.checked)}
												/>
												<span class="size-4 rounded-full bg-paper-deep text-center font-sans text-[9px] leading-4 text-ink">{partner.name.charAt(0)}</span>
												<span>{partner.name}</span>
											</label>
										);
									}}
								</For>
								<Show when={partners().length === 0}>
									<span class="font-sans text-[11px] text-muted">no partners</span>
								</Show>
							</div>
						</div>
					)}
				</For>
				<Show when={servers().length === 0 && !formOpen()}>
					<div class="rounded-[10px] border border-dashed border-hairline px-4 py-8 text-center font-sans text-[12px] text-muted">No MCP servers configured — add one above.</div>
				</Show>
			</div>
		</div>
	);
}
