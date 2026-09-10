import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { TLSSocket } from "node:tls";
import { WebSocket } from "ws";
import type { AppEvent, Connection } from "../shared/types";

export class ClientConnection extends EventEmitter {
  private socket?: WebSocket;
  private config?: Connection;
  private reconnect?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private attempts = 0;
  private generation = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  connected = false;
  snapshot?: any;
  connect(config: Connection) {
    this.disconnect();
    this.config = config;
    this.attempts = 0;
    this.open();
  }
  private open() {
    const config = this.config;
    if (!config) return;
    const generation = ++this.generation;
    this.emit("event", {
      type: "connection",
      state: this.attempts ? "reconnecting" : "connecting",
      address: config.address,
    });
    // The certificate is checked against the pairing key before any credential is sent.
    const socket = new WebSocket(config.address, {
      rejectUnauthorized: false,
      handshakeTimeout: 7000,
      maxPayload: 32_000_000,
    });
    this.socket = socket;
    socket.on("open", () => {
      if (generation !== this.generation) return socket.close();
      const tls = (socket as any)._socket as TLSSocket;
      const actual = tls
        .getPeerCertificate()
        ?.fingerprint256?.replaceAll(":", "")
        .toLowerCase();
      if (
        !actual ||
        actual !== config.fingerprint.replaceAll(":", "").toLowerCase()
      ) {
        this.config = undefined;
        this.emit("event", {
          type: "connection",
          state: "error",
          message:
            "The host identity changed. Copy a new connection key from Host.",
        });
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "auth", token: config.token }));
      this.resetWatchdog(socket);
    });
    socket.on("message", (bytes) => {
      if (generation !== this.generation) return;
      this.resetWatchdog(socket);
      try {
        const event: AppEvent = JSON.parse(bytes.toString());
        if (event.type === "snapshot") {
          this.connected = true;
          this.attempts = 0;
          this.snapshot = event.snapshot;
          this.emit("event", {
            type: "connection",
            state: "connected",
            address: config.address,
          });
        }
        if (event.type === "response") {
          const pending = this.pending.get(event.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(event.id);
          if (event.error) pending.reject(new Error(event.error));
          else pending.resolve(event.result);
          return;
        }
        this.emit("event", event);
      } catch {
        this.emit("event", {
          type: "connection",
          state: "error",
          message: "The host sent an unreadable update.",
        });
      }
    });
    socket.on("error", (e) => {
      if (generation === this.generation)
        this.emit("event", {
          type: "connection",
          state: "reconnecting",
          message: e.message,
          address: config.address,
        });
    });
    socket.on("close", (code, reason) => {
      if (generation !== this.generation) return;
      this.connected = false;
      clearTimeout(this.watchdog);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          new Error(
            "Connection interrupted. Reconnect to check whether the action completed before retrying.",
          ),
        );
      }
      this.pending.clear();
      if (code === 4003) {
        this.config = undefined;
        this.emit("event", {
          type: "connection",
          state: "error",
          message: reason.toString(),
        });
      }
      if (this.config) {
        this.emit("event", {
          type: "connection",
          state: "reconnecting",
          address: config.address,
        });
        this.reconnect = setTimeout(
          () => this.open(),
          Math.min(8000, 700 * 2 ** this.attempts++),
        );
      }
    });
  }
  private resetWatchdog(socket: WebSocket) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => socket.terminate(), 25_000);
  }
  request(method: string, params: any = {}): Promise<any> {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Connect to your host first."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "The action is taking longer than expected. Check the conversation before retrying.",
          ),
        );
      }, 65_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }
  disconnect() {
    ++this.generation;
    clearTimeout(this.reconnect);
    clearTimeout(this.watchdog);
    this.config = undefined;
    this.connected = false;
    this.socket?.close();
    this.socket = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Disconnected."));
    }
    this.pending.clear();
  }
}
