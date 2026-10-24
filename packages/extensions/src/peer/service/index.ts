import { randomUUID } from "node:crypto";

import { type AgentLoopEvent, type AgentMessage, EVENTS, type Session, type SessionService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

export const PEER_ASK_HOP_LIMIT = 4;

interface InboundAsk {
	readonly from: string;
	readonly requestId: string;
	readonly hop: number;
}

interface PeerMember {
	readonly name: string;
	readonly forkedFrom?: string;
}
function assistantText(message: AgentMessage): string {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((block): block is { type: "text"; text: string } => (block as { type?: unknown }).type === "text")
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.join("\n")
		.trim();
}

export class PeerService implements Service {
	private readonly _inbound = new Map<string, InboundAsk>();
	private readonly _text = new Map<string, string>();

	constructor(private readonly _sessionService: SessionService) {}

	async list(asker: string): Promise<readonly PeerMember[]> {
		const names = (await this._sessionService.names()).filter((name) => name !== asker);
		return Promise.all(
			names.map(async (name) => {
				const profile = await this._sessionService.get(name).profile();
				return { name, ...(profile?.forkedFrom ? { forkedFrom: profile.forkedFrom } : {}) };
			}),
		);
	}

	async ask(input: { from: string; to: string; text: string }): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
		const text = input.text.trim();
		if (text === "") return { ok: false, error: "the message is empty" };
		if (input.to === input.from) return { ok: false, error: "a chat cannot write to itself" };

		const hop = this._nextHop(input.from);
		if (hop > PEER_ASK_HOP_LIMIT) return { ok: false, error: `the exchange reached its ${PEER_ASK_HOP_LIMIT}-hop limit; "${input.to}" was not asked` };

		const target = await this._session(input.to);
		if (!target) return { ok: false, error: `no chat named "${input.to}"` };

		const requestId = randomUUID();
		await target.deliver(text, { peer: { from: input.from, kind: "ask", requestId, hop } });
		return { ok: true, requestId };
	}

	observe(session: string, event: AgentLoopEvent): void {
		if (event.type === "run_start") {
			this._text.delete(session);
			return;
		}

		if (event.type === "message_end") {
			const message = event.message as AgentMessage & { from?: unknown; peerKind?: unknown; requestId?: unknown; hop?: unknown };
			if (message.role === "user") {
				if (message.peerKind === "ask" && typeof message.from === "string" && typeof message.requestId === "string") {
					this._inbound.set(session, { from: message.from, requestId: message.requestId, hop: typeof message.hop === "number" ? message.hop : 0 });
				}
				return;
			}
			if (message.role === "assistant") this._text.set(session, assistantText(message));
			return;
		}

		if (event.type !== "run_end") return;

		const inbound = this._inbound.get(session);
		const text = this._text.get(session) ?? "";
		this._text.delete(session);
		if (!inbound) return;
		if (this._sessionService.get(session).hasSuspended()) return;

		this._inbound.delete(session);
		void this._settle(session, inbound, text).catch((error: unknown) => console.error(`peer ${session}: settle failed:`, error));
	}

	dispose(): void {
		this._inbound.clear();
		this._text.clear();
	}

	private _nextHop(from: string): number {
		return (this._inbound.get(from)?.hop ?? 0) + 1;
	}

	private async _settle(session: string, inbound: InboundAsk, text: string): Promise<void> {
		const local = this._sessionService.get(session);
		const lastUser = [...(await local.open()).messages()].reverse().find((message) => message.role === "user") as { peerKind?: unknown; requestId?: unknown } | undefined;
		const owes = lastUser?.peerKind === "ask" && lastUser.requestId === inbound.requestId;

		if (owes && text !== "") {
			await local.record(EVENTS.sendMessage, {
				text,
				via: "harness",
				to: inbound.from,
				requestId: inbound.requestId,
				hop: inbound.hop,
				timestamp: Date.now(),
			});
			const asker = await this._session(inbound.from);
			if (asker) await asker.deliver(text, { peer: { from: session, kind: "reply", requestId: inbound.requestId, hop: inbound.hop } });
			return;
		}

		const asker = await this._session(inbound.from);
		if (!asker) return;
		await asker.record(EVENTS.sendMessage, {
			text: owes ? `[${session} did not answer] the run ended without text` : `[${session} did not answer] the conversation moved on`,
			peer: session,
			requestId: inbound.requestId,
			hop: inbound.hop,
			status: "empty",
			timestamp: Date.now(),
		});
	}

	private async _session(name: string): Promise<Session | null> {
		return (await this._sessionService.names()).includes(name) ? this._sessionService.get(name) : null;
	}
}

export const IPeerService = createServiceId<PeerService>("peer.service");
