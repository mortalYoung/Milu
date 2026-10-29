import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
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

/** A run that failed, asked before anything about it is written down. */
export interface AgentFailureContext {
	readonly session: Session;
	readonly message: AssistantMessage;
	/** 1-based: the retry this decision would schedule. */
	readonly attempt: number;
}

export interface AgentRetryDecision {
	readonly delayMs: number;
	readonly maxRetries: number;
}

/** Answer by calling `retry` — the first listener that does decides, the rest are not asked. */
export type AgentFailureHook = (context: AgentFailureContext, retry: (decision: AgentRetryDecision) => void) => void | Promise<void>;

export class HookService implements Service {
	private readonly _points = new Map<AgentHookPoint, AgentHook[]>();
	private readonly _failures: AgentFailureHook[] = [];

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

	onFailure(listener: AgentFailureHook): Disposable {
		this._failures.push(listener);
		return {
			dispose: () => {
				const at = this._failures.indexOf(listener);
				if (at >= 0) this._failures.splice(at, 1);
			},
		};
	}

	/** Null means nobody wants this run retried: the failure is final. */
	async askRetry(context: AgentFailureContext): Promise<AgentRetryDecision | null> {
		let decision: AgentRetryDecision | null = null;
		for (const listener of this._failures.slice()) {
			try {
				await listener(context, (each) => {
					decision ??= { delayMs: Math.max(0, each.delayMs), maxRetries: Math.max(1, each.maxRetries) };
				});
			} catch (error) {
				console.error("retry hook failed:", error);
			}
			if (decision !== null) break;
		}
		return decision;
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

export const IHookService = createServiceId<HookService>("HookService");
