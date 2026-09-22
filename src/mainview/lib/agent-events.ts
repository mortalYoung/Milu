import type { createAgentStatus } from "./agent-status";
import type { createCommandDirectory } from "./commands";
import type { RPC } from "./rpc";
import type { Session } from "./session";
import type { Toast } from "./toast";

export function createAgentEvents(
	rpc: RPC,
	deps: {
		session: Session;
		status: ReturnType<typeof createAgentStatus>;
		commands: ReturnType<typeof createCommandDirectory>;
		toast: Toast;
		openPartner: (name: string) => void;
	},
) {
	const { session, status, commands, toast, openPartner } = deps;
	const selected = () => session.store.getState().selected;
	const escalationToasts = new Map<string, number>();

	function install() {
		rpc.addMessageListener("agent_turn", ({ partner }) => {
			status.beginTurn(partner);
			status.calibrate();
			void session.mutate.refreshPartners();
		});

		rpc.addMessageListener("agent_message", ({ partner }) => {
			if (partner === selected()) void session.mutate.refreshHistory();
			void session.mutate.refreshPartners();
		});

		rpc.addMessageListener("origin_update", ({ partner }) => {
			if (partner === selected()) void session.mutate.refreshHistory();
		});

		rpc.addMessageListener("inbox_update", ({ partner, kind }) => {
			if (kind !== "claimed" || partner !== selected()) return;
			void session.mutate.refreshHistory();
		});

		rpc.addMessageListener("escalation_update", ({ partner, escalationId, command, from, to, resolved }) => {
			if (partner === undefined || partner === selected()) void session.mutate.refreshHistory();
			status.calibrate();
			if (escalationId === undefined) return;
			const open = escalationToasts.get(escalationId);
			if (resolved) {
				if (open !== undefined) toast.dismiss(open);
				escalationToasts.delete(escalationId);
				return;
			}
			if (partner === undefined || open !== undefined) return;
			const shift = from === undefined || to === undefined ? "" : `${from} → ${to} · `;
			escalationToasts.set(
				escalationId,
				toast.push({
					title: `${partner} · sandbox escalation`,
					body: `${shift}${command ?? "a tool call"} · click to approve`,
					avatar: partner.charAt(0),
					durationMs: 0,
					onClick: () => void rpc.request.sandbox_respond({ id: escalationId, approved: true }),
				}),
			);
		});

		rpc.addMessageListener("command_update", () => {
			void session.mutate.refreshHistory();
			void session.mutate.refreshPartners();
			void commands.refresh();
			status.calibrate();
		});

		rpc.addMessageListener("skill_update", () => void session.mutate.refreshHistory());
		rpc.addMessageListener("shell_update", () => void session.mutate.refreshHistory());

		rpc.addMessageListener("agent_end", async ({ error, partner }) => {
			status.endTurn(partner);
			if (partner === selected()) {
				void session.mutate.refreshHistory();
				await session.mutate.refreshPartners().catch(() => {});
				status.releaseTurn(partner);
				status.calibrate();
				return;
			}
			await session.mutate.refreshPartners().catch(() => {});
			status.releaseTurn(partner);
			const profile = session.store.getState().partners.find((p) => p.name === partner);
			const last = profile?.lastMessageKind === "send_message" ? profile.lastMessage : undefined;
			toast.push(
				error
					? {
							title: `${partner} ended with an error`,
							body: error || last || "Click to open this chat and review",
							onClick: () => openPartner(partner),
							avatar: partner.charAt(0),
						}
					: {
							title: `${partner} finished`,
							body: last || "Click to view the conversation",
							onClick: () => openPartner(partner),
							avatar: partner.charAt(0),
						},
				error ? "error" : "default",
			);
			status.calibrate();
		});
	}

	return { install };
}
