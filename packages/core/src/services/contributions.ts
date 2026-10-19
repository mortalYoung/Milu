import { createServiceId, type Disposable, DisposableStore, type Service } from "@milu/di";

export class ContributionPoint<T> implements Disposable {
	readonly id: string;

	private readonly _values: T[] = [];

	constructor(id: string) {
		this.id = id;
	}

	contribute(value: T): Disposable {
		this._values.push(value);
		return {
			dispose: () => {
				const at = this._values.indexOf(value);
				if (at >= 0) this._values.splice(at, 1);
			},
		};
	}

	all(): readonly T[] {
		return this._values;
	}

	dispose(): void {
		this._values.length = 0;
	}
}

export class ContributionService implements Service {
	private readonly _points = new Map<string, ContributionPoint<unknown>>();
	private readonly _owned = new DisposableStore();

	get<T>(id: string): ContributionPoint<T> {
		const found = this._points.get(id);
		if (!found) throw new Error(`contribution point "${id}" was never declared`);
		return found as ContributionPoint<T>;
	}

	declare<T>(id: string): ContributionPoint<T> {
		if (this._points.has(id)) throw new Error(`${id} is already declared`);
		const point = this._owned.add(new ContributionPoint<T>(id));
		this._points.set(id, point as ContributionPoint<unknown>);
		return point;
	}

	dispose(): void {
		this._points.clear();
		this._owned.dispose();
	}
}

export const ContributionServiceId = createServiceId<ContributionService>("ContributionService");
