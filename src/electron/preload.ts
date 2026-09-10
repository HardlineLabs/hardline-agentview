import { contextBridge, ipcRenderer } from "electron";
const role = process.argv.includes("--agentview-role=host") ? "host" : "client";
contextBridge.exposeInMainWorld("agentview", {
  role,
  invoke: (method: string, params?: unknown) =>
    ipcRenderer.invoke("agentview:invoke", method, params),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on("agentview:event", listener);
    return () => ipcRenderer.removeListener("agentview:event", listener);
  },
  window: (action: string) => ipcRenderer.send("agentview:window", action),
});
