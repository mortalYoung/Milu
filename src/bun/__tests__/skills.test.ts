import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkillsRoot } from "../skills/filesystem";
import { parseSkillFile } from "../skills/frontmatter";
import { getSkill, listSkills } from "../skills/registry";
import { renderAvailableSkills } from "../skills/render";
import type { SkillLookup } from "../skills/types";

let dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skills-test-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs = [];
});

function skillFile(name: string, body: string): string {
	return `---\n${body}\n---\n\n# ${name}\n\nInstructions body for ${name}.`;
}

describe("parseSkillFile", () => {
	it("parses a valid bundle with defaults", () => {
		const parsed = parseSkillFile(skillFile("my-skill", "name: my-skill\ndescription: A test skill"));
		expect(parsed).not.toBeNull();
		expect(parsed!.name).toBe("my-skill");
		expect(parsed!.description).toBe("A test skill");
		expect(parsed!.invocation).toEqual({ modelInvocable: true, userInvocable: true });
		expect(parsed!.content).toContain("Instructions body");
	});

	it("drops non-kebab-case names and missing descriptions", () => {
		expect(parseSkillFile(skillFile("Bad Name", "name: Bad Name\ndescription: x"))).toBeNull();
		expect(parseSkillFile("---\nname: ok\ndescription: ''\n---\n")).toBeNull();
		expect(parseSkillFile("no frontmatter")).toBeNull();
	});

	it("normalizes invocation keys and rejects invalid booleans", () => {
		expect(parseSkillFile(skillFile("a", "name: a\ndescription: d\ndisable-model-invocation: true"))!.invocation).toEqual({ modelInvocable: false, userInvocable: true });
		expect(parseSkillFile(skillFile("b", 'name: b\ndescription: d\nuser-invocable: "no"'))!.invocation).toEqual({ modelInvocable: true, userInvocable: false });
		expect(parseSkillFile(skillFile("c", "name: c\ndescription: d\ndisable-model-invocation: maybe"))).toBeNull();
	});

	it("passes whenToUse and metadata through", () => {
		const parsed = parseSkillFile(skillFile("d", "name: d\ndescription: d\nwhenToUse: review\nmetadata:\n  foo: bar"));
		expect(parsed!.whenToUse).toBe("review");
		expect(parsed!.metadata).toEqual({ foo: "bar" });
	});
});

describe("scanSkillsRoot", () => {
	it("finds flat <name>.md and <name>/SKILL.md bundles", async () => {
		const root = await tempDir();
		await writeFile(join(root, "flat.md"), skillFile("flat", "name: flat\ndescription: flat skill"));
		await mkdir(join(root, "bundle"), { recursive: true });
		await writeFile(join(root, "bundle", "SKILL.md"), skillFile("bundle", "name: bundle\ndescription: bundle skill"));
		await writeFile(join(root, "ignored.txt"), "x");
		const found = await scanSkillsRoot(root, "project", "project-agents", 100);
		expect(found.map((s) => s.name).sort()).toEqual(["bundle", "flat"]);
	});

	it("returns [] for a missing root", async () => {
		expect(await scanSkillsRoot(join(await tempDir(), "missing"), "project", "project-agents", 100)).toEqual([]);
	});

	it("follows symlinked skill bundles and flat files", async () => {
		const root = await tempDir();
		const target = await tempDir();
		await mkdir(join(target, "bundle"), { recursive: true });
		await writeFile(join(target, "bundle", "SKILL.md"), skillFile("link-bundle", "name: link-bundle\ndescription: via link"));
		await writeFile(join(target, "flat.md"), skillFile("link-flat", "name: link-flat\ndescription: via link"));
		await symlink(join(target, "bundle"), join(root, "link-bundle"));
		await symlink(join(target, "flat.md"), join(root, "link-flat.md"));
		const found = await scanSkillsRoot(root, "project", "project-agents", 100);
		expect(found.map((s) => s.name).sort()).toEqual(["link-bundle", "link-flat"]);
	});
});

describe("registry", () => {
	it("project skills are visible automatically and win over same-name globals", async () => {
		const cwd = await tempDir();
		await mkdir(join(cwd, ".agents", "skills"), { recursive: true });
		await writeFile(join(cwd, ".agents", "skills", "shared.md"), skillFile("shared", "name: shared\ndescription: project version"));
		const home = await tempDir();
		await mkdir(join(home, ".agents", "skills"), { recursive: true });
		await writeFile(join(home, ".agents", "skills", "shared.md"), skillFile("shared", "name: shared\ndescription: global version"));
		await writeFile(join(home, ".agents", "skills", "global-only.md"), skillFile("global-only", "name: global-only\ndescription: global skill"));

		const lookup: SkillLookup = { cwd, home, skillsDirs: [".agents/skills"], granted: [] };
		const skills = await listSkills(lookup);
		expect(skills.find((s) => s.name === "shared")!.description).toBe("project version");
		expect(skills.find((s) => s.name === "global-only")).toBeUndefined();
	});

	it("global skills require the grant to appear", async () => {
		const home = await tempDir();
		await mkdir(join(home, ".agents", "skills"), { recursive: true });
		await writeFile(join(home, ".agents", "skills", "g.md"), skillFile("g", "name: g\ndescription: global skill"));
		const base: SkillLookup = { cwd: null, home, skillsDirs: [".agents/skills"], granted: [] };
		expect(await listSkills(base)).toHaveLength(0);
		expect(await listSkills({ ...base, granted: ["g"] })).toHaveLength(1);
	});

	it("sorts by name and loads definitions on demand", async () => {
		const home = await tempDir();
		await mkdir(join(home, ".agents", "skills"), { recursive: true });
		await writeFile(join(home, ".agents", "skills", "b.md"), skillFile("b", "name: b\ndescription: b skill"));
		await writeFile(join(home, ".agents", "skills", "a.md"), skillFile("a", "name: a\ndescription: a skill"));
		const lookup: SkillLookup = { cwd: null, home, skillsDirs: [".agents/skills"], granted: ["a", "b"] };
		expect((await listSkills(lookup)).map((s) => s.name)).toEqual(["a", "b"]);
		const def = await getSkill("a", lookup);
		expect(def!.content).toContain("Instructions body for a");
		expect(await getSkill("missing", lookup)).toBeUndefined();
	});
});

describe("renderAvailableSkills", () => {
	it("renders names and descriptions, empty when no skills", () => {
		const text = renderAvailableSkills([
			{ name: "a", description: "A & <B>", invocation: { modelInvocable: true, userInvocable: true }, scope: "project", source: "project-agents", path: "/x/a.md" },
		]);
		expect(text).toContain("<available_skills>");
		expect(text).toContain("- a: A &amp; &lt;B&gt;");
		expect(text).toContain("skill tool");
		expect(renderAvailableSkills([])).toBe("");
	});
});
