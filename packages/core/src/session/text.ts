function imageText(block: { readonly attachment?: { readonly attachmentId?: unknown } }): string {
	const id = block.attachment?.attachmentId;
	return typeof id === "string" ? `[image ${id}]` : "[image]";
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (block === null || typeof block !== "object") return "";
			const value = block as { type?: unknown; text?: unknown };
			if (value.type === "text") return String(value.text ?? "");
			if (value.type === "image") return imageText(block as { attachment?: { attachmentId?: unknown } });
			return "";
		})
		.join("");
}
