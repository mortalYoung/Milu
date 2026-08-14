/**
 * Composer — 输入区(IM 交互,参考飞书):
 * 圆角输入框,有内容时出现发送按钮;运行中变为停止按钮。
 */
import { ArrowUp, Square } from "lucide-solid";
import { createSignal, type JSX } from "solid-js";
import { Button } from "./Button";

export function Composer(props: { busy: () => boolean; onSend: (text: string) => void; onStop: () => void }) {
	const [text, setText] = createSignal("");

	const send = () => {
		const value = text().trim();
		if (!value) return;
		setText("");
		props.onSend(value);
	};

	// Enter 发送(忙时排队);按钮:有内容发送 / 运行中停止
	const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
		e.preventDefault();
		send();
	};

	const showSend = () => text().trim() !== "" || props.busy();

	return (
		<form class="composer" id="composer" onSubmit={submit}>
			<div class="composer-field">
				<input
					id="prompt-input"
					value={text()}
					onInput={(e) => setText(e.currentTarget.value)}
					class="composer-input"
					type="text"
					placeholder="Type a message…"
					autocomplete="off"
					spellcheck={false}
				/>
				{showSend() && (
					<Button
						variant={props.busy() ? "outline" : "seal"}
						class="size-[34px] p-0 rounded-full"
						title={props.busy() ? "Stop" : "Send"}
						icon={props.busy() ? <Square size={14} /> : <ArrowUp size={14} />}
						onClick={() => (props.busy() ? props.onStop() : send())}
					/>
				)}
			</div>
		</form>
	);
}
