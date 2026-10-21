import { type Extension, HookServiceId, SettingsServiceId, ToolServiceId, Type } from "@milu/core";

import { PermissionService, PermissionServiceId } from "./service.ts";

const escalationFields = {
	sandbox_mode: Type.Optional(
		Type.Union([Type.Literal("read-only"), Type.Literal("workspace-write"), Type.Literal("danger-full-access")], {
			description: "Request a strictly wider sandbox mode for THIS call only (one retry per turn; human approval required).",
		}),
	),
	justification: Type.Optional(Type.String({ description: "Required when sandbox_mode is set: why the wider permission is needed." })),
};

export const permissionExtension: Extension = {
	id: "permission",
	apiVersion: 1,

	services: [
		{
			id: PermissionServiceId,
			create: (container) => new PermissionService(container.get(SettingsServiceId), container.get(ToolServiceId)),
		},
	],

	activate(context) {
		const permission = context.get(PermissionServiceId);
		const tools = context.get(ToolServiceId);

		context.disposables.add(tools.extend({ tools: ["bash"], properties: escalationFields }));
		context.disposables.add(tools.use((call, next) => permission.intercept(call, next)));

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
			context.get(HookServiceId).on("beforeRun", async ({ session }) => {
				for (const request of await permission.pending(session)) await permission.settle(session, request, "dropped", false);
			}),
		);
	},
};
