import { describe, expect, test } from "bun:test";
import { activeSurface, nearestSurface, registerSurfaceRoot } from "../lib/active-surface";
import { SURFACE } from "../lib/surfaces";
import { asElement, documentEvents, documentStub, fakeElement } from "./document-stub";

describe("nearestSurface", () => {
	test("walks up to the nearest registered root", () => {
		const root = fakeElement();
		const leaf = fakeElement(fakeElement(root));
		const off = registerSurfaceRoot(asElement(root), SURFACE.reader);

		expect(nearestSurface(asElement(leaf))).toBe(SURFACE.reader);
		off();
		expect(nearestSurface(asElement(leaf))).toBeNull();
	});

	test("nested roots resolve to the innermost", () => {
		const outer = fakeElement();
		const inner = fakeElement(outer);
		const leaf = fakeElement(inner);
		const offOuter = registerSurfaceRoot(asElement(outer), SURFACE.reader);
		const offInner = registerSurfaceRoot(asElement(inner), SURFACE.transcript);

		expect(nearestSurface(asElement(leaf))).toBe(SURFACE.transcript);
		expect(nearestSurface(asElement(inner))).toBe(SURFACE.transcript);
		expect(nearestSurface(asElement(outer))).toBe(SURFACE.reader);
		offInner();
		offOuter();
	});

	test("no registered root above → null", () => {
		expect(nearestSurface(asElement(fakeElement()))).toBeNull();
		expect(nearestSurface(null)).toBeNull();
	});
});

describe("activeSurface", () => {
	test("focus wins: the surface around document.activeElement", () => {
		const root = fakeElement();
		const off = registerSurfaceRoot(asElement(root), SURFACE.reader);
		documentStub.activeElement = asElement(fakeElement(root));

		expect(activeSurface()).toBe(SURFACE.reader);
		off();
	});

	test("focus in an unregistered input passes, without falling back to the last pointerdown", () => {
		const root = fakeElement();
		const off = registerSurfaceRoot(asElement(root), SURFACE.transcript);
		documentEvents["pointerdown"]?.({ target: asElement(fakeElement(root)) });

		documentStub.activeElement = asElement(fakeElement());
		expect(activeSurface()).toBeNull();
		off();
	});

	test("body gives no answer → the last pointerdown decides", () => {
		const root = fakeElement();
		const off = registerSurfaceRoot(asElement(root), SURFACE.transcript);

		documentStub.activeElement = documentStub.body;
		expect(activeSurface()).toBeNull();

		documentEvents["pointerdown"]?.({ target: asElement(fakeElement(root)) });
		expect(activeSurface()).toBe(SURFACE.transcript);

		documentEvents["pointerdown"]?.({ target: asElement(fakeElement()) });
		expect(activeSurface()).toBeNull();
		off();
	});
});
