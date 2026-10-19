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
	private readonly _declared = new Set<string>();
	private readonly _owned = new DisposableStore();

	declare<T>(id: string): ContributionPoint<T> {
		if (this._declared.has(id)) throw new Error(`${id} is already declared`);
		this._declared.add(id);
		return this._owned.add(new ContributionPoint<T>(id));
	}

	dispose(): void {
		this._declared.clear();
		this._owned.dispose();
	}
}

export const ContributionServiceId = createServiceId<ContributionService>("ContributionService");
