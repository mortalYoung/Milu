import { randomUUID } from "node:crypto";
import type { ChatMeta } from "./agent";

/** How far an exchange may travel before it stops. One ask is one hop; an answer does not add one. */
export const PEER_HOP_LIMIT = 4;

export interface PeerAsk {
	requestId: string;
	from: string;
	hop: number;
}

/** The answer a letter owes right now: who is waiting, and for what. */
export interface PendingReply {
	to: string;
	requestId: string;
	hop: number;
}

export interface PeerEndpoint {
	name: string;
	chat(text: string, meta?: ChatMeta): Promise<unknown>;
	/** A terminal status the asker should see: it is not an answer, so it is recorded as a notice. */
	notice(text: string, details: Record<string, unknown>): Promise<void>;
}

export interface PeerHost {
	endpoint(name: string): Promise<PeerEndpoint | undefined>;
}

const inbound = new Map<string, PeerAsk>();

/** The hop counter a letter is currently working at: 0 when the user asked, N when answering a peer. */
export function peerHopFor(partner: string): number {
	return inbound.get(partner)?.hop ?? 0;
}

/** Called when a peer message is actually claimed from the queue, so the run that follows knows it
 * owes someone an answer. */
export function claimInboundAsk(partner: string, item: { peer?: string; peerKind?: "ask" | "reply"; requestId?: string; hop?: number }): void {
	if (item.peerKind !== "ask" || !item.peer || !item.requestId) return;
	inbound.set(partner, { requestId: item.requestId, from: item.peer, hop: item.hop ?? 0 });
}

/** What the delivery step needs to know: the text this run is about to show is also an answer. */
export function pendingReply(partner: string): PendingReply | null {
	const ask = inbound.get(partner);
	return ask ? { to: ask.from, requestId: ask.requestId, hop: ask.hop } : null;
}

/** The run delivered its answer: mirror it into the asker's log as an ordinary message from here. */
export async function sendReply(host: PeerHost, input: { from: string; to: string; text: string; requestId: string; hop: number }): Promise<void> {
	inbound.delete(input.from);
	const asker = await host.endpoint(input.to);
	if (!asker) return;
	await asker.chat(input.text, { source: "peer", peer: input.from, peerKind: "reply", requestId: input.requestId, hop: input.hop });
}

/** A run that was answering a peer ended without delivering anything: close the ask with a status
 * notice, never with a fabricated answer. */
export async function closeUnansweredAsk(host: PeerHost, partner: string): Promise<void> {
	const ask = inbound.get(partner);
	if (!ask) return;
	inbound.delete(partner);
	const asker = await host.endpoint(ask.from);
	if (!asker) return;
	await asker.notice(`[${partner} did not answer] the run ended without text`, { peer: partner, requestId: ask.requestId, hop: ask.hop, status: "empty" });
}

/** A capped ask lands here. Today it always refuses; the day one should be parked for the user to
 * approve instead, this is the only function that changes — the tool contract stays as it is. */
async function answerCappedAsk(input: { to: string }): Promise<{ ok: false; error: string }> {
	return { ok: false, error: `the exchange reached its ${PEER_HOP_LIMIT}-hop limit; "${input.to}" was not asked` };
}

export async function askPeer(
	host: PeerHost,
	input: { from: string; to: string; text: string; hop: number },
): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
	const text = input.text.trim();
	if (text === "") return { ok: false, error: "the message is empty" };
	if (input.to === input.from) return { ok: false, error: "a letter cannot write to itself" };
	if (input.hop + 1 > PEER_HOP_LIMIT) return answerCappedAsk(input);
	const target = await host.endpoint(input.to);
	if (!target) return { ok: false, error: `no letter named "${input.to}"` };
	const requestId = randomUUID();
	await target.chat(text, { source: "peer", peer: input.from, peerKind: "ask", requestId, hop: input.hop + 1 });
	return { ok: true, requestId };
}
