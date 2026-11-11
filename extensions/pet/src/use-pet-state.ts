import { api, type Activity, React } from "./runtime.ts";
import type { SpriteState } from "./sheets.ts";
import { stateOf } from "./state.ts";

const GREETING_MS = 1600;
const FAILED_MS = 8000;

function reacting(activity: Activity | null, now: number): boolean {
	if (activity?.error === null || activity?.error === undefined) return false;
	if (activity.errorAt <= 0) return false;
	if (now === 0) return true;
	return now - activity.errorAt < FAILED_MS;
}

export interface PetDriver {
	readonly state: SpriteState;
	readonly frame?: number;
	hover(value: boolean): void;
}

export function usePetState(activity: Activity | null, follow: boolean): PetDriver {
	const [now, setNow] = React.useState(0);
	const base = stateOf({
		running: activity?.running ?? false,
		waiting: activity?.waiting ?? 0,
		error: reacting(activity, now) ? (activity?.error ?? null) : null,
	});
	const motion = api.useWindowMotion();
	const [hovering, setHovering] = React.useState(false);
	const [greeting, setGreeting] = React.useState(true);

	React.useEffect(() => {
		const timer = setTimeout(() => setGreeting(false), GREETING_MS);
		const tick = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			clearTimeout(timer);
			clearInterval(tick);
		};
	}, []);

	const hover = setHovering;
	if (base === "failed" || base === "waiting") return { state: base, hover };
	if (motion.drag !== null) return { state: motion.drag === "left" ? "running-left" : "running-right", hover };
	if (greeting) return { state: "waving", hover };
	if (hovering) return { state: "jumping", hover };
	if (base === "idle" && activity?.unread === true) return { state: "review", hover };
	if (base === "idle" && follow && motion.look !== null) {
		const index = Math.round(motion.look / 22.5) % 16;
		return { state: index < 8 ? "look-000-to-157.5" : "look-180-to-337.5", frame: index % 8, hover };
	}
	return { state: base, hover };
}
