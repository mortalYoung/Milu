import {
	AlarmClock,
	ArrowDown,
	ArrowUp,
	ArrowUpFromLine,
	Check,
	ChevronDown,
	ChevronRight,
	CircleStop,
	Copy,
	CopyPlus,
	EllipsisVertical,
	FileText,
	Folder,
	FolderTree,
	GitFork,
	Info,
	type LucideIcon,
	PanelLeft,
	PanelLeftClose,
	PanelLeftOpen,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings as SettingsIcon,
	Square,
	SquarePen,
	Terminal,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

function sized(icon: LucideIcon, fallback = 14) {
	const Icon = icon;
	return (props: { size?: number; className?: string }) => <Icon size={props.size ?? fallback} className={props.className} />;
}

export const SearchIcon = sized(Search);
export const PanelLeftCloseIcon = sized(PanelLeftClose);
export const PanelLeftIcon = sized(PanelLeft);
export const PanelLeftOpenIcon = sized(PanelLeftOpen);
export const ChevronRightIcon = sized(ChevronRight);
export const ChevronDownIcon = sized(ChevronDown);
export const FolderTreeIcon = sized(FolderTree);
export const FileTextIcon = sized(FileText);
export const MoreVerticalIcon = sized(EllipsisVertical);
export const CheckIcon = sized(Check);
export const ArrowDownIcon = sized(ArrowDown);
export const CircleStopIcon = sized(CircleStop);
export const CopyIcon = sized(Copy);
export const CopyPlusIcon = sized(CopyPlus);
export const GitForkIcon = sized(GitFork);
export const ArrowUpFromLineIcon = sized(ArrowUpFromLine);
export const PinIcon = sized(Pin);
export const PinOffIcon = sized(PinOff);
export const InfoIcon = sized(Info);
export const FolderIcon = sized(Folder);
export const TrashIcon = sized(Trash2);
export const PlusIcon = sized(Plus);
export const SquareIcon = sized(Square);
export const ArrowUpIcon = sized(ArrowUp);
export const SquarePenIcon = sized(SquarePen);
export const AlarmClockIcon = sized(AlarmClock);
export const TerminalIcon = sized(Terminal);

const NAMED: Record<string, (props: { size?: number; className?: string }) => ReactNode> = {
	info: InfoIcon,
	folder: FolderIcon,
	"square-pen": SquarePenIcon,
	settings: SettingsIcon,
	trash: TrashIcon,
	pin: PinIcon,
	"pin-off": PinOffIcon,
	"folder-tree": FolderTreeIcon,
	"file-text": FileTextIcon,
	copy: CopyIcon,
	"copy-plus": CopyPlusIcon,
	"git-fork": GitForkIcon,
	"arrow-up-from-line": ArrowUpFromLineIcon,
	"alarm-clock": AlarmClockIcon,
	terminal: TerminalIcon,
};

export function IconByName(props: { name?: string; size?: number; className?: string }) {
	const Icon = props.name ? NAMED[props.name] : undefined;
	return Icon ? <Icon size={props.size} className={props.className} /> : null;
}
