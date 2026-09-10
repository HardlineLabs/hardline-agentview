import { WebSocket } from "ws";
import {
  ephemeral,
  nonce,
  session,
  type SecureSession,
} from "../shared/secure";
import type { Devices } from "./devices";

export class SecurePeer {
  deviceId = "";
  private secure?: SecureSession;
  private credentialId = "";
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve();
  private waiting = 0;
  private queuedBytes = 0;
  private timer: NodeJS.Timeout;
  constructor(
    private socket: WebSocket,
    devices: Devices,
    private ready: (
      peer: SecurePeer,
      credential: { id: string; secret: string },
      paired: boolean,
    ) => void,
    private message: (data: any) => void,
    closed: () => void,
  ) {
    this.timer = setTimeout(
      () => this.close(4001, "Pairing timed out"),
      20_000,
    );
    socket.on("message", (bytes) => {
      if (
        ++this.waiting > 64 ||
        (!this.deviceId && bytes.toString().length > 4096)
      )
        return this.close(4008, "Too many requests");
      this.incoming = this.incoming
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const frame = JSON.parse(bytes.toString());
          if (!this.secure) {
            if (
              frame.type !== "hello" ||
              frame.version !== 3 ||
              frame.hostId !== devices.hostId
            )
              throw new Error();
            const credential = devices.lookup(frame.credentialId);
            if (!credential) throw new Error();
            this.credentialId = credential.id;
            const keys = await ephemeral();
            const challenge = {
              type: "challenge" as const,
              nonce: nonce(),
              publicKey: keys.publicKey,
            };
            this.secure = await session(
              credential.secret,
              keys.privateKey,
              frame.publicKey,
              frame,
              challenge,
              true,
            );
            socket.send(
              JSON.stringify({
                ...challenge,
                proof: await this.secure.proof("host"),
              }),
            );
          } else if (!this.deviceId) {
            if (
              frame.type !== "authenticate" ||
              !(await this.secure.verify("client", frame.proof))
            )
              throw new Error();
            const { device, paired } = await devices.authorize(
              this.credentialId,
            );
            if (socket.readyState !== WebSocket.OPEN) return;
            this.deviceId = device.id;
            if (!paired) clearTimeout(this.timer);
            this.ready(this, device, paired);
          } else {
            if (!devices.lookup(this.deviceId)) throw new Error();
            this.message(await this.secure.decrypt(frame));
            clearTimeout(this.timer);
          }
        })
        .catch(() =>
          this.close(
            4003,
            "Pairing expired, access removed, or secure identity did not match.",
          ),
        )
        .finally(() => {
          this.waiting--;
        });
    });
    socket.on("close", () => {
      clearTimeout(this.timer);
      closed();
    });
    socket.on("error", () => {});
  }
  get readyState() {
    return this.socket.readyState;
  }
  get bufferedAmount() {
    return this.socket.bufferedAmount + this.queuedBytes;
  }
  send(text: string) {
    this.queuedBytes += Buffer.byteLength(text);
    if (this.queuedBytes > 16_000_000)
      return this.close(4008, "Reconnect to refresh");
    this.outgoing = this.outgoing
      .then(async () => {
        if (this.socket.readyState === WebSocket.OPEN && this.secure)
          this.socket.send(await this.secure.encrypt(JSON.parse(text)));
      })
      .catch(() => this.close(4003, "Secure session failed"))
      .finally(() => {
        this.queuedBytes -= Buffer.byteLength(text);
      });
  }
  close(code: number, reason: string) {
    this.socket.close(code, reason);
    const timer = setTimeout(() => this.socket.terminate(), 1000);
    timer.unref();
  }
}
