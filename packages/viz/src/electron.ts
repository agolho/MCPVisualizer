// Bridge to Electron preload — undefined when running in a plain browser (Vite dev / CI).
export interface ElectronBridge {
  selectFolder(): Promise<string | null>;
  importProjectDialog(): Promise<string | null>;
  exportProjectDialog(args: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean; path?: string }>;
  openPath(p: string): Promise<void>;
  appVersion(): Promise<string>;
  onUpdateEvent(cb: (evt: UpdateEvent) => void): () => void;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): Promise<void>;
}

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "error"; message: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string };

declare global {
  interface Window {
    mcpviz?: ElectronBridge;
  }
}

export function getBridge(): ElectronBridge | null {
  return typeof window !== "undefined" && window.mcpviz ? window.mcpviz : null;
}
