interface ProviderAccounts {
	/** The host answers with a plain snapshot, or null when this chat runs somewhere it has no account facts for. */
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
					/* No key, no account, no network — the pill simply is not drawn. */
					return null;
				}
			}),
		);
	},
};
