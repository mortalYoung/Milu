import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class name merge: clsx + tailwind-merge (conflicting classes — the later one wins). */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
