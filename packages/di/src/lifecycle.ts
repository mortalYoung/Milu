export interface Disposable {
	dispose(): void;
}

export class DisposableStore implements Disposable {
	private readonly _items: Disposable[] = [];
	private _closed = false;

	get isDisposed(): boolean {
		return this._closed;
	}

	add<T extends Disposable>(item: T): T {
		if (this._closed) {
			item.dispose();
			return item;
		}
		this._items.push(item);
		return item;
	}

	dispose(): void {
		if (this._closed) return;
		this._closed = true;

		const failures: unknown[] = [];
		for (const item of this._items.splice(0).reverse()) {
			try {
				item.dispose();
			} catch (error) {
				failures.push(error);
			}
		}

		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "dispose failed");
	}
}

export interface Service extends Disposable {
	initialize?(): void | Promise<void>;
}
