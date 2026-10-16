export interface Disposable {
	dispose(): void;
}

export class DisposableStore implements Disposable {
	private readonly items: Disposable[] = [];
	private closed = false;

	get isDisposed(): boolean {
		return this.closed;
	}

	add<T extends Disposable>(item: T): T {
		if (this.closed) {
			item.dispose();
			return item;
		}
		this.items.push(item);
		return item;
	}

	dispose(): void {
		if (this.closed) return;
		this.closed = true;

		const failures: unknown[] = [];
		for (const item of this.items.splice(0).reverse()) {
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
