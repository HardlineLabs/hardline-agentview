import { WebSocket } from "ws";
import { ephemeral, nonce, session } from "../shared/secure";
import type { Connection } from "../shared/types";

// Prove the public endpoint reaches this host without redeeming the invitation.
export async function checkRemotePairing(config: Connection) {
  if (!config.remoteAddress)
    throw new Error(
      "Remote access is not configured on this Host. Set its secure remote endpoint and save settings first.",
    );
  const keys = await ephemeral();
  const hello = {
    type: "hello" as const,
    version: 3 as const,
    hostId: config.hostId,
    credentialId: config.credentialId,
    nonce: nonce(),
    publicKey: keys.publicKey,
  };
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(config.remoteAddress!, {
      rejectUnauthorized: true,
      handshakeTimeout: 8000,
      maxPayload: 16_000,
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(error);
      else resolve();
    };
    const unavailable = () =>
      finish(
        new Error(
          "Your remote endpoint cannot reach this Host. Check Remote access and restart the tunnel, then create a new code.",
        ),
      );
    const timer = setTimeout(unavailable, 10_000);
    socket.on("open", () => socket.send(JSON.stringify(hello)));
    socket.on("error", unavailable);
    socket.on("close", unavailable);
    socket.once("message", (bytes) => {
      void (async () => {
        const frame = JSON.parse(bytes.toString());
        if (frame.type !== "challenge") throw new Error();
        const secure = await session(
          config.secret,
          keys.privateKey,
          frame.publicKey,
          hello,
          frame,
          false,
        );
        if (!(await secure.verify("host", frame.proof))) throw new Error();
        finish();
      })().catch(() =>
        finish(
          new Error(
            "The remote endpoint reaches a different or incompatible Host. Check its address before pairing.",
          ),
        ),
      );
    });
  });
}
