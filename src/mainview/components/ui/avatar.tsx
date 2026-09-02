/** Round initial avatar shared by the chat list and notifications. */
export interface AvatarProps {
	name: string;
	variant?: "ink" | "paper";
	size?: "md" | "sm";
	class?: string;
}

export function Avatar(props: AvatarProps) {
	return (
		<span
			class={
				"conv-avatar select-none " +
				(props.variant === "paper" ? "avatar-paper" : "avatar-ink") +
				(props.size === "sm" ? " avatar-sm" : "") +
				(props.class ? ` ${props.class}` : "")
			}
		>
			<span class="avatar-initial">{props.name.charAt(0)}</span>
		</span>
	);
}
