import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ephemeral, nonce, session, type Hello } from "../src/shared/secure";
import { Devices } from "../src/host/devices";
import { HostService, decodeConnection } from "../src/host/service";
import { ClientConnection, desktopDial } from "../src/electron/connection";
import { WorkspaceConnection, type Dial } from "../src/shared/client";
import type { Connection } from "../src/shared/types";

test("secure sessions authenticate both sides, hide data, reject tampering and replay", async () => {
  const client = await ephemeral(),
    host = await ephemeral();
  const hello: Hello = {
    type: "hello",
    version: 3,
    hostId: crypto.randomUUID(),
    credentialId: crypto.randomUUID(),
    nonce: nonce(),
    publicKey: client.publicKey,
  };
  const challenge = { nonce: nonce(), publicKey: host.publicKey };
  const secret = nonce();
  const c = await session(
    secret,
    client.privateKey,
    host.publicKey,
    hello,
    challenge,
    false,
  );
  const h = await session(
    secret,
    host.privateKey,
    client.publicKey,
    hello,
    challenge,
    true,
  );
  assert.equal(await c.verify("host", await h.proof("host")), true);
  assert.equal(await h.verify("client", await c.proof("client")), true);
  assert.equal(
    await h.verify("client", await h.proof("host")),
    false,
    "Role reflection is rejected",
  );
  const frame = await c.encrypt({ text: "private workspace content" });
  assert.ok(!frame.includes("private workspace content"));
  assert.deepEqual(await h.decrypt(JSON.parse(frame)), {
    text: "private workspace content",
  });
  await assert.rejects(h.decrypt(JSON.parse(frame)), /replayed/);
  const next = JSON.parse(await c.encrypt({ text: "second" }));
  next.data = (next.data.startsWith("00") ? "01" : "00") + next.data.slice(2);
  await assert.rejects(h.decrypt(next));
  const wrong = await session(
    nonce(),
    host.privateKey,
    client.publicKey,
    hello,
    challenge,
    true,
  );
  assert.equal(await c.verify("host", await wrong.proof("host")), false);
  const wrongHost = await session(
    secret,
    host.privateKey,
    client.publicKey,
    { ...hello, hostId: crypto.randomUUID() },
    challenge,
    true,
  );
  assert.equal(
    await c.verify("host", await wrongHost.proof("host")),
    false,
    "Host identity is bound to the session",
  );
  assert.deepEqual(
    await c.decrypt(JSON.parse(await h.encrypt({ reply: true }))),
    { reply: true },
  );
});

test("invitations expire, redeem once concurrently, persist and revoke independently", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentview-devices-"));
  try {
    const devices = new Devices(directory);
    await devices.load();
    const old = await devices.invite("Old invite");
    old.expiresAt = Date.now() - 1;
    assert.equal(devices.lookup(old.id), undefined);
    const invite = await devices.invite("Phone");
    const results = await Promise.allSettled([
      devices.authorize(invite.id),
      devices.authorize(invite.id),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(devices.list().length, 1);
    assert.ok(!JSON.stringify(devices.list()).includes("secret"));
    const second = await devices.authorize(
      (await devices.invite("Desktop")).id,
    );
    const restored = new Devices(directory);
    await restored.load();
    assert.equal(restored.hostId, devices.hostId);
    assert.equal(restored.list().length, 2);
    await restored.revoke(second.device.id);
    assert.equal(restored.lookup(second.device.id), undefined);
    assert.equal(restored.list().length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function waitFor(client: ClientConnection, predicate: (e: any) => boolean) {
  return new Promise<any>((resolve, reject) => {
    const listener = (e: any) => {
      if (predicate(e)) {
        clearTimeout(timer);
        client.off("event", listener);
        resolve(e);
      }
    };
    const timer = setTimeout(() => {
      client.off("event", listener);
      reject(new Error("Timed out"));
    }, 10_000);
    client.on("event", listener);
  });
}
test("host rejects reused invitations and another host identity; removal terminates device access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentview-revoke-"));
  const host = new HostService(
    { vaultPath: directory, port: 0, codexPath: "", autoStart: false },
    path.join(directory, ".host"),
  );
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async () => ({ data: [] });
  let saved: Connection | undefined;
  const good = new ClientConnection(async (c) => {
    saved = c;
  });
  const bad = new ClientConnection();
  try {
    await host.start();
    const invitation = host.localConnection();
    let denied = waitFor(bad, (e) => e.state === "error");
    bad.connect({ ...invitation, hostId: crypto.randomUUID() });
    await denied;
    const ready = waitFor(good, (e) => e.type === "snapshot");
    good.connect(invitation);
    await ready;
    assert.equal(saved?.kind, "device");
    denied = waitFor(bad, (e) => e.state === "error");
    bad.connect(invitation);
    await denied;
    const removed = waitFor(good, (e) => e.state === "error");
    await host.revokeDevice(saved!.credentialId);
    await removed;
    await assert.rejects(good.request("snapshot"), /Connect/);
    denied = waitFor(bad, (e) => e.state === "error");
    bad.connect(saved!);
    await denied;
  } finally {
    good.disconnect();
    bad.disconnect();
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("LAN failure falls back to remote, carries only encrypted content and persists pairing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentview-route-"));
  const host = new HostService(
    { vaultPath: directory, port: 0, codexPath: "", autoStart: false },
    path.join(directory, ".host"),
  );
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async () => ({ data: [] });
  let client: WorkspaceConnection | undefined;
  try {
    await host.start();
    const config = decodeConnection(
      (await host.createInvitation("Remote phone")).code,
    );
    const origin = host.localConnection();
    const routes: string[] = [],
      frames: string[] = [];
    // The test route uses the host's pinned test certificate; production remote dialing uses public CA validation.
    const dial: Dial = (address, fingerprint, handlers) => {
      routes.push(address);
      if (fingerprint) {
        queueMicrotask(() => handlers.close(1006, "LAN unreachable"));
        return { send() {}, close() {} };
      }
      const transport = desktopDial(origin.address, origin.fingerprint, {
        ...handlers,
        message: (text) => {
          frames.push(text);
          handlers.message(text);
        },
      });
      return {
        ...transport,
        send: (text) => {
          frames.push(text);
          transport.send(text);
        },
      };
    };
    let saved: Connection | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Remote fallback timeout")),
        10_000,
      );
      client = new WorkspaceConnection(
        dial,
        (e) => {
          if (e.type === "snapshot") {
            clearTimeout(timer);
            resolve();
          }
        },
        async (c) => {
          saved = c;
        },
      );
    });
    client!.connect({ ...config, remoteAddress: "wss://remote.example.test/" });
    await ready;
    assert.equal(client!.route, "remote");
    assert.deepEqual(routes, [config.address, "wss://remote.example.test/"]);
    assert.equal(saved?.kind, "device");
    assert.ok((await client!.request("snapshot")).host);
    assert.ok(!frames.join("").includes(config.secret));
    assert.ok(!frames.join("").includes(saved!.secret));
    assert.ok(!frames.join("").includes("graph"));
  } finally {
    client?.disconnect();
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
