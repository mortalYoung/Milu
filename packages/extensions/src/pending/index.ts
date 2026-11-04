import { COMPOSER_ABOVE_POINT, type Extension, IContributionService, pendingView, type Session } from "@milu/core";
import type { PendingKind, SlotItem } from "@milu/protocol";

function kindOf(args: unknown): PendingKind {
	const kind = typeof args === "object" && args !== null && "kind" in args ? (args as { kind?: unknown }).kind : undefined;
	if (kind !== "steering" && kind !== "follow-up") throw new Error("pending.convert needs a kind");
	return kind;
}

function idOf(error: string, args: unknown): string {
	const id = typeof args === "object" && args !== null && "id" in args ? (args as { id?: unknown }).id : undefined;
	if (typeof id !== "string") throw new Error(`${error} needs a message id`);
	return id;
}

const pendingExtension: Extension = {
	id: "pending",
	apiVersion: 1,
	widgets: [{ id: "pending.dock", type: "slot", entry: "./widget/dock.tsx", export: "PendingDock" }],

	activate(context) {
		context.disposables.add(
			context
				.get(IContributionService)
				.get<SlotItem>(COMPOSER_ABOVE_POINT)
				.contribute({
					id: "pending",
					component: "pending.dock",
					order: 10,
					data: async (session: Session) => ({ session: session.name }),
				}),
		);

		context.actions.register({
			id: "pending.list",
			run: ({ session }) => ({ data: { items: session ? session.pending().map(({ kind, message }) => pendingView(message, kind)) : [] } }),
		});

		context.actions.register({
			id: "pending.cancel",
			run: ({ session, args }) => {
				if (!session) throw new Error("pending.cancel needs a session");
				if (!session.cancelPending(idOf("pending.cancel", args))) throw new Error("that message is no longer waiting");
			},
		});

		context.actions.register({
			id: "pending.convert",
			run: ({ session, args }) => {
				if (!session) throw new Error("pending.convert needs a session");
				if (!session.convertPending(idOf("pending.convert", args), kindOf(args))) throw new Error("that message is no longer waiting");
			},
		});
	},
};

export default pendingExtension;
