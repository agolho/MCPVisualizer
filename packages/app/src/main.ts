import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface ServeResult {
  port: number;
  close: () => Promise<void>;
}
interface IngesterModule {
  serve(opts: {
    dataDir: string;
    port: number;
    staticDir?: string;
    onListening?: (port: number) => void;
  }): Promise<ServeResult>;
}

const IS_DEV = !!process.env.MCPVIZ_DEV;
const VITE_URL = process.env.MCPVIZ_VITE_URL ?? "http://localhost:5173";

// Ingester + viz are copied into packages/app/dist/{ingester,viz} during build,
// so they live next to this file at runtime — in dev and in the packaged asar.
async function loadIngester(): Promise<IngesterModule> {
  const candidates = [
    path.join(__dirname, "ingester", "server.js"),
    // Dev fallback when running directly from source via tsx.
    path.join(__dirname, "..", "..", "ingester", "dist", "server.js"),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return (await import(pathToFileURL(c).href)) as IngesterModule;
    } catch {
      // try next
    }
  }
  throw new Error(
    `could not locate ingester server.js (searched: ${candidates.join(" | ")})`
  );
}

function resolveStaticDir(): string | undefined {
  const candidates = [
    path.join(__dirname, "viz"),
    path.join(__dirname, "..", "..", "viz", "dist"),
  ];
  for (const c of candidates) {
    try {
      require("node:fs").accessSync(c);
      return c;
    } catch {
      // skip
    }
  }
  return undefined;
}

let mainWindow: BrowserWindow | null = null;
let serverPort = 0;
let serverClose: (() => Promise<void>) | null = null;

async function startServer(): Promise<number> {
  const { serve } = await loadIngester();
  const dataDir = app.getPath("userData");
  const staticDir = IS_DEV ? undefined : resolveStaticDir();
  console.log("[mcpviz] dataDir:", dataDir);
  console.log("[mcpviz] staticDir:", staticDir ?? "(none — dev mode)");
  const s = await serve({ dataDir, port: 0, staticDir });
  serverClose = s.close;
  return s.port;
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0d10",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());

  const url = IS_DEV ? VITE_URL : `http://localhost:${serverPort}`;
  await win.loadURL(url);
}

// ----- IPC: native dialogs + misc -----

ipcMain.handle("mcpviz:selectFolder", async () => {
  const res = await dialog.showOpenDialog({
    title: "Select project folder",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle("mcpviz:importProjectDialog", async () => {
  const res = await dialog.showOpenDialog({
    title: "Import .mcpviz project",
    properties: ["openFile"],
    filters: [
      { name: "MCPVisualizer project", extensions: ["mcpviz", "json"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle(
  "mcpviz:exportProjectDialog",
  async (_e, args: { suggestedName: string; content: string }) => {
    const res = await dialog.showSaveDialog({
      title: "Export project",
      defaultPath: args.suggestedName,
      filters: [{ name: "MCPVisualizer project", extensions: ["mcpviz"] }],
    });
    if (res.canceled || !res.filePath) return { saved: false };
    await fs.writeFile(res.filePath, args.content, "utf8");
    return { saved: true, path: res.filePath };
  }
);

ipcMain.handle("mcpviz:openPath", async (_e, p: string) => {
  await shell.openPath(p);
});

ipcMain.handle("mcpviz:appVersion", () => app.getVersion());
ipcMain.handle("mcpviz:serverPort", () => serverPort);

// ----- Auto-update -----

type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "error"; message: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string };

// electron-updater exports `autoUpdater` as a singleton. We lazy-import so dev mode
// doesn't require it to be installed on platforms we don't build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autoUpdater: any = null;

function send(evt: UpdateEvent) {
  mainWindow?.webContents.send("mcpviz:updateEvent", evt);
}

async function initAutoUpdater(): Promise<void> {
  if (IS_DEV) return;
  try {
    const mod = await import("electron-updater");
    autoUpdater = mod.autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
    autoUpdater.on("update-available", (info: { version: string }) =>
      send({ type: "available", version: info.version })
    );
    autoUpdater.on("update-not-available", () => send({ type: "not-available" }));
    autoUpdater.on("error", (err: Error) => send({ type: "error", message: err.message }));
    autoUpdater.on("download-progress", (p: { percent: number }) =>
      send({ type: "downloading", percent: p.percent })
    );
    autoUpdater.on("update-downloaded", (info: { version: string }) =>
      send({ type: "downloaded", version: info.version })
    );
  } catch (e) {
    console.warn("[mcpviz] auto-updater unavailable:", (e as Error).message);
  }
}

ipcMain.handle("mcpviz:checkForUpdates", async () => {
  if (!autoUpdater) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    send({ type: "error", message: (e as Error).message });
  }
});

ipcMain.handle("mcpviz:quitAndInstall", () => {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall();
});

// ----- Lifecycle -----

app.on("window-all-closed", async () => {
  if (serverClose) await serverClose().catch(() => {});
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(async () => {
  serverPort = await startServer();
  await createWindow();
  await initAutoUpdater();
  if (!IS_DEV && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
