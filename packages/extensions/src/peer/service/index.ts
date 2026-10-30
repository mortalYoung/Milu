import { type AgentLoopEvent, type Session, type SessionService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

export const PEER_HOP_LIMIT = 4;

interface PeerMember {
	readonly name: string;
	readonly forkedFrom?: string;
}

interface PeerEnvelope {
	readonly from?: unknown;
	readonly hop?: unknown;
	readonly notice?: unknown;
}

export class PeerService implements Service {
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

	async send(input: { from: Session; to: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
		const text = input.text.trim();
		if (text === "") return { ok: false, error: "the message is empty" };
		if (input.to === input.from.name) return { ok: false, error: "a chat cannot write to itself" };

		const hop = this._lastHop(input.from) + 1;
		if (hop > PEER_HOP_LIMIT) return { ok: false, error: `the exchange reached its ${PEER_HOP_LIMIT}-hop limit; "${input.to}" was not sent` };

		const target = await this._session(input.to);
		if (!target) return { ok: false, error: `no chat named "${input.to}"` };

		const delivered = await target.deliver(text, { peer: { from: input.from.name, hop } });
		if (!delivered.ok) return { ok: false, error: `"${input.to}" could not start: ${delivered.error}` };
		return { ok: true };
	}

	watch(session: string, event: AgentLoopEvent): void {
		if (event.type !== "run_end" || event.stopped === true || event.error === undefined) return;
		if (this._sessionService.get(session).hasSuspended()) return;
		void this._notifyFailure(session, event.error).catch((error: unknown) => console.error(`peer ${session}: failure notice failed:`, error));
	}

	dispose(): void {}

	private async _notifyFailure(session: string, error: string): Promise<void> {
		const local = this._sessionService.get(session);
		const lastUser = this._lastPromptedUser(local);
		if (!lastUser || typeof lastUser.from !== "string" || lastUser.notice === true) return;

		const asker = await this._session(lastUser.from);
		if (!asker) return;
		const detail = error.length > 500 ? `${error.slice(0, 500)}…` : error;
		await asker.deliver(`[agent "${session}" could not answer] ${detail}. No reply is needed.`, {
			peer: { from: session, hop: typeof lastUser.hop === "number" ? lastUser.hop : 0, notice: true },
		});
	}

	private _lastHop(from: Session): number {
		const lastUser = this._lastPromptedUser(from);
		if (!lastUser || typeof lastUser.from !== "string" || lastUser.notice === true) return 0;
		return typeof lastUser.hop === "number" ? lastUser.hop : 0;
	}

	private _lastPromptedUser(from: Session): PeerEnvelope | undefined {
		return [...from.messages()].reverse().find((message) => message.role === "user" && typeof (message as { reminder?: unknown }).reminder !== "string") as
			| PeerEnvelope
			| undefined;
	}

	private async _session(name: string): Promise<Session | null> {
		return (await this._sessionService.names()).includes(name) ? this._sessionService.get(name) : null;
	}
}

export const IPeerService = createServiceId<PeerService>("peer.service");
