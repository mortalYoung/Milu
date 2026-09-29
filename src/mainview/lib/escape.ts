import { useEffect, useRef } from "react";

export interface EscapeLayer {
	id: string;
	order: number;
	isOpen: () => boolean;
	close: () => void;
}

export const ESCAPE_ORDER = {
	palette: 90,
	composerMenu: 85,
	meter: 83,
	trajectoryRow: 82,
	trajectory: 80,
	floatFind: 79,
	readerFind: 78,
	readerSelection: 77,
	dockList: 76,
	dockDetail: 75,
	dock: 70,
} as const;

const published = new Map<string, EscapeLayer>();

export function useEscapeLayer(layer: EscapeLayer) {
	const latest = useRef(layer);
	latest.current = layer;
	const id = layer.id;

	useEffect(() => {
		const entry: EscapeLayer = {
			id,
			order: latest.current.order,
			isOpen: () => latest.current.isOpen(),
			close: () => latest.current.close(),
		};
		published.set(id, entry);
		return () => {
			if (published.get(id) === entry) published.delete(id);
		};
	}, [id]);
}

function openEscapeLayers(app: EscapeLayer[]): EscapeLayer[] {
	return [...app, ...published.values()].filter((layer) => layer.isOpen()).sort((a, b) => b.order - a.order);
}

export function escapeTop(app: EscapeLayer[]): boolean {
	const [top] = openEscapeLayers(app);
	if (!top) return false;
	top.close();
	return true;
}
