import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import { App } from "@capacitor/app";
import { WorkspaceConnection, type Dial } from "../shared/client";
import {
  decodeConnection,
  encodeConnection,
  remoteAddress,
} from "../shared/pairing";
import type { AppEvent, DesktopBridge } from "../shared/types";

interface NativeSocket {
  connect(options: {
    id: string;
    address: string;
    fingerprint?: string;
  }): Promise<void>;
  send(options: { id: string; text: string }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  save(options: { value: string }): Promise<void>;
  load(): Promise<{ value?: string }>;
  forget(): Promise<void>;
  copy(options: { text: string }): Promise<void>;
  scan(): Promise<{ value: string }>;
  addListener(
    event: "socket",
    listener: (event: {
      id: string;
      type: string;
      text?: string;
      code?: number;
    }) => void,
  ): Promise<PluginListenerHandle>;
}
export const mobile = Capacitor.isNativePlatform();
const native = registerPlugin<NativeSocket>("WorkspaceSocket");
export function mobileBridge(): DesktopBridge | undefined {
  if (!mobile) return;
  const listeners = new Set<(e: AppEvent) => void>();
  const emit = (e: AppEvent) => {
    for (const listener of listeners) listener(e);
  };
  const dial: Dial = (address, fingerprint, handlers) => {
    const id = crypto.randomUUID();
    let closed = false;
    let handle: PluginListenerHandle | undefined;
    void native
      .addListener("socket", (event) => {
        if (event.id !== id || closed) return;
        if (event.type === "open") handlers.open();
        if (event.type === "message") handlers.message(event.text || "");
        if (event.type === "error")
          handlers.error(event.text || "Connection unavailable");
        if (event.type === "close") {
          closed = true;
          void handle?.remove();
          handlers.close(event.code || 1006, event.text || "");
        }
      })
      .then(async (listener) => {
        handle = listener;
        if (closed) return listener.remove();
        await native.connect({ id, address, fingerprint });
      })
      .catch(() => {
        if (!closed) {
          closed = true;
          void handle?.remove();
          handlers.close(1006, "Connection unavailable");
        }
      });
    return {
      send: (text) => {
        if (!closed)
          void native.send({ id, text }).catch(() => native.close({ id }));
      },
      close: () => {
        if (closed) return;
        closed = true;
        void handle?.remove();
        void native.close({ id });
        handlers.close(1000, "");
      },
    };
  };
  const client = new WorkspaceConnection(dial, emit, (c) =>
    native.save({ value: encodeConnection(c) }),
  );
  window.addEventListener("pagehide", () => client.disconnect());
  void App.addListener("appStateChange", (state) => {
    if (state.isActive) client.resume();
  });
  void App.addListener("backButton", () =>
    window.dispatchEvent(new Event("agentview:back")),
  );
  return {
    role: "client",
    window: () => {},
    onEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async invoke(method, params = {}) {
      if (method === "connection.scan") return native.scan();
      if (method === "connection.load") {
        if (client.connected)
          return { snapshot: client.snapshot, route: client.route };
        const { value } = await native.load();
        if (value) client.connect(decodeConnection(value));
        return {};
      }
      if (method === "connection.connect") {
        const config = decodeConnection(params.code);
        if (params.address?.trim())
          config.address = remoteAddress(
            params.address.startsWith("wss://")
              ? params.address
              : "wss://" + params.address,
          );
        client.connect(config);
        return {};
      }
      if (method === "connection.disconnect") {
        client.disconnect();
        await native.forget();
        emit({ type: "connection", state: "disconnected" });
        return {};
      }
      if (method === "clipboard.write")
        return native.copy({ text: String(params.text) });
      return client.request(method, params);
    },
  };
}
