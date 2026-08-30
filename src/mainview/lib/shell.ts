import { createSignal } from "solid-js";
import type { PartnerItem } from "../components/ConversationList";

/** Shell chrome state: which view/dialog/overlay is open right now. */
export function createShell() {
	const [view, setView] = createSignal<"chat" | "skills" | "settings">("chat");
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [showModal, setShowModal] = createSignal(false);
	// Partner details dialog (shared by the list menu / header click)
	const [detailsPartner, setDetailsPartner] = createSignal<PartnerItem | null>(null);
	const [listCollapsed, setListCollapsed] = createSignal(localStorage.getItem("chatlist.collapsed") === "1");

	function toggleList() {
		const next = !listCollapsed();
		setListCollapsed(next);
		localStorage.setItem("chatlist.collapsed", next ? "1" : "0");
	}

	return { view, setView, settingsOpen, setSettingsOpen, showModal, setShowModal, detailsPartner, setDetailsPartner, listCollapsed, toggleList };
}
