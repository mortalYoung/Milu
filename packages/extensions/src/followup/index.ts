import { COMPOSER_ABOVE_POINT, type Extension, followUpView, IContributionService, type Session } from "@milu/core";
import type { SlotItem } from "@milu/protocol";

const followupExtension: Extension = {
	id: "followup",
	apiVersion: 1,
	widgets: [{ id: "followup.dock", type: "slot", entry: "./widget/dock.tsx", export: "FollowUpDock" }],

	activate(context) {
		context.disposables.add(
			context
				.get(IContributionService)
				.get<SlotItem>(COMPOSER_ABOVE_POINT)
				.contribute({
					id: "followup",
					component: "followup.dock",
					order: 10,
					data: async (session: Session) => ({ session: session.name }),
				}),
		);

		context.actions.register({
			id: "followup.list",
			run: ({ session }) => ({ data: { items: session ? session.followUps().map(followUpView) : [] } }),
		});

		context.actions.register({
			id: "followup.cancel",
			run: ({ session, args }) => {
				if (!session) throw new Error("followup.cancel needs a session");
				const id = typeof args === "object" && args !== null && "id" in args ? (args as { id?: unknown }).id : undefined;
				if (typeof id !== "string") throw new Error("followup.cancel needs a message id");
				if (!session.cancelFollowUp(id)) throw new Error("that message is no longer waiting");
			},
		});
	},
};

export default followupExtension;
