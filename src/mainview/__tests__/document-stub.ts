export interface FakeElement {
	parentElement: FakeElement | null;
}

export function fakeElement(parent: FakeElement | null = null): FakeElement {
	return { parentElement: parent };
}

export function asElement(value: FakeElement): Element {
	return value as unknown as Element;
}

export const documentEvents: Record<string, (event: { target: unknown }) => void> = {};

export const documentStub = {
	activeElement: null as Element | null,
	body: { style: {} } as unknown as Element,
	documentElement: { style: {} } as unknown as Element,
	addEventListener: (type: string, handler: (event: { target: unknown }) => void) => {
		documentEvents[type] = handler;
	},
	removeEventListener: () => {},
};

(globalThis as unknown as { document: unknown }).document = documentStub;
