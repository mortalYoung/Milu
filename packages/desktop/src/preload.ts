import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("milu", {
	connect: () => ipcRenderer.invoke("milu:connect"),
	request: (method: string, params: unknown) => ipcRenderer.invoke("milu:request", method, params),
	subscribe: (handler: (event: unknown) => void) => {
		const listener = (_event: unknown, message: unknown): void => handler(message);
		ipcRenderer.on("milu:event", listener);
		return () => ipcRenderer.removeListener("milu:event", listener);
	},
});
