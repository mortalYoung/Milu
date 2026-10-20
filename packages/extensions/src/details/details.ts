import type { Extension, Session } from "@milu/core";

export interface SessionDetails {
	readonly name: string;
	readonly path: string;
	readonly storage: string;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly persona?: string;
	readonly forkedFrom?: string;
	readonly pinned?: boolean;
	readonly running: boolean;
	readonly workspace?: { readonly path: string; readonly kind?: string | null; readonly repo?: string | null };
	readonly lastMessageAt?: number;
	readonly entries: number;
	readonly messages: number;
	readonly toolCalls: number;
	readonly runs: number;
}

async function collectDetails(session: Session): Promise<SessionDetails> {
	const row = await session.row();
	const entries = await session.entries();

	let messages = 0;
	let toolCalls = 0;
	let runs = 0;
	for (const { entry } of entries) {
		if (entry.type === "message") {
			messages += 1;
			continue;
		}
		if (entry.type !== "custom") continue;
		if (entry.customType === "tool/result") toolCalls += 1;
		if (entry.customType === "agent/start") runs += 1;
	}

	return {
		name: row.name,
		path: row.path,
		storage: row.storage,
		createdAt: row.createdAt,
		...(row.startedAt === undefined ? {} : { startedAt: row.startedAt }),
		...(row.persona === undefined ? {} : { persona: row.persona }),
		...(row.forkedFrom === undefined ? {} : { forkedFrom: row.forkedFrom }),
		...(row.pinned === undefined ? {} : { pinned: row.pinned }),
		running: row.running,
		...(row.workspace == null ? {} : { workspace: { path: row.workspace, kind: row.workspaceKind ?? null, repo: row.workspaceRepo ?? null } }),
		...(row.lastMessageAt === undefined ? {} : { lastMessageAt: row.lastMessageAt }),
		entries: entries.length,
		messages,
		toolCalls,
		runs,
	};
}

export const detailsExtension: Extension = {
	id: "details",
	apiVersion: 1,

	contributions: {
		"session.menu": [{ id: "details", order: 0, group: "view", title: "View details", icon: "info", action: "details.session" }],
	},

	activate(context) {
		context.actions.register({
			id: "details.session",
			run: async ({ session, dialog }) => {
				if (!session) throw new Error("details.session needs a session");
				await dialog?.({ kind: "custom", id: "session-details", title: session.name, data: await collectDetails(session) });
			},
		});
	},
};
