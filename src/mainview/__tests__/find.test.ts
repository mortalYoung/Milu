import { describe, expect, test } from "bun:test";
import { registerSurfaceRoot } from "../lib/active-surface";
import { dispatchFind, registerFindHandler } from "../lib/find";
import { SURFACE } from "../lib/surfaces";
import { asElement, documentStub, fakeElement } from "./document-stub";

function attentionOn(surface: (typeof SURFACE)[keyof typeof SURFACE]): () => void {
	const root = fakeElement();
	const off = registerSurfaceRoot(asElement(root), surface);
	documentStub.activeElement = asElement(fakeElement(root));
	return () => {
		documentStub.activeElement = documentStub.body;
		off();
	};
}

describe("find router", () => {
	test("dispatch calls the handler of the surface holding attention", () => {
		const release = attentionOn(SURFACE.reader);
		let calls = 0;
		const unregister = registerFindHandler(SURFACE.reader, () => {
			calls += 1;
			return true;
		});

		expect(dispatchFind()).toBe(true);
		expect(calls).toBe(1);
		unregister();
		release();
	});

	test("a surface with no handler passes the key through", () => {
		const release = attentionOn(SURFACE.diff);
		expect(dispatchFind()).toBe(false);
		release();
	});

	test("a handler that declines passes the key through", () => {
		const release = attentionOn(SURFACE.transcript);
		const unregister = registerFindHandler(SURFACE.transcript, () => false);

		expect(dispatchFind()).toBe(false);
		unregister();
		release();
	});

	test("attention only reaches its own surface", () => {
		const release = attentionOn(SURFACE.transcript);
		let called = false;
		const unregister = registerFindHandler(SURFACE.reader, () => {
			called = true;
			return true;
		});

		expect(dispatchFind()).toBe(false);
		expect(called).toBe(false);
		unregister();
		release();
	});

	test("unregistering stops the dispatch", () => {
		const release = attentionOn(SURFACE.settings);
		const unregister = registerFindHandler(SURFACE.settings, () => true);
		expect(dispatchFind()).toBe(true);

		unregister();
		expect(dispatchFind()).toBe(false);
		release();
	});

	test("re-registering an id keeps the last handler, and its cleanup leaves it alone", () => {
		const release = attentionOn(SURFACE.taskLog);
		const unregisterFirst = registerFindHandler(SURFACE.taskLog, () => false);
		const unregisterSecond = registerFindHandler(SURFACE.taskLog, () => true);

		expect(dispatchFind()).toBe(true);
		unregisterFirst();
		expect(dispatchFind()).toBe(true);
		unregisterSecond();
		expect(dispatchFind()).toBe(false);
		release();
	});

	test("no attention at all → false", () => {
		documentStub.activeElement = documentStub.body;
		expect(dispatchFind()).toBe(false);
	});
});
