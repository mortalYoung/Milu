import { createSignal, For, onMount, Show } from "solid-js";
import type { GlobalSkillDescriptor } from "../../shared/rpc";
import { Button } from "../components/Button";
import type { PartnerItem } from "../components/ConversationList";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { rpc } from "../lib/rpc";

export function SkillsView() {
	const [skills, setSkills] = createSignal<GlobalSkillDescriptor[]>([]);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [name, setName] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	async function load() {
		const [{ skills: list }, { partners: ps }] = await Promise.all([rpc.request.skill_list_global({}), rpc.request.list_partners({})]);
		setSkills(list);
		setPartners(ps);
	}

	onMount(() => void load());

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
				await load();
			}
		} finally {
			setBusy(false);
		}
	}

	async function removeSkill(name: string) {
		await rpc.request.skill_delete({ name });
		await load();
	}

	async function revealSkill(name: string) {
		await rpc.request.skill_reveal({ name });
	}

	async function togglePartner(skill: string, partner: string, on: boolean) {
		const current = skills().find((s) => s.name === skill);
		const next = current ? (on ? [...current.grantedPartners, partner] : current.grantedPartners.filter((p) => p !== partner)) : on ? [partner] : [];
		await rpc.request.skill_set_partners({ name: skill, partners: next });
		await load();
	}

	return (
		<div class="flex-1 min-h-0 overflow-y-auto">
			<div class="mx-auto flex max-w-[760px] flex-col gap-5 px-6 py-6">
				<div>
					<h1 class="font-serif text-[20px] font-semibold text-ink">Skills</h1>
					<p class="mt-1 font-sans text-[12px] text-body-muted">Global skills live in your home skills directory; grant each skill to the partners that may use it.</p>
				</div>

				<section class="rounded-[8px] border border-hairline bg-letter p-4">
					<h2 class="mb-3 font-serif text-[15px] font-semibold text-ink">New global skill</h2>
					<div class="flex items-end gap-2">
						<TextField class="w-[200px]" value={name()} onChange={setName}>
							<TextFieldInput variant="compact" placeholder="kebab-name" aria-label="Skill name" spellcheck={false} />
						</TextField>
						<TextField class="min-w-0 flex-1" value={description()} onChange={setDescription}>
							<TextFieldInput variant="compact" placeholder="Short description" aria-label="Skill description" />
						</TextField>
						<Button variant="seal" size="sm" disabled={busy()} onClick={() => void createSkill()}>
							Create
						</Button>
					</div>
					<Show when={error()}>
						<p class="mt-2 font-sans text-[11px] text-seal">{error()}</p>
					</Show>
				</section>

				<section class="flex flex-col gap-3">
					<For each={skills()}>
						{(skill) => (
							<div class="rounded-[8px] border border-hairline bg-letter p-4">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<div class="flex items-baseline gap-2">
											<span class="font-mono text-[13px] font-medium text-ink">{skill.name}</span>
											<Show when={skill.path}>
												<span class="truncate font-mono text-[10px] text-muted">{skill.path}</span>
											</Show>
										</div>
										<p class="mt-1 font-sans text-[12px] leading-snug text-ink-soft">{skill.description}</p>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<Button variant="outline" size="sm" onClick={() => void revealSkill(skill.name)}>
											Reveal
										</Button>
										<Button variant="destructive" size="sm" onClick={() => void removeSkill(skill.name)}>
											Delete
										</Button>
									</div>
								</div>
								<Show when={partners().length > 0}>
									<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-hairline pt-3">
										<For each={partners()}>
											{(partner) => (
												<label class="flex cursor-pointer items-center gap-1.5 font-sans text-[11px] text-muted">
													<input
														type="checkbox"
														class="accent-[var(--color-seal)]"
														checked={skill.grantedPartners.includes(partner.name)}
														onChange={(e) => void togglePartner(skill.name, partner.name, e.currentTarget.checked)}
													/>
													{partner.name}
												</label>
											)}
										</For>
									</div>
								</Show>
							</div>
						)}
					</For>
					<Show when={skills().length === 0}>
						<div class="rounded-[8px] border border-dashed border-hairline p-6 text-center font-sans text-[12px] text-muted">no global skills yet — create one above</div>
					</Show>
				</section>
			</div>
		</div>
	);
}
