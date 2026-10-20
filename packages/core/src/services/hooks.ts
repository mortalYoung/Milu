import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createServiceId, type Disposable, type Service } from "@milu/di";

import type { AgentReminder } from "../session/events.ts";
import type { Session } from "../session/session.ts";

export type AgentHookPoint = "beforeRun" | "beforeRequest";

export interface AgentHookContext {
	readonly session: Session;
	readonly messages: readonly AgentMessage[];
	inject(reminder: AgentReminder): void;
}

export type AgentHook = (context: AgentHookContext) => void | Promise<void>;

export class HookService implements Service {
	private readonly _points = new Map<AgentHookPoint, AgentHook[]>();

	initialize(): void {
		this.register("beforeRun");
		this.register("beforeRequest");
	}

	register(point: AgentHookPoint): void {
		if (this._points.has(point)) throw new Error(`hook point "${point}" is already registered`);
		this._points.set(point, []);
	}

	on(point: AgentHookPoint, listener: AgentHook): Disposable {
		const listeners = this._points.get(point);
		if (!listeners) throw new Error(`hook point "${point}" was never registered`);
		listeners.push(listener);
		return {
			dispose: () => {
				const at = listeners.indexOf(listener);
				if (at >= 0) listeners.splice(at, 1);
			},
		};
	}

	async emit(point: AgentHookPoint, context: Omit<AgentHookContext, "inject">): Promise<readonly AgentReminder[]> {
		const listeners = this._points.get(point);
		if (!listeners) throw new Error(`hook point "${point}" was never registered`);

		const injected: AgentReminder[] = [];
		const hooked: AgentHookContext = {
			...context,
			inject: (reminder) => {
				injected.push(reminder);
			},
		};
		for (const listener of listeners.slice()) {
			try {
				await listener(hooked);
			} catch (error) {
				console.error(`hook "${point}" failed:`, error);
			}
		}
		return injected;
	}

	dispose(): void {
		this._points.clear();
	}
}

export const HookServiceId = createServiceId<HookService>("HookService");
