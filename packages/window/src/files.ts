import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

export interface FilesState {
	readonly changed: Readonly<Record<string, number>>;
}

export class FileEventsService implements Service {
	readonly store = createStore<FilesState>()(() => ({ changed: {} }));

	mark(path: string): void {
		this.store.setState((state) => ({ changed: { ...state.changed, [path]: (state.changed[path] ?? 0) + 1 } }), true);
	}

	clear(path: string): void {
		this.store.setState((state) => {
			if (!(path in state.changed)) return state;
			const changed = { ...state.changed };
			delete changed[path];
			return { changed };
		}, true);
	}

	dispose(): void {
		this.store.setState({ changed: {} }, true);
	}
}

export const IFileEventsService = createServiceId<FileEventsService>("FileEventsService");
