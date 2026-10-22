import { type ExecutionEnv, type Extension, SessionServiceId, type ToolCall, ToolServiceId, type ToolResult, Type } from "@milu/core";

import { PeerService, PeerServiceId } from "./service/index.ts";

const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("ask")], {
		description: 'What to do: "list" the chats you can write to, or "ask" one of them something.',
	}),
	peer: Type.Optional(Type.String({ description: "ask: the chat to write to (a name from list)" })),
	text: Type.Optional(Type.String({ description: "ask: what to ask it. Its answer arrives later, as a new message." })),
});

interface PeerParams {
	op: "list" | "ask";
	peer?: string;
	text?: string;
}

function say(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text }], details };
}

export const peerExtension: Extension = {
	id: "peer",
	apiVersion: 1,

	services: [{ id: PeerServiceId, create: (container) => new PeerService(container.get(SessionServiceId)) }],

	activate(context) {
		const peer = context.get(PeerServiceId);

		context.disposables.add(context.get(SessionServiceId).onLoopEvent(({ session, event }) => peer.observe(session, event)));

		context.disposables.add(
			context.get(ToolServiceId).register({
				name: "peer",
				label: "Peer",
				description:
					"Write to another chat. It is a separate correspondent with its own workspace, persona and tools: it decides whether and how to answer, and its answer arrives later as a new message. The call is asynchronous — after asking, end your turn and never answer on its behalf.",
				parameters: schema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const { op, peer: name, text } = call.params as PeerParams;
					try {
						if (op === "list") {
							const members = await peer.list(call.session.name);
							return say(
								members.length === 0 ? "(no other chats)" : members.map((member) => (member.forkedFrom ? `${member.name} (fork of ${member.forkedFrom})` : member.name)).join("\n"),
								{
									ok: true,
								},
							);
						}
						if (!name || !text) return say('peer ask needs both "peer" and "text".', { ok: false, error: "missing-field" });
						const result = await peer.ask({ from: call.session.name, to: name, text });
						if (!result.ok) return say(`peer ask failed: ${result.error}`, { ok: false, error: result.error });
						return say(`delivered to ${name} (${result.requestId}). Its answer will arrive as a new message; do not write it yourself.`, {
							ok: true,
							requestId: result.requestId,
						});
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return say(`peer failed: ${message}`, { ok: false, error: message });
					}
				},
			}),
		);
	},
};
