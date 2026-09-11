import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  Tray,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { HostService, decodeConnection } from "../host/service";
import { encodeConnection, remoteAddress } from "../shared/pairing";
import { ClientConnection } from "./connection";
import { enableNetworkAccess, networkAccessEnabled } from "./firewall";
import type { HostSettings, AppEvent, HostStatus } from "../shared/types";
import { saveState } from "../host/state";

const role =
  process.argv.includes("--role=host") ||
  app.getName().toLowerCase().includes("host")
    ? "host"
    : "client";
app.setName(role === "host" ? "AgentView Host" : "AgentView");
app.setAppUserModelId(`labs.hardline.agentview.${role}`);
app.setPath(
  "userData",
  process.env.AGENTVIEW_DATA_DIR ||
    path.join(
      app.getPath("appData"),
      role === "host" ? "Hardline AgentView Host" : "Hardline AgentView",
    ),
);
const dataDir = app.getPath("userData");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let host: HostService | null = null;
  let hostError = "";
  let quitting = false;
  let cleaningUp = false;
  let changing = false;
  const remember = async (config: import("../shared/types").Connection) => {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows secure storage is unavailable.");
    await fs.writeFile(
      path.join(dataDir, "connection.bin"),
      safeStorage.encryptString(encodeConnection(config)),
    );
  };
  const client = new ClientConnection(remember);
  let settings: HostSettings = {
    vaultPath: path.join(os.homedir(), "Desktop", "hardline labs vault"),
    codexPath: "",
    port: 43120,
    autoStart: false,
  };
  const emit = (event: AppEvent) => {
    if (window && !window.isDestroyed())
      window.webContents.send("agentview:event", event);
  };
  const hostStatus = (): HostStatus =>
    host?.status() || {
      running: false,
      settings,
      error: hostError,
      addresses: [],
      pairingCode: "",
      clients: 0,
      notes: 0,
      agentReady: false,
    };
  const health = () =>
    role === "host"
      ? saveState(path.join(dataDir, "health.json"), {
          version: app.getVersion(),
          pid: process.pid,
          running: Boolean(host?.status().running),
          agentReady: Boolean(host?.codex.ready),
          intentionalQuit: quitting,
          checkedAt: Date.now(),
        }).catch(() => {})
      : Promise.resolve();
  async function startHost() {
    if (changing) throw new Error("Host setup is already in progress.");
    changing = true;
    try {
      if (host) await host.stop();
      host = null;
      hostError = "";
      const next = new HostService(settings, dataDir);
      host = next;
      next.on("status", () => {
        emit({ type: "hostStatus", status: hostStatus() });
        void health();
      });
      await next.start();
    } catch (e: any) {
      hostError = e.message;
      await host?.stop().catch(() => {});
      host = null;
    } finally {
      changing = false;
      emit({ type: "hostStatus", status: hostStatus() });
    }
  }
  function showWindow() {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      width: role === "host" ? 620 : 1500,
      height: role === "host" ? 840 : 940,
      minWidth: role === "host" ? 540 : 940,
      minHeight: 650,
      backgroundColor: "#0b1014",
      icon: path.join(__dirname, "../../assets/icon.png"),
      frame: false,
      show: false,
      title: app.getName(),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: role !== "host",
        additionalArguments: [`--agentview-role=${role}`],
      },
    });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      if (!process.argv.includes("--hidden")) window?.show();
    });
    window.on("close", (e) => {
      if (role === "host" && !quitting) {
        e.preventDefault();
        window?.hide();
      }
    });
    window.on("closed", () => {
      window = null;
    });
    const dev = process.env.AGENTVIEW_DEV_URL;
    if (dev) void window.loadURL(dev);
    else void window.loadFile(path.join(__dirname, "../ui/index.html"));
  }
  function createTray() {
    // A tiny inline PNG is replaced by the product icon when packaged.
    const iconPath = path.join(__dirname, "../../assets/icon.png");
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty())
      icon = nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      );
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.setToolTip("AgentView Host");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open AgentView Host", click: showWindow },
        {
          label: "Copy connection key",
          click: () => clipboard.writeText(hostStatus().pairingCode),
        },
        { type: "separator" },
        { label: "Quit host", click: () => app.quit() },
      ]),
    );
    tray.on("double-click", showWindow);
  }
  client.on("event", emit);
  app.on("second-instance", (_event, args) => {
    if (!args.includes("--hidden")) showWindow();
  });
  ipcMain.on("agentview:window", (_event, action) => {
    if (action === "minimize") window?.minimize();
    if (action === "maximize") {
      if (window?.isMaximized()) window.unmaximize();
      else window?.maximize();
    }
    if (action === "close") window?.close();
  });
  ipcMain.handle(
    "agentview:invoke",
    async (_event, method: string, params: any = {}) => {
      if (method === "app.info") return { role, version: app.getVersion() };
      if (method === "clipboard.write") {
        clipboard.writeText(String(params.text || ""));
        return {};
      }
      if (role === "host") {
        if (host?.features.supports(method)) return host.handle(method, params);
        if (method === "host.stopRuntime") {
          if (!host?.codex.persistent)
            throw new Error("No independent runtime is running.");
          await host.codex.rpc("runtime/shutdown");
          return {};
        }
        if (method === "host.networkStatus")
          return networkAccessEnabled(settings.port);
        if (method === "host.networkAllow") {
          await enableNetworkAccess(settings.port);
          return true;
        }
        if (method === "host.status") return hostStatus();
        if (method === "host.invite")
          return host?.createInvitation(String(params.name || "New device"));
        if (method === "host.revoke") {
          await host?.revokeDevice(String(params.id));
          return hostStatus();
        }
        if (method === "host.copy") {
          clipboard.writeText(hostStatus().pairingCode);
          return {};
        }
        if (method === "host.folder") {
          const result = await dialog.showOpenDialog(window!, {
            properties: ["openDirectory"],
          });
          return result.filePaths[0];
        }
        if (method === "host.codex") {
          const result = await dialog.showOpenDialog(window!, {
            properties: ["openFile"],
            filters: [{ name: "Codex", extensions: ["exe"] }],
          });
          return result.filePaths[0];
        }
        if (method === "host.save") {
          if (
            !Number.isInteger(params.port) ||
            params.port < 1024 ||
            params.port > 65535
          )
            throw new Error("Choose a port between 1024 and 65535.");
          const stat = await fs.stat(params.vaultPath).catch(() => null);
          if (!stat?.isDirectory())
            throw new Error("Choose an existing vault folder.");
          settings = {
            vaultPath: path.resolve(params.vaultPath),
            codexPath: String(params.codexPath || ""),
            port: params.port,
            autoStart: Boolean(params.autoStart),
            remoteAddress: remoteAddress(String(params.remoteAddress || "")),
            cloudflaredPath: settings.cloudflaredPath,
            tunnelConfig: settings.tunnelConfig,
          };
          await fs.writeFile(
            path.join(dataDir, "settings.json"),
            JSON.stringify(settings, null, 2),
          );
          const startupPath =
            process.env.PORTABLE_EXECUTABLE_FILE || app.getPath("exe");
          app.setLoginItemSettings({
            openAtLogin: settings.autoStart,
            path: startupPath,
            args: ["--role=host", "--hidden"],
          });
          await startHost();
          return hostStatus();
        }
        if (method === "host.restart") {
          await startHost();
          return hostStatus();
        }
        throw new Error("Unknown host action.");
      }
      if (method === "connection.load") {
        if (client.connected && client.snapshot)
          return {
            connected: true,
            snapshot: client.snapshot,
            route: client.route,
          };
        try {
          const encrypted = await fs.readFile(
            path.join(dataDir, "connection.bin"),
          );
          if (safeStorage.isEncryptionAvailable()) {
            const config = decodeConnection(
              safeStorage.decryptString(encrypted),
            );
            client.connect(config);
            return { connecting: true };
          }
        } catch {
          /* First connection. */
        }
        return {};
      }
      if (method === "connection.connect") {
        const config = decodeConnection(params.code);
        config.routePreference = ["auto", "local", "remote"].includes(
          params.routePreference,
        )
          ? params.routePreference
          : "auto";
        if (params.address?.trim()) {
          const address = params.address.trim();
          config.address = address.startsWith("wss://")
            ? address
            : `wss://${address}`;
          const url = new URL(config.address);
          if (url.protocol !== "wss:")
            throw new Error("Use a host address with wss://.");
        }
        client.connect(config);
        // Invitations are replaced by a device credential only after the host proves its identity.
        if (config.kind === "device") await remember(config);
        return {};
      }
      if (method === "connection.disconnect") {
        client.disconnect();
        await fs.rm(path.join(dataDir, "connection.bin"), { force: true });
        emit({ type: "connection", state: "disconnected" });
        return {};
      }
      if (method === "clipboard.write") {
        clipboard.writeText(String(params.text));
        return {};
      }
      return client.request(method, params);
    },
  );
  app.whenReady().then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    if (role === "host") {
      try {
        settings = {
          ...settings,
          ...JSON.parse(
            await fs.readFile(path.join(dataDir, "settings.json"), "utf8"),
          ),
        };
      } catch {
        /* Defaults. */
      }
      createTray();
    }
    showWindow();
    if (role === "host") void startHost();
    if (role === "host") setInterval(() => void health(), 5000).unref();
  });
  app.on("window-all-closed", () => {
    if (role !== "host") app.quit();
  });
  app.on("before-quit", (event) => {
    if (host) {
      event.preventDefault();
      if (cleaningUp) return;
      cleaningUp = true;
      quitting = true;
      void host.stop().finally(async () => {
        await health();
        host = null;
        app.quit();
      });
    } else {
      client.disconnect();
      tray?.destroy();
    }
  });
}
