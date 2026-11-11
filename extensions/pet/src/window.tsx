import { api, React } from "./runtime.ts";
import { type PetState, sheetOf } from "./sheets.ts";
import { PetSprite } from "./sprite.tsx";
import { STYLES } from "./styles.ts";
import { usePetState } from "./use-pet-state.ts";

interface WindowData {
	readonly pet?: string;
	readonly size?: number;
	readonly session?: string;
}

export default function PetWindow(props: { readonly id: string; readonly data: unknown }) {
	const data = (props.data ?? {}) as WindowData;
	const selected = api.useSession();
	const session = selected === null || selected === "" ? (data.session ?? "") : selected;
	const activity = api.useSessionActivity(session === "" ? null : session);
	const pet = api.useExtensionData<PetState>("state");
	const command = api.useCommand();
	const { state, frame, hover } = usePetState(activity, pet.data?.follow === true);
	const size = data.size ?? 240;

	return (
		<div
			className="milu-ext-pet-root"
			onPointerEnter={() => hover(true)}
			onPointerLeave={() => hover(false)}
			onContextMenu={(event) => {
				event.preventDefault();
				void command("pet.menu").catch(() => undefined);
			}}
		>
			<style>{STYLES}</style>
			<PetSprite sheet={sheetOf(data.pet)} state={state} frame={frame} size={size} />
		</div>
	);
}
