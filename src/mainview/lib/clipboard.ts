export function copyText(text: string) {
	const fallback = () => {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand("copy");
		} catch {
			// execCommand unavailable — nothing else to try
		}
		ta.remove();
	};
	if (navigator.clipboard?.writeText) {
		navigator.clipboard.writeText(text).catch(fallback);
	} else {
		fallback();
	}
}
