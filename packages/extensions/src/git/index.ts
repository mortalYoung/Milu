import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { type Extension, expandHome, IToolService, type Session, type ToolCall, type ToolResult, Type } from "@milu/core";

import { IPermissionService } from "../permission/index.ts";
import { gitChanges, gitFileSides, gitPatch, gitWorktreeAdd, gitWorktreeRemove, gitWorktrees, gitWorkspaceFacts } from "./lib/git.ts";
import type { GitChanges } from "./types.ts";

const workspaceOnly = async (session: Session): Promise<true | null> => ((await session.workspace()) === null ? null : true);

const rootOf = async (session: Session): Promise<string> => {
	const workspace = await session.workspace();
	if (workspace === null) throw new Error("git needs a workspace");
	return workspace.path;
};

const changeOf = (args: unknown): { path: string; staged: boolean; from?: string } => {
	const value = (args ?? {}) as { path?: unknown; staged?: unknown; from?: unknown };
	if (typeof value.path !== "string" || value.path === "") throw new Error("git needs a file path");
	return { path: value.path, staged: value.staged === true, ...(typeof value.from === "string" && value.from !== "" ? { from: value.from } : {}) };
};

const worktreeSchema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("create"), Type.Literal("switch"), Type.Literal("delete")], {
		description: "What to do: list this repository's worktrees, create one, switch this chat to one, or delete one.",
	}),
	path: Type.Optional(Type.String({ description: "create: the new worktree path; switch/delete: an existing worktree path." })),
	branch: Type.Optional(Type.String({ description: "create: the branch to check out; required." })),
	base: Type.Optional(Type.String({ description: "create: the commit or branch a new branch starts from; defaults to HEAD." })),
});

interface WorktreeParams {
	op: "list" | "create" | "switch" | "delete";
	path?: string;
	branch?: string;
	base?: string;
}

const resultText = (value: string): ToolResult => ({ content: [{ type: "text", text: value }], details: {} });

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function workspaceOf(session: Session): Promise<string> {
	const workspace = await session.workspace();
	if (workspace === null) throw new Error("this chat has no workspace");
	return workspace.path;
}

function absolutePath(workspace: string, value: string): string {
	const path = value.trim();
	if (path === "") throw new Error("path is required");
	return resolve(workspace, expandHome(path));
}

async function canonicalPath(path: string): Promise<string> {
	return realpath(path).catch(() => resolve(path));
}

async function worktreeList(workspace: string): Promise<string> {
	const found = await gitWorktrees(workspace);
	const lines = [`Repository: ${found.repoRoot}`, `Current: ${found.current ?? "none"}`];
	for (const tree of found.worktrees) {
		lines.push(`${tree.path === found.current ? "*" : " "} ${tree.branch ?? "detached"}  ${tree.path}`);
	}
	return lines.join("\n");
}

async function worktreeCreate(workspace: string, params: WorktreeParams): Promise<string> {
	if (params.path === undefined) throw new Error("create needs a path");
	if (params.branch === undefined || params.branch.trim() === "") throw new Error("create needs a branch");
	const path = await canonicalPath(absolutePath(workspace, params.path));
	const branch = params.branch.trim();
	const base = params.base?.trim() || "HEAD";
	await gitWorktreeAdd(workspace, path, branch, base);
	return [`Created worktree ${path} on ${branch}.`, `Attach it with worktrees { op: "switch", path: "${path}" }.`].join("\n");
}

async function worktreeSwitch(session: Session, workspace: string, params: WorktreeParams): Promise<string> {
	if (params.path === undefined) throw new Error("switch needs a path");
	const target = await canonicalPath(absolutePath(workspace, params.path));
	const found = await gitWorktrees(workspace);
	const tree = found.worktrees.find((entry) => resolve(entry.path) === target);
	if (tree === undefined) throw new Error(`${target} is not a worktree of ${found.repoRoot}`);
	await session.setWorkspace(target);
	return `Workspace attached to ${target}${tree.branch === null ? "" : ` (${tree.branch})`}.`;
}

async function worktreeDelete(workspace: string, params: WorktreeParams): Promise<string> {
	if (params.path === undefined) throw new Error("delete needs a path");
	const target = await canonicalPath(absolutePath(workspace, params.path));
	const found = await gitWorktrees(workspace);
	if (!found.worktrees.some((entry) => resolve(entry.path) === target)) throw new Error(`${target} is not a worktree of ${found.repoRoot}`);
	if (found.current !== null && resolve(found.current) === target) throw new Error("cannot delete the worktree this chat is using");
	await gitWorktreeRemove(workspace, target);
	return `Removed worktree ${target}. The branch was left in place.`;
}

const gitExtension: Extension = {
	id: "git",
	apiVersion: 1,

	widgets: [
		{ id: "git.bar", type: "slot", entry: "./widget/git.tsx", export: "GitButton" },
		{ id: "git.head", type: "slot", entry: "./widget/git.tsx", export: "GitHead" },
		{ id: "git.pane", type: "slot", entry: "./widget/git.tsx", export: "GitPane" },
		{ id: "git.changes", type: "service", entry: "./widget/service.ts" },
	],

	contributions: {
		"chat.bar": [{ id: "git", order: 41, component: "git.bar", data: workspaceOnly }],
		"dock.bar": [{ id: "git", order: 20, component: "git.head", data: workspaceOnly }],
		"dock.views": [{ id: "git", order: 30, component: "git.pane", title: "Changes", icon: "git-branch", data: workspaceOnly }],
	},

	activate(context) {
		const permission = context.get(IPermissionService);

		context.actions.register({
			id: "git.changes",
			run: async ({ session }) => {
				if (!session) throw new Error("git.changes needs a session");
				const workspace = await session.workspace();
				if (workspace === null) return { data: { repoRoot: null, changes: [] } satisfies GitChanges };
				return { data: (await gitChanges(workspace.path)) satisfies GitChanges };
			},
		});

		context.actions.register({
			id: "git.workspace",
			run: async ({ session }) => {
				if (!session) throw new Error("git.workspace needs a session");
				const workspace = await session.workspace();
				if (workspace === null) return { data: null };
				return { data: { path: workspace.path, ...(await gitWorkspaceFacts(workspace.path)) } };
			},
		});

		context.actions.register({
			id: "git.sides",
			run: async ({ session, args }) => {
				if (!session) throw new Error("git.sides needs a session");
				const change = changeOf(args);
				const root = await rootOf(session);
				return { data: await gitFileSides(root, change.path, { staged: change.staged, ...(change.from === undefined ? {} : { from: change.from }) }) };
			},
		});

		context.actions.register({
			id: "git.patch",
			run: async ({ session, args }) => {
				if (!session) throw new Error("git.patch needs a session");
				const change = changeOf(args);
				return { data: await gitPatch(await rootOf(session), change.path, { staged: change.staged }) };
			},
		});

		context.disposables.add(
			context.get(IToolService).register({
				name: "worktrees",
				label: "Worktrees",
				description:
					"Work with git worktrees of this chat's repository.\n" +
					"- list: every worktree, with its branch and path, marking the one containing the current workspace.\n" +
					"- create: add a worktree at path on branch, from base (default HEAD); path and branch are required. It does not attach the new worktree to this chat.\n" +
					"- switch: attach this chat's workspace to an existing worktree path.\n" +
					"- delete: remove the worktree at path; dirty worktrees are refused, the branch is left in place, and the current worktree cannot be deleted.",
				parameters: worktreeSchema,
				async run(call: ToolCall) {
					const params = call.params as WorktreeParams;
					try {
						const workspace = await workspaceOf(call.session);
						if ((params.op === "create" || params.op === "delete") && (await permission.mode(call.session)) === "read-only") {
							throw new Error("a read-only chat cannot change worktrees");
						}
						if (params.op === "list") return resultText(await worktreeList(workspace));
						if (params.op === "create") return resultText(await worktreeCreate(workspace, params));
						if (params.op === "switch") return resultText(await worktreeSwitch(call.session, workspace, params));
						if (params.op === "delete") return resultText(await worktreeDelete(workspace, params));
						throw new Error(`unknown worktrees op: ${String(params.op)}`);
					} catch (error) {
						return resultText(reason(error));
					}
				},
			}),
		);
	},
};

export default gitExtension;
