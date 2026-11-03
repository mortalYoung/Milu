import { createServiceId, type Disposable, type Service } from "@milu/di";

export type CapabilityMethod = (...args: readonly unknown[]) => unknown;

/**
 * What an out-of-process extension may ask the host to do. A capability is a name and a few methods —
 * never a service: the child sends plain values and gets plain values back, and anything that cannot
 * cross the process boundary is refused here rather than surfacing as a broken promise in the child.
 */
export class CapabilityService implements Service {
	private readonly _capabilities = new Map<string, ReadonlyMap<string, CapabilityMethod>>();

	register(name: string, methods: Readonly<Record<string, CapabilityMethod>>): Disposable {
		if (!name.startsWith("core.")) throw new Error(`capability "${name}" must live under "core."`);
		if (this._capabilities.has(name)) throw new Error(`capability "${name}" is already registered`);
		this._capabilities.set(name, new Map(Object.entries(methods)));
		return {
			dispose: () => {
				this._capabilities.delete(name);
			},
		};
	}

	names(): readonly string[] {
		return [...this._capabilities.keys()].sort();
	}

	methods(name: string): readonly string[] {
		return [...(this._capabilities.get(name)?.keys() ?? [])].sort();
	}

	async call(name: string, method: string, args: readonly unknown[]): Promise<unknown> {
		const methods = this._capabilities.get(name);
		if (methods === undefined) throw new Error(`capability "${name}" is not declared`);
		const run = methods.get(method);
		if (run === undefined) throw new Error(`capability "${name}" has no method "${method}"`);
		const result = await run(...args);
		try {
			structuredClone(result);
		} catch (error) {
			throw new Error(`capability "${name}"."${method}" returned a value that cannot cross the process boundary: ${error instanceof Error ? error.message : String(error)}`);
		}
		return result;
	}

	dispose(): void {
		this._capabilities.clear();
	}
}

export const ICapabilityService = createServiceId<CapabilityService>("CapabilityService");
