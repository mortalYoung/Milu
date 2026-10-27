import type { SurfaceProps } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";
import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SkillRow {
	readonly name: string;
	readonly description: string;
	readonly scope: string;
	readonly modelInvocable: boolean;
	readonly grantedPartners: readonly string[];
}

interface ServerRow {
	readonly name: string;
	readonly lifecycle: string;
	readonly state: string;
	readonly toolCount: number;
	readonly error?: string;
	readonly grantedPartners: readonly string[];
}

type Tab = "skills" | "mcp";

const TAB =
	"[-webkit-app-region:no-drag] cursor-pointer border-0 border-b-2 bg-transparent pb-2 font-sans text-[13px] font-medium uppercase tracking-[0.12em] transition-colors duration-100";
const BUTTON =
	"h-7 shrink-0 cursor-pointer rounded-md border border-line px-2.5 font-sans text-[12px] transition-colors duration-100 hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-40";
const INPUT = "h-7 min-w-0 rounded-md border border-line bg-surface px-2 font-sans text-[12px] text-ink outline-none placeholder:text-muted-soft focus-visible:border-ink";

export function SkillsView(props: SurfaceProps) {
	const { host } = props;
	const [tab, setTab] = useState<Tab>("skills");
	const [rows, setRows] = useState<readonly SkillRow[]>([]);
	const [partners, setPartners] = useState<readonly string[]>([]);
	const [servers, setServers] = useState<readonly ServerRow[]>([]);
	const [error, setError] = useState("");
	const [open, setOpen] = useState<{ readonly name: string; readonly content: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [draftDescription, setDraftDescription] = useState("");
	const [confirming, setConfirming] = useState<string | null>(null);
	const confirmTimer = useRef<number | null>(null);

	const load = useCallback(() => {
		void host.actions
			.request<{ skills: readonly SkillRow[]; partners: readonly string[] }>("skills.global")
			.then((result) => {
				if (!result) return;
				setRows(result.skills);
				setPartners(result.partners);
				setError("");
			})
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
		void host.actions
			.request<{ servers: readonly ServerRow[]; partners: readonly string[] }>("mcp.servers")
			.then((result) => result && setServers(result.servers))
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	}, [host]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(
		() => () => {
			if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
		},
		[],
	);

	const toggle = (skill: SkillRow, partner: string): void => {
		const next = skill.grantedPartners.includes(partner) ? skill.grantedPartners.filter((each) => each !== partner) : [...skill.grantedPartners, partner];
		void host.actions.invoke("skills.partners", undefined, { name: skill.name, partners: next }).then(load);
	};

	const toggleServer = (server: ServerRow, partner: string): void => {
		const next = server.grantedPartners.includes(partner) ? server.grantedPartners.filter((each) => each !== partner) : [...server.grantedPartners, partner];
		void host.actions.invoke("mcp.partners", undefined, { name: server.name, partners: next }).then(load);
	};

	const read = (skill: SkillRow): void => {
		if (open?.name === skill.name) {
			setOpen(null);
			return;
		}
		void host.actions
			.request<{ content: string }>("skills.read", undefined, { name: skill.name })
			.then((result) => result && setOpen({ name: skill.name, content: result.content }))
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	};

	const create = (): void => {
		void host.actions
			.invoke("skills.create", undefined, { name: draftName.trim(), description: draftDescription.trim() })
			.then(() => {
				setCreating(false);
				setDraftName("");
				setDraftDescription("");
				load();
			})
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	};

	const remove = (skill: SkillRow): void => {
		if (confirming !== skill.name) {
			setConfirming(skill.name);
			if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
			confirmTimer.current = window.setTimeout(() => setConfirming(null), 3000);
			return;
		}
		setConfirming(null);
		void host.actions
			.invoke("skills.delete", undefined, { name: skill.name })
			.then(load)
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-[52px] shrink-0 items-end justify-between gap-4 border-b border-line px-[var(--page-gutter)] [-webkit-app-region:drag]">
				<div className="flex items-center gap-5">
					{(["skills", "mcp"] as const).map((each) => (
						<button
							key={each}
							type="button"
							className={`${TAB} ${tab === each ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
							onClick={() => setTab(each)}
						>
							{each === "skills" ? "Skills" : "MCP"}
						</button>
					))}
				</div>
				<button
					type="button"
					className="mb-2 grid size-6 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted [-webkit-app-region:no-drag] hover:bg-hover hover:text-ink"
					aria-label="Close"
					onClick={() => void host.actions.invoke("workspace.close")}
				>
					<X size={14} />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-[var(--page-gutter)] py-5">
				<div className="mx-auto flex w-full max-w-[var(--transcript-measure)] flex-col gap-4">
					{error !== "" ? <p className="m-0 font-mono text-[11px] text-signal">{error}</p> : null}
					{tab === "skills" ? (
						<>
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<h1 className="m-0 font-serif text-[18px] font-semibold text-ink">Skills</h1>
									<p className="mt-1 mb-0 font-sans text-[13px] leading-[1.6] text-muted">
										Global skills live in your home skills directory; grant each skill to the partners that may use it.
									</p>
								</div>
								<button type="button" className={BUTTON} onClick={() => setCreating((each) => !each)}>
									new skill
								</button>
							</div>

							{creating ? (
								<div className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
									<input className={`${INPUT} w-[160px] font-mono`} value={draftName} placeholder="kebab-case-name" onChange={(event) => setDraftName(event.currentTarget.value)} />
									<input className={`${INPUT} flex-1`} value={draftDescription} placeholder="what it is for" onChange={(event) => setDraftDescription(event.currentTarget.value)} />
									<button type="button" className={BUTTON} disabled={draftName.trim() === "" || draftDescription.trim() === ""} onClick={create}>
										create
									</button>
									<button type="button" className={BUTTON} onClick={() => setCreating(false)}>
										cancel
									</button>
								</div>
							) : null}

							{rows.length === 0 ? (
								<p className="m-0 py-8 font-mono text-[10px] tracking-[0.12em] text-muted-soft uppercase">no global skills</p>
							) : (
								<div className="flex flex-col divide-y divide-line">
									{rows.map((row) => (
										<div key={row.name} className="flex flex-col gap-[3px] py-2.5">
											<div className="flex items-baseline gap-2">
												<button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[12px] text-ink hover:underline" onClick={() => read(row)}>
													{row.name}
												</button>
												<span className="shrink-0 rounded-[4px] border border-line px-1 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{row.scope}</span>
												{row.modelInvocable ? null : <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-soft">manual</span>}
												<span className="ml-auto flex shrink-0 items-center">
													<button
														type="button"
														className={`flex h-6 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 font-mono text-[9px] uppercase tracking-[0.08em] ${confirming === row.name ? "text-signal" : "text-muted-soft hover:text-ink"}`}
														onClick={() => remove(row)}
													>
														<Trash2 size={11} />
														{confirming === row.name ? "sure?" : null}
													</button>
												</span>
											</div>
											<span className="line-clamp-2 font-sans text-[12.5px] leading-[1.5] text-muted">{row.description}</span>
											<span className="mt-0.5 flex flex-wrap items-center gap-1">
												{partners.map((partner) => {
													const on = row.grantedPartners.includes(partner);
													return (
														<button
															key={partner}
															type="button"
															aria-pressed={on}
															className={`cursor-pointer rounded-[4px] border px-1.5 py-[1px] font-mono text-[9px] tracking-[0.08em] uppercase transition-colors duration-100 ${
																on ? "border-ink bg-ink text-canvas" : "border-line text-muted hover:border-line-strong hover:text-ink"
															}`}
															onClick={() => toggle(row, partner)}
														>
															{partner}
														</button>
													);
												})}
											</span>
											{open?.name === row.name ? (
												<div className="mt-2 rounded-md border border-line bg-surface px-3 py-2">
													<Markdown port={host.markdown} text={open.content} className="text-[13px]" />
												</div>
											) : null}
										</div>
									))}
								</div>
							)}
						</>
					) : (
						<>
							<div>
								<h1 className="m-0 font-serif text-[18px] font-semibold text-ink">MCP</h1>
								<p className="mt-1 mb-0 font-sans text-[13px] leading-[1.6] text-muted">Servers come from your MCP config; grant each server to the partners that may call it.</p>
							</div>
							{servers.length === 0 ? (
								<p className="m-0 py-8 font-mono text-[10px] tracking-[0.12em] text-muted-soft uppercase">no mcp servers configured</p>
							) : (
								<div className="flex flex-col divide-y divide-line">
									{servers.map((server) => (
										<div key={server.name} className="flex flex-col gap-[3px] py-2.5">
											<div className="flex items-baseline gap-2">
												<span className="font-mono text-[12px] text-ink">{server.name}</span>
												<span className="shrink-0 rounded-[4px] border border-line px-1 py-[1px] font-mono text-[9px] tracking-[0.08em] uppercase text-muted">
													{server.lifecycle}
												</span>
												<span
													className={`shrink-0 font-mono text-[9px] tracking-[0.08em] uppercase ${server.error ? "text-signal" : server.state === "running" ? "text-accent-teal" : "text-muted-soft"}`}
												>
													{server.error ? "error" : server.state}
												</span>
												<span className="ml-auto shrink-0 font-mono text-[9px] text-muted-soft">{server.toolCount} tools</span>
											</div>
											{server.error ? <span className="font-mono text-[11px] text-signal">{server.error}</span> : null}
											<span className="mt-0.5 flex flex-wrap items-center gap-1">
												{partners.map((partner) => {
													const on = server.grantedPartners.includes(partner);
													return (
														<button
															key={partner}
															type="button"
															aria-pressed={on}
															className={`cursor-pointer rounded-[4px] border px-1.5 py-[1px] font-mono text-[9px] tracking-[0.08em] uppercase transition-colors duration-100 ${
																on ? "border-ink bg-ink text-canvas" : "border-line text-muted hover:border-line-strong hover:text-ink"
															}`}
															onClick={() => toggleServer(server, partner)}
														>
															{partner}
														</button>
													);
												})}
											</span>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}

export default SkillsView;
