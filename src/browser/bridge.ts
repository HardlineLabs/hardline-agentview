import { WorkspaceConnection, type Dial } from "../shared/client";
import {
  decodeConnection,
  encodeConnection,
  remoteAddress,
} from "../shared/pairing";
import type { AppEvent, Connection, DesktopBridge } from "../shared/types";
import { loadPrivate, removePrivate, savePrivate } from "./storage";
import { claimPairingCode, sixDigitCode } from "../shared/pairing-code";

import {
  drafts as browserDrafts,
  saveDrafts,
  restoreClientState,
  clearClientState,
  setClientPersistence,
  recoverRequests,
  requestWithReceipt,
} from "../ui/client-state";
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
  await saveDrafts(selectedThread);
}
type Resume = {
  hostId: string;
  selectedThread?: string;
  drafts: [string, string][];
  savedAt: number;
};
export function browserBridge(): DesktopBridge {
  setClientPersistence((state) => savePrivate("drafts", state));
  const listeners = new Set<(event: AppEvent) => void>();
  const emit = (event: AppEvent) => {
    if (event.type === "snapshot" && event.snapshot?.capabilities?.apiVersion)
      void reconcile();
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
  let restored = false;
  const client = new WorkspaceConnection(dial, emit, async (config) => {
    await savePrivate("connection", encodeConnection(config));
    paired = config;
    // Retain drafts on reconnect; initialize only after first pairing.
    if (!restored) {
      restoreClientState(config.hostId);
      restored = true;
    }
    await removePrivate("pairingClaim");
  });
  const reconcile = () =>
    recoverRequests((method, params) => client.request(method, params), emit);
  let loading: Promise<unknown> | undefined;
  let generation = 0;
  let connecting = false;
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
          const durable = await loadPrivate<any>("drafts");
          let selectedThread = restoreClientState(paired.hostId, durable);
          restored = true;
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
        if (connecting) return {};
        connecting = true;
        emit({
          type: "connection",
          state: "connecting",
          route: "remote",
          message: "Preparing your connection…",
        });
        try {
          if (!isSecureContext || !crypto.subtle)
            throw new Error("Open AgentView using its HTTPS address.");
          // Test storage before redeeming a one-use code or the host's invitation.
          await savePrivate("pairingProbe", true);
          await removePrivate("pairingProbe");
          const digits = sixDigitCode(String(params.code || ""));
          const previousClaim = digits
            ? await loadPrivate<{ code: string; claimId: string }>(
                "pairingClaim",
              )
            : undefined;
          const claimId =
            previousClaim && previousClaim.code === digits
              ? previousClaim.claimId
              : crypto.randomUUID();
          if (digits)
            await savePrivate("pairingClaim", { code: digits, claimId });
          const config = digits
            ? await claimPairingCode(
                digits,
                claimId,
                new URL("/api/pair", location.origin).href,
              )
            : decodeConnection(params.code);
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
          paired = undefined;
          restored = false;
          client.disconnect();
          await clearClientState();
          await removePrivate("resume");
          await removePrivate("connection");
          await removePrivate("drafts");
          paired = undefined;
          suspended = false;
          client.connect(config);
          return {};
        } finally {
          connecting = false;
        }
      }
      if (method === "connection.disconnect") {
        ++generation;
        restored = false;
        paired = undefined;
        suspended = false;
        loading = undefined;
        client.disconnect();
        await clearClientState();
        await removePrivate("drafts");
        await removePrivate("connection");
        await removePrivate("resume");
        emit({ type: "connection", state: "disconnected" });
        await removePrivate("pairingClaim");
        return {};
      }
      if (method === "clipboard.write") {
        await navigator.clipboard.writeText(String(params.text));
        return {};
      }
      inFlight++;
      try {
        return await requestWithReceipt(
          (method, params) => client.request(method, params),
          method,
          params,
          Boolean(client.snapshot?.capabilities?.apiVersion),
        );
      } finally {
        inFlight--;
      }
    },
  };
}
