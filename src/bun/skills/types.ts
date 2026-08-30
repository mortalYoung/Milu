export type SkillScope = "project" | "global";

export interface SkillInvocationPolicy {
	modelInvocable: boolean;
	userInvocable: boolean;
}

export interface SkillSummary {
	name: string;
	description: string;
	whenToUse?: string;
	invocation: SkillInvocationPolicy;
	scope: SkillScope;
	source: "project-agents" | "global" | (string & {});
	path?: string;
}

export interface SkillDefinition extends SkillSummary {
	content: string;
	metadata?: Record<string, unknown>;
}

export interface SkillLookup {
	cwd: string | null;
	home: string;
	skillsDir: string;
	granted: string[];
}

export interface SkillsService {
	list(opts: { cwd: string | null; granted: string[] }): Promise<SkillSummary[]>;
	get(name: string, opts: { cwd: string | null; granted: string[] }): Promise<SkillDefinition | undefined>;
}
