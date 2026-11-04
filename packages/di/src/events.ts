import type { Disposable } from "./lifecycle.ts";

export type Event<T> = (listener: (event: T) => void) => Disposable;

export class Emitter<T> implements Disposable {
	private readonly _listeners = new Set<(event: T) => void>();
	private _closed = false;

	get event(): Event<T> {
		return (listener) => {
			if (this._closed) return { dispose: () => {} };
			this._listeners.add(listener);
			return {
				dispose: () => {
					this._listeners.delete(listener);
				},
			};
		};
	}

	fire(event: T): void {
		if (this._closed) return;
		const listeners = [...this._listeners];
		for (const listener of listeners) listener(event);
	}

	dispose(): void {
		this._closed = true;
		this._listeners.clear();
	}
}
