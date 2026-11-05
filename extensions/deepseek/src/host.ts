interface ProviderAccounts {
	balance(session: string | null): Promise<unknown>;
}

interface ChildContext {
	readonly contributions: { provide(key: string, load: (session: string | null) => unknown): { dispose(): void } };
	readonly services: { get(id: string): ProviderAccounts };
	readonly disposables: { add<T>(value: T): T };
}

export default {
	activate(context: ChildContext) {
		const accounts = context.services.get("core.provider");
		context.disposables.add(
			context.contributions.provide("balance", async (session) => {
				try {
					return await accounts.balance(session);
				} catch {
					return null;
				}
			}),
		);
	},
};
