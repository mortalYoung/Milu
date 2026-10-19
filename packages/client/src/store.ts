import { Emitter, type Event } from "@milu/di";

/** One value, one owner, and whoever renders it subscribes — the only channel a surface has to state. */
export class Store<T> {
	private _value: T;
	private readonly _emitter = new Emitter<T>();

	constructor(initial: T) {
		this._value = initial;
	}

	get = (): T => this._value;

	readonly subscribe = (listener: () => void): (() => void) => {
		const subscription = this._emitter.event(() => listener());
		return () => subscription.dispose();
	};

	get event(): Event<T> {
		return this._emitter.event;
	}

	set(next: T): void {
		if (Object.is(next, this._value)) return;
		this._value = next;
		this._emitter.fire(next);
	}

	update(change: (current: T) => T): void {
		this.set(change(this._value));
	}

	dispose(): void {
		this._emitter.dispose();
	}
}
