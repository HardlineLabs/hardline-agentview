import { WorkspaceConnection, type Dial } from "../shared/client";
import {
  decodeConnection,
  encodeConnection,
  remoteAddress,
} from "../shared/pairing";
import type { AppEvent, Connection, DesktopBridge } from "../shared/types";
import { loadPrivate, removePrivate, savePrivate } from "./storage";

export const browserDrafts = new Map<string, string>();
let paired: Connection | undefined;
let inFlight = 0;
export async function prepareUpdate(selectedThread?: string) {
  if (inFlight)
    throw new Error("Wait for the current action to finish before updating.");
  if (!paired) return;
  await savePrivate("resume", {
    hostId: paired.hostId,
    selectedThread,
    drafts: [...browserDrafts],
    savedAt: Date.now(),
  });
}
type Resume = {
  hostId: string;
  selectedThread?: string;
  drafts: [string, string][];
  savedAt: number;
};
export function browserBridge(): DesktopBridge {
  const listeners = new Set<(event: AppEvent) => void>();
  const emit = (event: AppEvent) => {
    if (
      event.type === "connection" &&
      event.state === "error" &&
      /removed|expired|identity changed/i.test(event.message || "")
    )
      paired = undefined;
    for (const listener of listeners) listener(event);
  };
  const dial: Dial = (address, fingerprint, handlers) => {
    if (fingerprint)
      throw new Error("Use the host's secure remote endpoint in the web app.");
    const socket = new WebSocket(remoteAddress(address));
    socket.onopen = handlers.open;
    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data.length > 64_000_000) {
        socket.close(1009);
        return;
      }
      handlers.message(event.data);
    };
    socket.onerror = () => handlers.error("Connection unavailable");
    socket.onclose = (event) => handlers.close(event.code, event.reason);
    return {
      send: (text) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
      },
      close: () => socket.close(),
    };
  };
  const client = new WorkspaceConnection(dial, emit, async (config) => {
    await savePrivate("connection", encodeConnection(config));
    paired = config;
  });
  let loading: Promise<unknown> | undefined;
  let generation = 0;
  let suspended = false;
  const suspend = () => {
    if (!paired) return;
    suspended = true;
    client.disconnect();
    if (paired)
      emit({
        type: "connection",
        state: "reconnecting",
        route: "remote",
        message: "Reconnect when you return to your workspace.",
      });
  };
  const resume = () => {
    if (document.visibilityState === "hidden" || !navigator.onLine) return;
    if (suspended && paired) {
      suspended = false;
      client.connect(paired);
    }
  };
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  window.addEventListener("offline", suspend);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", () =>
    document.hidden ? suspend() : resume(),
  );
  return {
    role: "client",
    window: () => {},
    onEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async invoke(method, params = {}) {
      if (method === "connection.load") {
        if (client.connected)
          return { snapshot: client.snapshot, route: client.route };
        return (loading ||= (async () => {
          const current = generation;
          const saved = await loadPrivate<string>("connection");
          const restore = await loadPrivate<Resume>("resume").catch(
            () => undefined,
          );
          await removePrivate("resume");
          if (!saved || current !== generation) return {};
          paired = decodeConnection(saved);
          paired.routePreference = "remote";
          let selectedThread;
          if (
            restore?.hostId === paired.hostId &&
            Date.now() - restore.savedAt < 10 * 60_000
          ) {
            for (const [id, text] of restore.drafts)
              browserDrafts.set(id, text);
            selectedThread = restore.selectedThread;
          }
          client.connect(paired);
          return { selectedThread };
        })());
      }
      if (method === "connection.connect") {
        if (!isSecureContext || !crypto.subtle)
          throw new Error("Open AgentView using its HTTPS address.");
        const config = decodeConnection(params.code);
        config.routePreference = "remote";
        if (params.address?.trim())
          config.remoteAddress = remoteAddress(
            params.address.startsWith("wss://")
              ? params.address
              : "wss://" + params.address,
          );
        if (!config.remoteAddress)
          throw new Error(
            "Enable Remote access in AgentView Host, then create a new pairing invitation. The web app needs a secure remote endpoint.",
          );
        ++generation;
        await removePrivate("resume");
        await removePrivate("connection");
        browserDrafts.clear();
        paired = undefined;
        suspended = false;
        client.connect(config);
        return {};
      }
      if (method === "connection.disconnect") {
        ++generation;
        paired = undefined;
        suspended = false;
        loading = undefined;
        client.disconnect();
        browserDrafts.clear();
        await removePrivate("connection");
        await removePrivate("resume");
        emit({ type: "connection", state: "disconnected" });
        return {};
      }
      if (method === "clipboard.write") {
        await navigator.clipboard.writeText(String(params.text));
        return {};
      }
      inFlight++;
      try {
        return await client.request(method, params);
      } finally {
        inFlight--;
      }
    },
  };
}
