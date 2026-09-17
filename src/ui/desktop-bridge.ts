import type { AppEvent, DesktopBridge } from "../shared/types";
import {
  clearClientState,
  restoreClientState,
  setClientPersistence,
  recoverRequests,
  requestWithReceipt,
  assertClientReadyForUpdate,
  saveDrafts,
} from "./client-state";

let pendingRequests = 0;
export async function prepareDesktopUpdate() {
  assertClientReadyForUpdate();
  if (pendingRequests)
    throw new Error(
      "A workspace request is still finishing. Try Update UI again in a moment.",
    );
  await saveDrafts();
}

// Native transport stays in Electron; the renderer shares the same durable
// drafts and receipt protocol as the web client, without receiving credentials.
export function desktopBridge(native: DesktopBridge): DesktopBridge {
  if (native.role !== "client") return native;
  setClientPersistence(async (state) => {
    await native.invoke("client.state.save", { state });
  });
  let ready = false;
  let supported = false;
  let loading: Promise<any> | undefined;
  const listeners = new Set<(event: AppEvent) => void>();
  const emit = (event: AppEvent) => {
    for (const listener of listeners) listener(event);
  };
  native.onEvent((event) => {
    if (event.type === "snapshot") {
      supported = Boolean(event.snapshot.capabilities?.apiVersion);
      if (ready && supported) void recoverRequests(native.invoke, emit);
    }
    emit(event);
  });
  return {
    role: native.role,
    window: native.window,
    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async invoke(method, params = {}) {
      pendingRequests++;
      try {
        if (method === "connection.load") {
          return await (loading ||= (async () => {
            const result = await native.invoke(method, params);
            const selectedThread = restoreClientState(
              result.hostId || "",
              result.clientState,
            );
            ready = true;
            supported ||= Boolean(result.snapshot?.capabilities?.apiVersion);
            if (supported) void recoverRequests(native.invoke, emit);
            return { ...result, selectedThread };
          })());
        }
        if (
          method === "connection.connect" ||
          method === "connection.disconnect"
        ) {
          ready = false;
          await clearClientState();
          const result = await native.invoke(method, params);
          restoreClientState(result.hostId || "");
          ready = true;
          loading = undefined;
          return result;
        }
        return await requestWithReceipt(
          native.invoke,
          method,
          params,
          supported,
        );
      } finally {
        pendingRequests--;
      }
    },
  };
}
