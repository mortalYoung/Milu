import { api, React } from "./runtime.ts";
import { type PetState, sheetOf } from "./sheets.ts";
import { PetSprite } from "./sprite.tsx";
import { STYLES } from "./styles.ts";
import { usePetState } from "./use-pet-state.ts";

export function PetOverlay() {
	const session = api.useSession();
	const pet = api.useExtensionData<PetState>("state");
	const activity = api.useSessionActivity(session);
	const { state, frame } = usePetState(activity, pet.data?.follow === true);

	if (session === null || pet.data === undefined) return null;
	const { enabled, overlay, chosen, size } = pet.data;
	if (!enabled || !overlay) return null;

	return (
		<div className="milu-ext-pet-overlay">
			<style>{STYLES}</style>
			<PetSprite sheet={sheetOf(chosen)} state={state} frame={frame} size={size} />
		</div>
	);
}

export default PetOverlay;
