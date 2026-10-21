import {
	ArrowDown,
	ArrowUp,
	Check,
	ChevronDown,
	ChevronRight,
	CircleStop,
	Copy,
	EllipsisVertical,
	Folder,
	FolderTree,
	Info,
	type LucideIcon,
	PanelLeft,
	PanelLeftClose,
	PanelLeftOpen,
	Pin,
	PinOff,
	Plus,
	Search,
	Square,
	SquarePen,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

function sized(icon: LucideIcon, fallback = 14) {
	const Icon = icon;
	return (props: { size?: number }) => <Icon size={props.size ?? fallback} />;
}

export const SearchIcon = sized(Search);
export const PanelLeftCloseIcon = sized(PanelLeftClose);
export const PanelLeftIcon = sized(PanelLeft);
export const PanelLeftOpenIcon = sized(PanelLeftOpen);
export const ChevronRightIcon = sized(ChevronRight);
export const ChevronDownIcon = sized(ChevronDown);
export const FolderTreeIcon = sized(FolderTree);
export const MoreVerticalIcon = sized(EllipsisVertical);
export const CheckIcon = sized(Check);
export const ArrowDownIcon = sized(ArrowDown);
export const CircleStopIcon = sized(CircleStop);
export const CopyIcon = sized(Copy);
export const PinIcon = sized(Pin);
export const PinOffIcon = sized(PinOff);
export const InfoIcon = sized(Info);
export const FolderIcon = sized(Folder);
export const TrashIcon = sized(Trash2);
export const PlusIcon = sized(Plus);
export const SquareIcon = sized(Square);
export const ArrowUpIcon = sized(ArrowUp);
export const SquarePenIcon = sized(SquarePen);

const NAMED: Record<string, (props: { size?: number }) => ReactNode> = {
	info: InfoIcon,
	folder: FolderIcon,
	"square-pen": SquarePenIcon,
	trash: TrashIcon,
	pin: PinIcon,
	"pin-off": PinOffIcon,
	copy: CopyIcon,
};

export function IconByName(props: { name?: string; size?: number }) {
	const Icon = props.name ? NAMED[props.name] : undefined;
	return Icon ? <Icon size={props.size} /> : null;
}
