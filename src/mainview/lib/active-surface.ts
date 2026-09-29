import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SurfaceId } from "./surfaces";

const roots = new Map<Element, SurfaceId>();
const listeners = new Set<() => void>();
let pointerTarget: Element | null = null;
let installed = false;

function emit(): void {
	for (const listener of listeners) listener();
}

function install(): void {
	if (installed) return;
	installed = true;
	document.addEventListener(
		"pointerdown",
		(event) => {
			pointerTarget = event.target as Element | null;
			emit();
		},
		true,
	);
	document.addEventListener("focusin", emit, true);
}

export function registerSurfaceRoot(element: Element, id: SurfaceId): () => void {
	install();
	roots.set(element, id);
	emit();
	return () => {
		if (roots.get(element) !== id) return;
		roots.delete(element);
		emit();
	};
}

export function nearestSurface(node: Element | null): SurfaceId | null {
	for (let element = node; element; element = element.parentElement) {
		const id = roots.get(element);
		if (id) return id;
	}
	return null;
}

export function activeSurface(): SurfaceId | null {
	const focused = document.activeElement;
	if (focused && focused !== document.body && focused !== document.documentElement) return nearestSurface(focused);
	return nearestSurface(pointerTarget);
}

function subscribe(listener: () => void): () => void {
	install();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useActiveSurface(): SurfaceId | null {
	return useSyncExternalStore(subscribe, activeSurface, () => null);
}

export function useSurfaceRoot<T extends HTMLElement = HTMLElement>(id: SurfaceId) {
	const ref = useRef<T | null>(null);

	useEffect(() => {
		const element = ref.current;
		if (element) return registerSurfaceRoot(element, id);
	}, [id]);

	return ref;
}
