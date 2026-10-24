import { type ExecutionEnv, type Extension, ISettingsService, type ToolCall, IToolService, Type } from "@milu/core";

import { SKILL_NAME_RE, type SkillDefinition } from "./catalog.ts";
import { SkillsService, ISkillsService } from "./service/index.ts";

const schema = Type.Object({ name: Type.String({ description: "Kebab-case skill name to load, exactly as listed in <available_skills>." }) });

function content(def: SkillDefinition): string {
	const resources = def.path ? `<skill_resources>\n${def.path}\n</skill_resources>` : "<skill_resources>\n</skill_resources>";
	return `<skill_content name="${def.name}">\n${resources}\n<skill_instructions>\n${def.content}\n</skill_instructions>\n</skill_content>`;
}

const skillsExtension: Extension = {
	id: "skills",
	apiVersion: 1,

	services: [{ id: ISkillsService, create: (container) => new SkillsService(container.get(ISettingsService)) }],

	activate(context) {
		const skills = context.get(ISkillsService);

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
