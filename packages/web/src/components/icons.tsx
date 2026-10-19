import type { ReactNode } from "react";

function Icon(props: { size?: number; children: ReactNode; className?: string }) {
	return (
		<svg
			width={props.size ?? 14}
			height={props.size ?? 14}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={props.className}
		>
			{props.children}
		</svg>
	);
}

export function SearchIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</Icon>
	);
}

export function PanelLeftCloseIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18" />
			<path d="m16 15-3-3 3-3" />
		</Icon>
	);
}

export function PanelLeftIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18" />
		</Icon>
	);
}

export function ChevronRightIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<path d="m9 18 6-6-6-6" />
		</Icon>
	);
}

export function ChevronDownIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<path d="m6 9 6 6 6-6" />
		</Icon>
	);
}

export function FolderTreeIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
			<path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2a1 1 0 0 0-.8-.4h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
			<path d="M3 5a2 2 0 0 1 2-2h3" />
			<path d="M3 5v14a2 2 0 0 0 2 2h3" />
		</Icon>
	);
}

export function MoreVerticalIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="1" />
			<circle cx="12" cy="5" r="1" />
			<circle cx="12" cy="19" r="1" />
		</Icon>
	);
}

export function CopyIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</Icon>
	);
}

export function PinIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<path d="M12 17v5" />
			<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
		</Icon>
	);
}

export function PinOffIcon(props: { size?: number }) {
	return (
		<Icon {...props}>
			<path d="M12 17v5" />
			<path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
			<path d="m2 2 20 20" />
			<path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
		</Icon>
	);
}
