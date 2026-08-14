import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 类名合并:clsx + tailwind-merge(冲突类后到者胜)。 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
