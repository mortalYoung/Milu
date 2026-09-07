import { createSignal, For, onMount, Show } from "solid-js";
import type { GlobalSkillDescriptor } from "../../shared/rpc";
import { Button } from "../components/Button";
import type { PartnerItem } from "../components/ConversationList";
import { McpServersPanel } from "../components/McpServersPanel";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { rpc } from "../lib/rpc";

export function SkillsView() {
	const [view, setView] = createSignal<"skills" | "mcp">("skills");
	const [skills, setSkills] = createSignal<GlobalSkillDescriptor[]>([]);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [name, setName] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [createOpen, setCreateOpen] = createSignal(false);
	const [openSkill, setOpenSkill] = createSignal<string | null>(null);
	const [confirming, setConfirming] = createSignal<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	async function load() {
		const [{ skills: list }, { partners: ps }] = await Promise.all([rpc.request.skill_list_global({}), rpc.request.list_partners({})]);
		setSkills(list);
		setPartners(ps);
	}

	onMount(() => {
		void load();
		rpc.addMessageListener("skills_change", () => void load());
	});

	async function createSkill() {
		const n = name().trim().toLowerCase();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)) {
			setError("invalid skill name (use kebab-case)");
			return;
		}
		if (!description().trim()) {
			setError("description is required");
			return;
		}
		setBusy(true);
		try {
			const res = await rpc.request.skill_create({ name: n, description: description().trim() });
			if (!res.ok) setError(res.error ?? "create failed");
			else {
				setError(null);
				setName("");
				setDescription("");
				setCreateOpen(false);
				await load();
			}
		} finally {
			setBusy(false);
		}
	}

	async function removeSkill(name: string) {
		await rpc.request.skill_delete({ name });
		setConfirming(null);
		await load();
	}

	function armDelete(name: string) {
		if (confirming() === name) {
			void removeSkill(name);
			return;
		}
		setConfirming(name);
		clearTimeout(confirmTimer);
		confirmTimer = setTimeout(() => setConfirming(null), 2600);
	}

	function toggleOpen(name: string) {
		setOpenSkill((v) => (v === name ? null : name));
	}

	async function togglePartner(skill: string, partner: string, on: boolean) {
		const current = skills().find((s) => s.name === skill);
		const next = current ? (on ? [...current.grantedPartners, partner] : current.grantedPartners.filter((p) => p !== partner)) : on ? [partner] : [];
		await rpc.request.skill_set_partners({ name: skill, partners: next });
		await load();
	}

	return (
		<div class="flex-1 min-h-0 overflow-y-auto">
			<div class="flex flex-col gap-5 px-6 py-6">
				<div>
					<h1 class="font-serif text-[20px] font-semibold text-ink">Skills</h1>
					<p class="mt-1 font-sans text-[12px] text-body-muted">Global skills live in your home skills directory; grant each skill to the partners that may use it.</p>
				</div>

				<div class="flex items-center gap-1 border-b border-hairline">
					<button
						type="button"
						class={
							"rounded-t-[8px] border-b-2 px-3 py-1.5 font-serif text-[13px] transition-colors " +
							(view() === "skills" ? "border-seal text-ink" : "border-transparent text-muted hover:text-ink")
						}
						onClick={() => setView("skills")}
					>
						Skills
					</button>
					<button
						type="button"
						class={
							"rounded-t-[8px] border-b-2 px-3 py-1.5 font-serif text-[13px] transition-colors " +
							(view() === "mcp" ? "border-seal text-ink" : "border-transparent text-muted hover:text-ink")
						}
						onClick={() => setView("mcp")}
					>
						MCP
					</button>
				</div>

				<Show when={view() === "skills"}>
					<button type="button" class="skills-create-trigger" onClick={() => setCreateOpen(true)}>
						+ write a new skill
					</button>

					<Dialog
						open={createOpen()}
						onOpenChange={(open) => {
							if (!open) {
								setCreateOpen(false);
								setError(null);
							}
						}}
					>
						<DialogContent class="w-[480px] max-w-[480px] bg-paper p-5">
							<DialogTitle class="font-serif text-[15px] font-semibold text-ink">New global skill</DialogTitle>
							<div class="mt-4 flex flex-col gap-3">
								<TextField class="w-full" value={name()} onChange={setName}>
									<TextFieldInput variant="compact" placeholder="kebab-name" aria-label="Skill name" spellcheck={false} />
								</TextField>
								<TextField class="w-full" value={description()} onChange={setDescription}>
									<TextFieldInput variant="compact" placeholder="Short description" aria-label="Skill description" />
								</TextField>
								<Show when={error()}>
									<p class="skills-error">{error()}</p>
								</Show>
								<div class="mt-1 flex justify-end gap-2">
									<Button
										variant="ghost"
										size="sm"
										disabled={busy()}
										onClick={() => {
											setCreateOpen(false);
											setError(null);
										}}
									>
										Cancel
									</Button>
									<Button variant="seal" size="sm" disabled={busy()} onClick={() => void createSkill()}>
										Create
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>

					<div class="skills-letters">
						<For each={skills()}>
							{(skill) => (
								<article
									class={"skill-letter" + (openSkill() === skill.name ? " open" : "")}
									role="button"
									tabindex="0"
									aria-expanded={openSkill() === skill.name}
									onClick={() => toggleOpen(skill.name)}
									onKeyDown={(e) => {
										if (e.target !== e.currentTarget) return;
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											toggleOpen(skill.name);
										}
									}}
								>
									<div class="skill-letter-top">
										<span class="skill-stamp">SKILL</span>
										<span class="skill-letter-name">{skill.name}</span>
									</div>
									<p class="skill-letter-desc">{skill.description}</p>
									<div class="skill-letter-foot">
										<div class="skill-avatars" title={skill.grantedPartners.length > 0 ? skill.grantedPartners.join(" · ") : "no grants"}>
											<Show when={skill.grantedPartners.length > 0} fallback={<span class="skill-avatars-empty">no grants</span>}>
												<For each={skill.grantedPartners}>{(p) => <span class="skill-avatar">{p.charAt(0)}</span>}</For>
											</Show>
										</div>
										<button
											type="button"
											class={"skill-delete" + (confirming() === skill.name ? " armed" : "")}
											aria-label={confirming() === skill.name ? `Confirm delete ${skill.name}` : `Delete ${skill.name}`}
											onClick={(e) => {
												e.stopPropagation();
												armDelete(skill.name);
											}}
										>
											{confirming() === skill.name ? "confirm delete?" : "delete"}
										</button>
									</div>
									<Show when={openSkill() === skill.name}>
										<div class="skill-letter-more" onClick={(e) => e.stopPropagation()}>
											<Show when={skill.path}>
												<div class="skill-letter-path" title={skill.path}>
													{skill.path}
												</div>
											</Show>
											<div class="skill-grants">
												<For each={partners()}>
													{(partner) => (
														<label class="skill-grant">
															<input
																type="checkbox"
																class="accent-[var(--color-seal)]"
																checked={skill.grantedPartners.includes(partner.name)}
																onChange={(e) => void togglePartner(skill.name, partner.name, e.currentTarget.checked)}
															/>
															<span class="skill-grant-avatar">{partner.name.charAt(0)}</span>
															<span>{partner.name}</span>
														</label>
													)}
												</For>
											</div>
											<Show when={partners().length === 0}>
												<div class="skill-grants-empty">no partners available to grant</div>
											</Show>
										</div>
									</Show>
								</article>
							)}
						</For>
						<Show when={skills().length === 0}>
							<div class="skills-empty">no global skills yet — write one above</div>
						</Show>
					</div>
				</Show>
				<Show when={view() === "mcp"}>
					<McpServersPanel />
				</Show>
			</div>
		</div>
	);
}
