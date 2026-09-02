/**
 * set_workspace validation tests: the workspace must be absolute, outside storage, and exist.
 * (The per-turn limit is enforced by the agent, not by validateWorkspace.)
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWorkspace } from "../permission";

const NONE = { storagePath: null };

describe("validateWorkspace", () => {
	test("allows another path when a workspace is already set (limit lives at the agent per-turn guard)", () => {
		const root = mkdtempSync(join(tmpdir(), "letters-ws-"));
		expect(validateWorkspace(root, { storagePath: null })).toBeNull();
	});

	test("rejects relative paths", () => {
		expect(validateWorkspace("src", NONE)).toBe("Workspace must be an absolute path");
	});

	test("rejects a path inside the storage path", () => {
		const storage = mkdtempSync(join(tmpdir(), "letters-store-"));
		expect(validateWorkspace(join(storage, "sub"), { storagePath: storage })).toBe("Workspace cannot be inside the storage path");
	});

	test("rejects a nonexistent directory", () => {
		const root = mkdtempSync(join(tmpdir(), "letters-ws-"));
		expect(validateWorkspace(join(root, "missing"), NONE)).toBe("Workspace directory does not exist");
	});

	test("rejects a path that is not a directory", () => {
		const root = mkdtempSync(join(tmpdir(), "letters-ws-"));
		const file = join(root, "file.txt");
		writeFileSync(file, "");
		expect(validateWorkspace(file, NONE)).toBe("Workspace path is not a directory");
	});

	test("accepts an existing directory", () => {
		const root = mkdtempSync(join(tmpdir(), "letters-ws-"));
		expect(validateWorkspace(root, NONE)).toBeNull();
	});
});
