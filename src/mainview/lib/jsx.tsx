import { Fragment, type Key, type ReactNode } from "react";

export type Accessor<T> = () => T;

export function Show<T>(props: { when: T | null | undefined | false; fallback?: ReactNode; children: ReactNode | ((value: Accessor<NonNullable<T>>) => ReactNode) }) {
	const value = props.when;
	if (!value) return <>{props.fallback ?? null}</>;
	const children = props.children;
	if (typeof children === "function") return <>{children(() => value as NonNullable<T>)}</>;
	return <>{children}</>;
}

export function For<T>(props: { each: readonly T[]; by?: (item: T, index: number) => Key; children: (item: T, index: Accessor<number>) => ReactNode }) {
	const { each, by, children } = props;
	if (each.length === 0) return null;
	return (
		<>
			{each.map((item, index) => (
				<Fragment key={by ? by(item, index) : index}>{children(item, () => index)}</Fragment>
			))}
		</>
	);
}

export function Index<T>(props: { each: readonly T[]; children: (item: Accessor<T>, index: number) => ReactNode }) {
	const { each, children } = props;
	if (each.length === 0) return null;
	return (
		<>
			{each.map((_, index) => (
				<Fragment key={index}>{children(() => each[index] as T, index)}</Fragment>
			))}
		</>
	);
}
