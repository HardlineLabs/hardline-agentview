import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recoverHostTunnel } from "../src/host/settings";
import { HostTunnel } from "../src/host/tunnel";

test("recover existing tunnel settings without selecting a different Host or port", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentview-tunnel-"));
  const settings = {
    vaultPath: directory,
    codexPath: "",
    port: 43124,
    autoStart: false,
    remoteAddress: "wss://host.example.com/",
  };
  try {
    assert.deepEqual(
      await recoverHostTunnel(settings, directory, []),
      settings,
    );
    const config = {
      ingress: [
        {
          hostname: "host.example.com",
          service: "https://127.0.0.1:43124",
          originRequest: {
            caPool: path.join(directory, "host-cert.pem"),
            originServerName: "localhost",
          },
        },
      ],
    };
    const file = path.join(directory, "tunnel.yml");
    await writeFile(file, "\uFEFF" + JSON.stringify(config));
    const recovered = await recoverHostTunnel(settings, directory, [
      process.execPath,
    ]);
    assert.equal(recovered.cloudflaredPath, process.execPath);
    assert.equal(recovered.tunnelConfig, file);
    await assert.rejects(
      recoverHostTunnel(settings, directory, []),
      /executable/,
    );
    await assert.rejects(
      recoverHostTunnel({ ...settings, port: 43120 }, directory, [
        process.execPath,
      ]),
      /does not match/,
    );
    await assert.rejects(
      recoverHostTunnel(
        { ...settings, remoteAddress: "wss://other.example.com" },
        directory,
        [process.execPath],
      ),
      /does not match/,
    );
    assert.deepEqual(
      await recoverHostTunnel(
        { ...settings, remoteAddress: "" },
        directory,
        [],
      ),
      { ...settings, remoteAddress: "" },
    );
    const external = {
      ...settings,
      cloudflaredPath: "custom.exe",
      tunnelConfig: "custom.yml",
    };
    assert.deepEqual(
      await recoverHostTunnel(external, directory, []),
      external,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pair waits for connector registration and reports startup failures without hanging", async () => {
  const tunnel = new HostTunnel();
  tunnel.status = "Connecting";
  let finished = false;
  const ready = tunnel.ready(1000).then(() => {
    finished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(finished, false);
  tunnel.status = "Connected";
  tunnel.emit("status");
  await ready;
  assert.equal(tunnel.listenerCount("status"), 0);
  tunnel.status = "Reconnecting";
  await assert.rejects(tunnel.ready(5), /offline/);
  tunnel.status =
    "Tunnel could not start. Check its executable and configuration.";
  await assert.rejects(tunnel.ready(), /could not start/);
  tunnel.status = "Connecting";
  const stopped = tunnel.ready();
  tunnel.stop();
  await assert.rejects(stopped, /stopped/);
  assert.equal(tunnel.listenerCount("status"), 0);
});
