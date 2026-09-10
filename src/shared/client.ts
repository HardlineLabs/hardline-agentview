import type { AppEvent, Connection } from "./types";
import {
  ephemeral,
  nonce,
  session,
  type Hello,
  type SecureSession,
} from "./secure";

export type SocketHandlers = {
  open(): void;
  message(text: string): void;
  close(code: number, reason: string): void;
  error(message: string): void;
};
export type Transport = { send(text: string): void; close(): void };
export type Dial = (
  address: string,
  fingerprint: string | undefined,
  handlers: SocketHandlers,
) => Transport;

export class WorkspaceConnection {
  private transport?: Transport;
  private config?: Connection;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private connectionDeadline?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private remote = false;
  private secure?: SecureSession;
  private outgoing = Promise.resolve();
  private pending = new Map<
    string,
    {
      resolve(value: any): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  connected = false;
  snapshot?: any;
  route: "local" | "remote" = "local";
  constructor(
    private dial: Dial,
    private emit: (event: AppEvent) => void,
    private remember: (config: Connection) => Promise<void>,
  ) {}
  connect(config: Connection) {
    this.disconnect();
    this.config = { ...config };
    this.remote = false;
    this.attempts = 0;
    this.connectionDeadline = setTimeout(() => {
      this.disconnect();
      this.emit({
        type: "connection",
        state: "error",
        message: config.remoteAddress
          ? "Could not reach your workspace locally or remotely. Check that Host and its remote tunnel are running, then try a fresh invitation."
          : "This invitation only works on the host's local network. For remote access, configure Remote access in Host and create a new invitation.",
      });
    }, 30_000);
    this.open();
  }
  private open() {
    const config = this.config;
    if (!config) return;
    const generation = ++this.generation;
    const remote = this.remote && Boolean(config.remoteAddress);
    const address = remote ? config.remoteAddress! : config.address;
    this.route = remote ? "remote" : "local";
    this.secure = undefined;
    this.outgoing = Promise.resolve();
    this.emit({
      type: "connection",
      state: this.attempts ? "reconnecting" : "connecting",
      route: this.route,
    });
    let incoming = Promise.resolve();
    let hello: Hello;
    let keys: Awaited<ReturnType<typeof ephemeral>>;
    let authenticated = false;
    const current = () => generation === this.generation;
    const fail = (message: string) => {
      if (!current()) return;
      this.config = undefined;
      clearTimeout(this.connectionDeadline);
      this.emit({ type: "connection", state: "error", message });
      this.transport?.close();
    };
    const send = (value: unknown) => {
      if (current()) this.transport?.send(JSON.stringify(value));
    };
    const handlers: SocketHandlers = {
      open: () => {
        if (!current()) return;
        // The short LAN deadline only covers dialing, not encryption or secure storage.
        this.armTimeout(20_000);
        incoming = incoming
          .then(async () => {
            keys = await ephemeral();
            hello = {
              type: "hello",
              version: 3,
              hostId: config.hostId,
              credentialId: config.credentialId,
              nonce: nonce(),
              publicKey: keys.publicKey,
            };
            send(hello);
          })
          .catch(() => fail("Could not create a secure session."));
      },
      message: (raw) => {
        incoming = incoming
          .then(async () => {
            if (!current()) return;
            const frame = JSON.parse(raw);
            if (!this.secure) {
              if (frame.type !== "challenge" || !keys)
                throw new Error("Invalid host handshake.");
              const secure = await session(
                config.secret,
                keys.privateKey,
                frame.publicKey,
                hello,
                frame,
                false,
              );
              if (!(await secure.verify("host", frame.proof)))
                throw new Error(
                  "The host identity changed. Pair again from Host.",
                );
              if (!current()) return;
              this.secure = secure;
              send({
                type: "authenticate",
                proof: await secure.proof("client"),
              });
              return;
            }
            const event: AppEvent = await this.secure.decrypt(frame);
            if (!current()) return;
            if (event.type === "paired") {
              this.armTimeout(20_000);
              const updated: Connection = {
                ...config,
                credentialId: event.credentialId,
                secret: event.secret,
                kind: "device",
              };
              if (
                !/^[a-f0-9]{64}$/i.test(updated.secret) ||
                typeof updated.credentialId !== "string"
              )
                throw new Error("Invalid device identity.");
              await this.remember(updated);
              if (!current()) return;
              this.config = updated;
              this.transport?.send(
                await this.secure.encrypt({ type: "pairingSaved" }),
              );
              return;
            }
            if (event.type === "snapshot") {
              clearTimeout(this.connectionDeadline);
              authenticated = true;
              this.connected = true;
              this.attempts = 0;
              this.snapshot = event.snapshot;
              this.emit({
                type: "connection",
                state: "connected",
                route: this.route,
              });
            }
            this.armTimeout(25_000);
            if (event.type === "response") {
              const p = this.pending.get(event.id);
              if (!p) return;
              clearTimeout(p.timer);
              this.pending.delete(event.id);
              if (event.error) p.reject(new Error(event.error));
              else p.resolve(event.result);
            } else this.emit(event);
          })
          .catch((e) =>
            fail(e.message || "The secure session could not be verified."),
          );
      },
      error: (message) => {
        if (
          current() &&
          message.includes("identity changed") &&
          (remote || !config.remoteAddress)
        )
          fail(message);
      },
      close: (code, reason) => {
        if (!current()) return;
        this.transport = undefined;
        clearTimeout(this.watchdog);
        this.connected = false;
        this.rejectPending(
          "Connection interrupted. Check whether the action completed before retrying.",
        );
        if (code === 4003) {
          clearTimeout(this.connectionDeadline);
          this.config = undefined;
          this.emit({
            type: "connection",
            state: "error",
            message:
              reason || "Device access was removed. Pair again from Host.",
          });
        }
        if (!this.config) return;
        // Every new connection cycle tries LAN first. A failed LAN attempt falls back once.
        this.remote =
          !authenticated && !remote && Boolean(config.remoteAddress);
        this.emit({
          type: "connection",
          state: "reconnecting",
          route: this.route,
          message: this.remote
            ? "Local host unavailable. Trying the remote connection…"
            : "Workspace unavailable. Retrying the connection…",
        });
        this.retry = setTimeout(
          () => this.open(),
          this.remote ? 100 : Math.min(8000, 700 * 2 ** this.attempts++),
        );
      },
    };
    this.transport = this.dial(
      address,
      remote ? undefined : config.fingerprint,
      handlers,
    );
    this.armTimeout(remote ? 10_000 : 3500);
  }
  private armTimeout(ms: number) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.transport?.close(), ms);
  }
  request(method: string, params: any = {}): Promise<any> {
    if (!this.connected || !this.secure)
      return Promise.reject(new Error("Connect to your host first."));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "The action is taking longer than expected. Check the conversation before retrying.",
          ),
        );
      }, 65_000);
      this.pending.set(id, { resolve, reject, timer });
      const secure = this.secure!;
      const generation = this.generation;
      this.outgoing = this.outgoing
        .then(async () => {
          const frame = await secure.encrypt({ id, method, params });
          if (generation === this.generation) this.transport?.send(frame);
        })
        .catch(() => this.transport?.close());
    });
  }
  resume() {
    if (this.config && !this.connected && !this.transport && !this.retry) {
      const config = this.config;
      this.connect(config);
    }
  }
  private rejectPending(message: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
  disconnect() {
    ++this.generation;
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
    clearTimeout(this.connectionDeadline);
    this.retry = undefined;
    this.config = undefined;
    this.connected = false;
    this.snapshot = undefined;
    this.transport?.close();
    this.transport = undefined;
    this.rejectPending("Disconnected.");
  }
}
