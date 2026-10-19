/** Copy text, falling back to the old selection trick when the async clipboard is unavailable. */
export async function copyPath(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		return;
	} catch {
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.append(area);
		area.select();
		document.execCommand("copy");
		area.remove();
	}
}
