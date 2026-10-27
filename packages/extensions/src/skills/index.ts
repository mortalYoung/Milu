import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type ComposerCommand, type ExecutionEnv, type Extension, ICommandsService, ISessionService, ISettingsService, type ToolCall, IToolService, Type } from "@milu/core";

import { SKILL_NAME_RE, type SkillDefinition } from "./catalog.ts";
import { grantedSkills, setGrantedSkill } from "./grants.ts";
import { SkillsService, ISkillsService } from "./service/index.ts";

const schema = Type.Object({ name: Type.String({ description: "Kebab-case skill name to load, exactly as listed in <available_skills>." }) });

function content(def: SkillDefinition): string {
	const resources = def.path ? `<skill_resources>\n${def.path}\n</skill_resources>` : "<skill_resources>\n</skill_resources>";
	return `<skill_content name="${def.name}">\n${resources}\n<skill_instructions>\n${def.content}\n</skill_instructions>\n</skill_content>`;
}

const skillsExtension: Extension = {
	id: "skills",
	apiVersion: 1,
	widgets: [{ id: "skills.view", type: "slot", entry: "./widget/view.tsx", export: "SkillsView" }],

	contributions: {
		"workspace.views": [{ id: "skills", order: 10, component: "skills.view" }],
		"welcome.items": [{ id: "skills", order: 5, title: "skills & mcp", variant: "primary", action: "skills.open" }],
	},

	services: [{ id: ISkillsService, create: (container) => new SkillsService(container.get(ISettingsService)) }],

	activate(context) {
		const skills = context.get(ISkillsService);
		const sessions = context.get(ISessionService);

		context.actions.register({ id: "skills.open", run: () => ({ kind: "view", view: "skills" }) });
		context.actions.register({ id: "workspace.close", scope: "view", hotkey: "Mod+W", run: () => ({ kind: "view", view: null }) });
		context.disposables.add(
			context.get(ICommandsService).register({
				id: "skills",
				list: async (session) => {
					if (!session) return [];
					return (await skills.list(session))
						.filter((skill) => skill.invocation.userInvocable)
						.map((skill): ComposerCommand => ({
							id: `skill:${skill.name}`,
							name: `skill:${skill.name}`,
							description: skill.description,
							kind: "leadingInput",
							hint: "[<request>]",
							action: "skills.run",
							category: "skill",
						}));
				},
			}),
		);

		context.actions.register({
			id: "skills.run",
			run: async ({ session, args }) => {
				if (!session) throw new Error("skills.run needs a session");
				const input = (args ?? {}) as { name?: unknown; args?: unknown };
				const name = String(input.name ?? "").replace(/^skill:/, "");
				if (!SKILL_NAME_RE.test(name)) throw new Error(`invalid skill name "${name}"`);
				if (session.running) throw new Error(`"${session.name}" is running — stop it before running a skill`);
				const hint = typeof input.args === "string" ? input.args.trim() : "";
				const def = await skills.get(session, name);
				if (!def) throw new Error(`skill "${name}" is unknown or not granted`);
				if (!def.invocation.userInvocable) throw new Error(`skill "${name}" is not user-invocable`);
				await session.deliver(`The user invoked skill "${name}"${hint === "" ? "" : ` with the request: ${hint}`}:\n\n${content(def)}`, { skill: name });
			},
		});

		context.actions.register({
			id: "skills.global",
			run: async () => {
				const listed = await skills.global();
				const partners = await sessions.names();
				const grants = new Map<string, readonly string[]>();
				for (const partner of partners) grants.set(partner, await grantedSkills(sessions.get(partner)));
				return {
					data: {
						partners,
						skills: listed.map((skill) => ({
							name: skill.name,
							description: skill.description,
							scope: skill.scope,
							modelInvocable: skill.invocation.modelInvocable,
							grantedPartners: partners.filter((partner) => grants.get(partner)?.includes(skill.name) === true),
						})),
					},
				};
			},
		});

		const globalFile = async (name: string): Promise<string | null> => {
			for (const dir of skills.dirs()) {
				for (const candidate of [join(homedir(), dir, name, "SKILL.md"), join(homedir(), dir, `${name}.md`)]) {
					const text = await readFile(candidate, "utf8").catch(() => null);
					if (text !== null) return candidate;
				}
			}
			return null;
		};

		context.actions.register({
			id: "skills.read",
			run: async ({ args }) => {
				const name = String((args as { name?: unknown } | undefined)?.name ?? "");
				if (!SKILL_NAME_RE.test(name)) throw new Error(`invalid skill name "${name}"`);
				const file = await globalFile(name);
				if (!file) throw new Error(`skill "${name}" is not installed globally`);
				return { data: { content: await readFile(file, "utf8") } };
			},
		});

		context.actions.register({
			id: "skills.create",
			run: async ({ args }) => {
				const { name, description } = (args ?? {}) as { name?: unknown; description?: unknown };
				const skill = String(name ?? "").trim();
				const body = String(description ?? "").trim();
				if (!SKILL_NAME_RE.test(skill)) throw new Error("invalid skill name (use kebab-case)");
				if (body === "") throw new Error("a description is required");
				const dir = join(homedir(), skills.dirs()[0]!, skill);
				await mkdir(dir, { recursive: true });
				const file = join(dir, "SKILL.md");
				await writeFile(file, `---\nname: ${skill}\ndescription: ${body.replace(/\n/g, " ")}\n---\n\n# ${skill}\n\nInstructions body for ${skill}.\n`, "utf8");
				return { data: { path: file } };
			},
		});

		context.actions.register({
			id: "skills.delete",
			run: async ({ args }) => {
				const name = String((args as { name?: unknown } | undefined)?.name ?? "");
				if (!SKILL_NAME_RE.test(name)) throw new Error(`invalid skill name "${name}"`);
				for (const dir of skills.dirs()) {
					await rm(join(homedir(), dir, name), { recursive: true, force: true });
					await rm(join(homedir(), dir, `${name}.md`), { force: true });
				}
			},
		});

		context.actions.register({
			id: "skills.access",
			run: async ({ session }) => {
				if (!session) throw new Error("skills.access needs a session");
				const listed = await skills.candidates(session);
				const granted = await grantedSkills(session);
				const rows = listed.map((skill) => ({
					group: "skills",
					name: skill.name,
					detail: skill.description,
					meta: skill.scope,
					granted: skill.scope === "project" || granted.includes(skill.name),
					alwaysOn: skill.scope === "project",
				}));
				return { data: { rows } };
			},
		});

		context.actions.register({
			id: "skills.partners",
			run: async ({ args }) => {
				const { name, partners } = (args ?? {}) as { name?: unknown; partners?: unknown };
				if (typeof name !== "string" || name === "" || !Array.isArray(partners)) throw new Error("skills.partners needs a skill name and a partner list");
				const wanted = new Set(partners.filter((partner): partner is string => typeof partner === "string"));
				for (const partner of await sessions.names()) await setGrantedSkill(sessions.get(partner), name, wanted.has(partner));
			},
		});

		context.disposables.add(
			context.get(IToolService).register({
				name: "skill",
				label: "Skill",
				description:
					"Load a skill's full instructions by its exact name from the <available_skills> catalog. Use it when a task matches one of the listed skills before or while doing the work.",
				parameters: schema,
				executionMode: "sequential",
				async run(call: ToolCall, _env: ExecutionEnv) {
					const { name } = call.params as { name: string };
					if (!SKILL_NAME_RE.test(name)) return { content: [{ type: "text", text: `Error: invalid skill name "${name}".` }], details: { ok: false, error: "invalid-name" } };

					const def = await skills.get(call.session, name);
					if (!def) return { content: [{ type: "text", text: `Skill "${name}" is unknown or no longer available.` }], details: { ok: false, error: "not-found" } };
					if (!def.invocation.modelInvocable)
						return { content: [{ type: "text", text: `Skill "${name}" is not available for model invocation.` }], details: { ok: false, error: "model-disabled" } };

					return { content: [{ type: "text", text: content(def) }], details: { ok: true } };
				},
			}),
		);
	},
};

export default skillsExtension;
