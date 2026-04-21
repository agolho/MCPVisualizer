import { contextBridge, ipcRenderer } from "electron";

type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "error"; message: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string };

contextBridge.exposeInMainWorld("mcpviz", {
  selectFolder: () => ipcRenderer.invoke("mcpviz:selectFolder") as Promise<string | null>,
  importProjectDialog: () =>
    ipcRenderer.invoke("mcpviz:importProjectDialog") as Promise<string | null>,
  exportProjectDialog: (args: { suggestedName: string; content: string }) =>
    ipcRenderer.invoke("mcpviz:exportProjectDialog", args) as Promise<{
      saved: boolean;
      path?: string;
    }>,
  openPath: (p: string) => ipcRenderer.invoke("mcpviz:openPath", p) as Promise<void>,
  appVersion: () => ipcRenderer.invoke("mcpviz:appVersion") as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke("mcpviz:checkForUpdates") as Promise<void>,
  quitAndInstall: () => ipcRenderer.invoke("mcpviz:quitAndInstall") as Promise<void>,
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => {
    const listener = (_e: unknown, evt: UpdateEvent) => cb(evt);
    ipcRenderer.on("mcpviz:updateEvent", listener);
    return () => ipcRenderer.removeListener("mcpviz:updateEvent", listener);
  },
});
