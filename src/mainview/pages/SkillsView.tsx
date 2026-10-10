import { useEffect, useRef, useState } from "react";
import type { GlobalSkillDescriptor } from "../../shared/rpc";
import { Button } from "../components/Button";
import { McpServersPanel } from "../components/McpServersPanel";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { TextField, TextFieldInput } from "../components/ui/text-field";
import { rpc } from "../lib/rpc";
import type { PartnerItem } from "../lib/session";

const skillsListener = { installed: false, reload: () => {} };

export function SkillsView() {
	const [view, setView] = useState<"skills" | "mcp">("skills");
	const [skills, setSkills] = useState<GlobalSkillDescriptor[]>([]);
	const [partners, setPartners] = useState<PartnerItem[]>([]);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [openSkill, setOpenSkill] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	async function load() {
		const [{ skills: list }, { partners: ps }] = await Promise.all([rpc.request.skill_list_global({}), rpc.request.list_partners({})]);
		setSkills(list);
		setPartners(ps);
	}

	useEffect(() => {
		void load();
		skillsListener.reload = () => void load();
		if (skillsListener.installed) return;
		skillsListener.installed = true;
		rpc.addMessageListener("skills_change", () => skillsListener.reload());
	}, []);

	async function createSkill() {
		const trimmed = name.trim().toLowerCase();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
			setError("invalid skill name (use kebab-case)");
			return;
		}
		if (!description.trim()) {
			setError("description is required");
			return;
		}
		setBusy(true);
		try {
			const res = await rpc.request.skill_create({ name: trimmed, description: description.trim() });
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

	async function removeSkill(skillName: string) {
		await rpc.request.skill_delete({ name: skillName });
		setConfirming(null);
		await load();
	}

	function armDelete(skillName: string) {
		if (confirming === skillName) {
			void removeSkill(skillName);
			return;
		}
		setConfirming(skillName);
		clearTimeout(confirmTimer.current);
		confirmTimer.current = setTimeout(() => setConfirming(null), 2600);
	}

	function toggleOpen(skillName: string) {
		setOpenSkill((value) => (value === skillName ? null : skillName));
	}

	async function togglePartner(skillName: string, partnerName: string, on: boolean) {
		const current = skills.find((skill) => skill.name === skillName);
		const next = current ? (on ? [...current.grantedPartners, partnerName] : current.grantedPartners.filter((p) => p !== partnerName)) : on ? [partnerName] : [];
		await rpc.request.skill_set_partners({ name: skillName, partners: next });
		await load();
	}

	return (
		<div className="flex-1 min-h-0 overflow-y-auto">
			<div className="flex flex-col gap-5 px-6 py-6">
				<div>
					<h1 className="font-serif text-[18px] font-semibold text-ink">Skills</h1>
					<p className="mt-1 font-sans text-[13px] text-muted">Global skills live in your home skills directory; grant each skill to the partners that may use it.</p>
				</div>

				<div className="flex items-center gap-1 border-b border-line">
					<button
						type="button"
						className={
							"rounded-t-[8px] border-b-2 px-3 py-1.5 font-serif text-[14px] transition-colors " +
							(view === "skills" ? "border-signal text-ink" : "border-transparent text-muted hover:text-ink")
						}
						onClick={() => setView("skills")}
					>
						Skills
					</button>
					<button
						type="button"
						className={
							"rounded-t-[8px] border-b-2 px-3 py-1.5 font-serif text-[14px] transition-colors " +
							(view === "mcp" ? "border-signal text-ink" : "border-transparent text-muted hover:text-ink")
						}
						onClick={() => setView("mcp")}
					>
						MCP
					</button>
				</div>

				{view === "skills" && (
					<>
						<button type="button" className="skills-create-trigger" onClick={() => setCreateOpen(true)}>
							+ write a new skill
						</button>

						<Dialog
							open={createOpen}
							onOpenChange={(open) => {
								if (!open) {
									setCreateOpen(false);
									setError(null);
								}
							}}
						>
							<DialogContent className="w-[480px] max-w-[480px] bg-canvas p-5">
								<DialogTitle className="font-serif text-[16px] font-semibold text-ink">New global skill</DialogTitle>
								<div className="mt-4 flex flex-col gap-3">
									<TextField className="w-full">
										<TextFieldInput
											variant="compact"
											value={name}
											onChange={(event) => setName(event.currentTarget.value)}
											placeholder="kebab-name"
											aria-label="Skill Name"
											spellCheck={false}
										/>
									</TextField>
									<TextField className="w-full">
										<TextFieldInput
											variant="compact"
											value={description}
											onChange={(event) => setDescription(event.currentTarget.value)}
											placeholder="Short description"
											aria-label="Skill Description"
										/>
									</TextField>
									{error && <p className="skills-error">{error}</p>}
									<div className="mt-1 flex justify-end gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											onClick={() => {
												setCreateOpen(false);
												setError(null);
											}}
										>
											Cancel
										</Button>
										<Button variant="primary" size="sm" disabled={busy} onClick={() => void createSkill()}>
											Create
										</Button>
									</div>
								</div>
							</DialogContent>
						</Dialog>

						<div className="skills-cards">
							{skills.map((skill) => (
								<article
									key={skill.name}
									className={"skill-card" + (openSkill === skill.name ? " open" : "")}
									role="button"
									tabIndex={0}
									aria-expanded={openSkill === skill.name}
									onClick={() => toggleOpen(skill.name)}
									onKeyDown={(event) => {
										if (event.target !== event.currentTarget) return;
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											toggleOpen(skill.name);
										}
									}}
								>
									<div className="skill-card-top">
										<span className="skill-tag">SKILL</span>
										<span className="skill-card-name">{skill.name}</span>
									</div>
									<p className="skill-card-desc">{skill.description}</p>
									<div className="skill-card-foot">
										<div className="skill-avatars" title={skill.grantedPartners.length > 0 ? skill.grantedPartners.join(" · ") : "no grants"}>
											{skill.grantedPartners.length > 0 ? (
												skill.grantedPartners.map((partner) => (
													<span className="skill-avatar" key={partner}>
														{partner.charAt(0)}
													</span>
												))
											) : (
												<span className="skill-avatars-empty">no grants</span>
											)}
										</div>
										<button
											type="button"
											className={"skill-delete" + (confirming === skill.name ? " armed" : "")}
											aria-label={confirming === skill.name ? `Confirm delete ${skill.name}` : `Delete ${skill.name}`}
											onClick={(event) => {
												event.stopPropagation();
												armDelete(skill.name);
											}}
										>
											{confirming === skill.name ? "confirm delete?" : "delete"}
										</button>
									</div>
									{openSkill === skill.name && (
										<div className="skill-card-more" onClick={(event) => event.stopPropagation()}>
											{skill.path && (
												<div className="skill-card-path" title={skill.path}>
													{skill.path}
												</div>
											)}
											<div className="skill-grants">
												{partners.map((partner) => (
													<label className="skill-grant" key={partner.name}>
														<input
															type="checkbox"
															className="accent-[var(--color-signal)]"
															checked={skill.grantedPartners.includes(partner.name)}
															onChange={(event) => void togglePartner(skill.name, partner.name, event.currentTarget.checked)}
														/>
														<span className="skill-grant-avatar">{partner.name.charAt(0)}</span>
														<span>{partner.name}</span>
													</label>
												))}
											</div>
											{partners.length === 0 && <div className="skill-grants-empty">no partners available to grant</div>}
										</div>
									)}
								</article>
							))}
							{skills.length === 0 && <div className="skills-empty">no global skills yet — write one above</div>}
						</div>
					</>
				)}
				{view === "mcp" && <McpServersPanel />}
			</div>
		</div>
	);
}
