import { createServiceId, Emitter, type Event, type Service } from "@milu/di";
import type { LifecyclePhase } from "@milu/protocol";

export class LifecycleService implements Service {
	private _phase: LifecyclePhase = "starting";
	private readonly _emitter = new Emitter<LifecyclePhase>();

	readonly onChange: Event<LifecyclePhase> = this._emitter.event;

	get phase(): LifecyclePhase {
		return this._phase;
	}

	advance(phase: LifecyclePhase): void {
		if (this._phase === phase) return;
		this._phase = phase;
		this._emitter.fire(phase);
	}

	dispose(): void {
		this._emitter.dispose();
	}
}

export const ILifecycleService = createServiceId<LifecycleService>("LifecycleService");
