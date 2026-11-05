import { type Extension, IContributionService, IHookService, ISettingsService, IToolService, SESSION_SIGNAL_POINT, type SessionSignalItem, Type } from "@milu/core";

import { PermissionService, IPermissionService } from "./service/index.ts";
import type { SandboxMode } from "./types.ts";

export { IPermissionService } from "./service/index.ts";

const escalationFields = {
	sandbox_mode: Type.Optional(
		Type.Union([Type.Literal("read-only"), Type.Literal("workspace-write"), Type.Literal("danger-full-access")], {
			description: "Request a strictly wider sandbox mode for THIS call only (one retry per turn; human approval required).",
		}),
	),
	justification: Type.Optional(Type.String({ description: "Required when sandbox_mode is set: why the wider permission is needed." })),
};

const permissionExtension: Extension = {
	id: "permission",
	apiVersion: 1,

	services: [
		{
			id: IPermissionService,
			create: (container) => new PermissionService(container.get(ISettingsService), container.get(IToolService)),
		},
	],

	activate(context) {
		const permission = context.get(IPermissionService);
		const tools = context.get(IToolService);

		context.disposables.add(
			context
				.get(IContributionService)
				.get<SessionSignalItem>(SESSION_SIGNAL_POINT)
				.contribute({
					id: "permission",
					order: 5,
					title: async (session) => {
						const pending = await permission.pending(session);
						if (pending.length === 0) return null;
						return "waiting for your approval";
					},
				}),
		);

		context.disposables.add(tools.extend({ tools: ["bash"], properties: escalationFields }));
		context.disposables.add(tools.use((call, env, next) => permission.intercept(call, env, next)));

		context.actions.register({
			id: "permission.sandbox",
			run: async ({ session, args }) => {
				if (!session) throw new Error("permission.sandbox needs a session");
				const mode = (args as { mode?: SandboxMode } | undefined)?.mode;
				if (mode !== "read-only" && mode !== "workspace-write" && mode !== "danger-full-access") throw new Error("permission.sandbox needs a mode");
				await permission.setMode(session, mode);
			},
		});

		context.actions.register({
			id: "permission.answer",
			run: async ({ session, args }) => {
				if (!session) throw new Error("permission.answer needs a session");
				const { escalationId, approved } = (args ?? {}) as { escalationId?: string; approved?: boolean };
				if (!escalationId) throw new Error("permission.answer needs an escalationId");
				const request = await permission.requestOf(session, escalationId);
				if (!request) throw new Error(`no escalation "${escalationId}"`);
				await permission.settle(session, request, approved ? "approved" : "rejected");
			},
		});

		context.disposables.add(
			context.get(IHookService).on("beforeRun", async ({ session }) => {
				for (const request of await permission.pending(session)) await permission.settle(session, request, "dropped", false);
			}),
		);
	},
};

export default permissionExtension;
