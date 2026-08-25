/**
 * set_workspace validation tests: the workspace must be absolute, set once, outside storage, and exist.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWorkspace } from "../permission";

const NONE = { current: null, storagePath: null };

describe("validateWorkspace", () => {
	test("rejects when a workspace is already set", () => {
		expect(validateWorkspace("/tmp/ws", { current: "/tmp/ws", storagePath: null })).toBe("Workspace can only be set once per conversation");
	});

	test("rejects relative paths", () => {
		expect(validateWorkspace("src", NONE)).toBe("Workspace must be an absolute path");
	});

	test("rejects a path inside the storage path", () => {
		const storage = mkdtempSync(join(tmpdir(), "letters-store-"));
		expect(validateWorkspace(join(storage, "sub"), { current: null, storagePath: storage })).toBe("Workspace cannot be inside the storage path");
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
