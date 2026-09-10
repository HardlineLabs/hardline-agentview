import { EventEmitter } from "node:events";
import { TLSSocket } from "node:tls";
import { WebSocket } from "ws";
import { WorkspaceConnection, type Dial } from "../shared/client";
import type { Connection } from "../shared/types";

export const desktopDial: Dial = (address, fingerprint, handlers) => {
  const socket = new WebSocket(address, {
    rejectUnauthorized: !fingerprint,
    handshakeTimeout: 7000,
    maxPayload: 64_000_000,
    followRedirects: false,
  });
  socket.on("open", () => {
    if (fingerprint) {
      const actual = ((socket as any)._socket as TLSSocket)
        .getPeerCertificate()
        ?.fingerprint256?.replaceAll(":", "")
        .toLowerCase();
      if (actual !== fingerprint.replaceAll(":", "").toLowerCase()) {
        handlers.error("The host identity changed. Pair again from Host.");
        socket.close();
        return;
      }
    }
    handlers.open();
  });
  socket.on("message", (bytes) => handlers.message(bytes.toString()));
  socket.on("error", (e) => handlers.error(e.message));
  socket.on("close", (code, reason) => handlers.close(code, reason.toString()));
  return {
    send: (text) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
    },
    close: () => socket.terminate(),
  };
};

export class ClientConnection extends EventEmitter {
  private connection: WorkspaceConnection;
  constructor(
    remember: (config: Connection) => Promise<void> = async () => {},
  ) {
    super();
    this.connection = new WorkspaceConnection(
      desktopDial,
      (e) => this.emit("event", e),
      remember,
    );
  }
  get connected() {
    return this.connection.connected;
  }
  get snapshot() {
    return this.connection.snapshot;
  }
  get route() {
    return this.connection.route;
  }
  connect(config: Connection) {
    this.connection.connect(config);
  }
  disconnect() {
    this.connection.disconnect();
  }
  request(method: string, params?: any) {
    return this.connection.request(method, params);
  }
}
