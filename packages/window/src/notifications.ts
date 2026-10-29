import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

export type NotificationTone = "plain" | "error";

export interface Notification {
	readonly id: number;
	readonly title?: string;
	readonly body: string;
	readonly tone: NotificationTone;
	readonly createdAt: number;
	/** The session the row is about — a row that carries one opens it when clicked. */
	readonly session?: string;
}

export interface NotificationInput {
	readonly title?: string;
	readonly body: string;
	readonly tone?: NotificationTone;
	readonly session?: string;
}

export class NotificationService implements Service {
	readonly store = createStore<{ readonly items: readonly Notification[] }>()(() => ({ items: [] }));

	private _next = 1;

	push(input: NotificationInput): number {
		const id = this._next++;
		const item: Notification = {
			id,
			body: input.body,
			tone: input.tone ?? "plain",
			createdAt: Date.now(),
			...(input.title === undefined ? {} : { title: input.title }),
			...(input.session === undefined ? {} : { session: input.session }),
		};
		this.store.setState((state) => ({ items: [...state.items, item] }));
		return id;
	}

	dismiss(id: number): void {
		this.store.setState((state) => (state.items.some((item) => item.id === id) ? { items: state.items.filter((item) => item.id !== id) } : state));
	}

	dispose(): void {
		this.store.setState({ items: [] });
	}
}

export const INotificationService = createServiceId<NotificationService>("NotificationService");
