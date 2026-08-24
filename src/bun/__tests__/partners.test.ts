/**
 * Partner name validation: folder-safety (the name becomes a folder path),
 * reserved OS names, and duplicate rejection — including case-insensitive
 * collisions, matching macOS/Windows filesystems.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPartner, PartnerError } from "../partners";

let root: string;
const settings = { partner_profile_path: "", detect_instructions_file: "AGENTS.md" };

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "partner-test-"));
	settings.partner_profile_path = root;
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

const input = { name: "bob" };

describe("createPartner name validation", () => {
	test("creates a partner with a valid name", async () => {
		const profile = await createPartner(settings, input);
		expect(profile.name).toBe("bob");
	});

	test("rejects an exact duplicate name", async () => {
		expect(createPartner(settings, input)).rejects.toThrow(PartnerError);
		await expect(createPartner(settings, input)).rejects.toThrow("already exists");
	});

	test("rejects a case-insensitive duplicate (folder collision on macOS/Windows)", async () => {
		await expect(createPartner(settings, { ...input, name: "BOB" })).rejects.toThrow("already exists");
	});

	test("rejects names that cannot become folders", async () => {
		for (const bad of ["a/b", "a\\b", "a.b", "a b", "a:b", "", "..", "a".repeat(65)]) {
			await expect(createPartner(settings, { ...input, name: bad })).rejects.toThrow(PartnerError);
		}
	});

	test("rejects OS-reserved names", async () => {
		await expect(createPartner(settings, { ...input, name: "CON" })).rejects.toThrow("cannot be used as a folder");
		await expect(createPartner(settings, { ...input, name: "nul" })).rejects.toThrow("cannot be used as a folder");
	});
});
