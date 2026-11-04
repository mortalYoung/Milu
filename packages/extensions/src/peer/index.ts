import { type ExecutionEnv, EVENTS, type Extension, IHookService, ISessionService, reminderText, type ToolCall, IToolService, type ToolResult, Type } from "@milu/core";

import { PeerService, IPeerService } from "./service/index.ts";

const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("send")], {
		description: 'What to do: "list" the chats you can write to, or "send" one of them a message.',
	}),
	peer: Type.Optional(Type.String({ description: "send: the chat to write to (a name from list)" })),
	text: Type.Optional(Type.String({ description: "send: the message. A reply may arrive later as a new message." })),
});

interface PeerParams {
	op: "list" | "send";
	peer?: string;
	text?: string;
}

function say(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text }], details };
}

const peerExtension: Extension = {
	id: "peer",
	apiVersion: 1,

	services: [{ id: IPeerService, create: (container) => new PeerService(container.get(ISessionService)) }],

	activate(context) {
		const peer = context.get(IPeerService);

		context.disposables.add(context.get(ISessionService).onLoopEvent(({ session, event }) => peer.watch(session, event)));

		context.disposables.add(
			context.get(IHookService).on("beforeRequest", ({ messages, inject }) => {
				const incoming = [...messages].reverse().find((message) => message.role === "user" && typeof (message as { reminder?: unknown }).reminder !== "string") as
					| { readonly from?: unknown; readonly notice?: unknown }
					| undefined;
				if (!incoming || incoming.notice === true || typeof incoming.from !== "string") return;

				const reminder = { type: EVENTS.peerMessage, data: { from: incoming.from } } as const;
				const text = reminderText(reminder.type, reminder.data);
				if (messages.some((message) => message.role === "user" && message.content === text)) return;
				inject(reminder);
			}),
		);

		context.disposables.add(
			context.get(IToolService).register({
				name: "peer",
				label: "Peer",
				description:
					"Write to another chat. It is a separate correspondent with its own workspace, persona and tools: it decides whether and how to reply, and a reply may arrive later as a new message. Sending does not end your turn; never write the reply yourself.",
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
						if (!name || !text) return say('peer send needs both "peer" and "text".', { ok: false, error: "missing-field" });
						const result = await peer.send({ from: call.session, to: name, text });
						if (!result.ok) return say(`peer send failed: ${result.error}`, { ok: false, error: result.error });
						return say(`delivered to ${name}. It decides whether and how to reply; do not write the reply yourself.`, { ok: true });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return say(`peer failed: ${message}`, { ok: false, error: message });
					}
				},
			}),
		);
	},
};

export default peerExtension;
