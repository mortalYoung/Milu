import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SwitchPrimitive from "@kobalte/core/switch";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "../../lib/utils";

type SwitchProps<T extends ValidComponent = "button"> = SwitchPrimitive.SwitchRootProps<T> & {
	class?: string | undefined;
};

const Switch = <T extends ValidComponent = "button">(props: PolymorphicProps<T, SwitchProps<T>>) => {
	const [local, others] = splitProps(props as SwitchProps, ["class"]);
	return (
		<SwitchPrimitive.Root
			class={cn(
				"peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-50",
				"border-hairline bg-ink/25 data-[checked]:border-seal data-[checked]:bg-seal",
				local.class,
			)}
			{...others}
		>
			<SwitchPrimitive.Control class="inline-flex h-full w-full items-center justify-start rounded-full">
				<SwitchPrimitive.Thumb class="pointer-events-none block size-4 rounded-full bg-paper shadow-sm transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0.5" />
			</SwitchPrimitive.Control>
		</SwitchPrimitive.Root>
	);
};

export type { SwitchProps };
export { Switch };
