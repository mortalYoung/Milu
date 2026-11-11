import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

export interface WindowMotion {
	readonly drag: "left" | "right" | null;
	readonly look: number | null;
}

const IDLE: WindowMotion = { drag: null, look: null };

export interface MotionState {
	readonly byWindow: Readonly<Record<string, WindowMotion>>;
}

export class MotionService implements Service {
	readonly store = createStore<MotionState>()(() => ({ byWindow: {} }));

	apply(window: string, drag: "left" | "right" | null, look: number | null): void {
		const current = this.store.getState().byWindow[window];
		if (current !== undefined && current.drag === drag && current.look === look) return;
		this.store.setState((state) => ({ byWindow: { ...state.byWindow, [window]: { drag, look } } }), true);
	}

	get(window: string): WindowMotion {
		return this.store.getState().byWindow[window] ?? IDLE;
	}

	dispose(): void {}
}

export const IMotionService = createServiceId<MotionService>("MotionService");
