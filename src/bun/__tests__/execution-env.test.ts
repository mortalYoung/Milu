/**
 * Execution-environment path guard tests: workspace ∪ storage boundary, sensitive-file blocking,
 * relative-path resolution against the workspace, and the bash command scan.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Permission } from "../permission";
import { createExecutionEnv } from "../tools/execution-env";

let root: string;
let workspace: string;
let storage: string;
let env: ReturnType<typeof createExecutionEnv>;
let plain: ReturnType<typeof createExecutionEnv>;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "env-guard-"));
	workspace = join(root, "ws");
	storage = join(root, "storage");
	await mkdir(join(workspace, "nested"), { recursive: true });
	await mkdir(storage, { recursive: true });
	await writeFile(join(workspace, "a.txt"), "hello");
	await writeFile(join(workspace, ".env"), "SECRET=1");
	await writeFile(join(storage, ".env"), "STORAGE_SECRET=1");
	await writeFile(join(root, "outside.txt"), "outside");
	env = createExecutionEnv(workspace, new Permission({ getPolicy: () => ({ workspace, storage, mode: "workspace-write" }) }));
	plain = createExecutionEnv(workspace);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("execution-env path guard", () => {
	test("read inside the workspace works, relative paths resolve against it", async () => {
		const r = await env.readTextFile("a.txt");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe("hello");
		const nested = await env.readTextFile("nested/../a.txt");
		expect(nested.ok).toBe(true);
	});

	test("sensitive file in the workspace is denied", async () => {
		const r = await env.readTextFile(".env");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("permission_denied");
	});

	test("sensitive file in the storage path is allowed", async () => {
		const r = await env.readTextFile(join(storage, ".env"));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe("STORAGE_SECRET=1");
	});

	test("reads outside workspace and storage are allowed", async () => {
		const r = await env.readTextFile(join(root, "outside.txt"));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe("outside");
	});

	test("write outside the workspace is denied", async () => {
		const r = await env.writeFile(join(root, "evil.txt"), "x");
		expect(r.ok).toBe(false);
	});

	test("bash mentioning a sensitive file is denied (best-effort scan)", async () => {
		const r = await env.exec("cat .env");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toContain("Sensitive file");
	});

	test("bash without sensitive references works", async () => {
		const r = await env.exec("echo ok");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.stdout.trim()).toBe("ok");
	});
});

describe("execution-env without a guard", () => {
	test("everything is allowed (previous behavior)", async () => {
		const r = await plain.readTextFile(".env");
		expect(r.ok).toBe(true);
		const outside = await plain.readTextFile(join(root, "a.txt"));
		expect(outside.ok).toBe(false); // file does not exist; ENOENT, not a guard denial
		if (!outside.ok) expect(outside.error.code).toBe("not_found");
	});
});
