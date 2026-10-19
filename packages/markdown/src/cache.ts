export class RenderCache {
	private readonly _entries = new Map<string, string>();

	constructor(private readonly _limit: number) {}

	get(key: string): string | undefined {
		const hit = this._entries.get(key);
		if (hit === undefined) return undefined;
		this._entries.delete(key);
		this._entries.set(key, hit);
		return hit;
	}

	set(key: string, value: string): void {
		if (this._entries.size >= this._limit) {
			const oldest = this._entries.keys().next().value;
			if (oldest !== undefined) this._entries.delete(oldest);
		}
		this._entries.set(key, value);
	}

	clear(): void {
		this._entries.clear();
	}
}
