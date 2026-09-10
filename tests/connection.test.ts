import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  HostService,
  encodeConnection,
  decodeConnection,
  describeAction,
  visibleItems,
} from "../src/host/service";
import { ClientConnection } from "../src/electron/connection";
import { WebSocket } from "ws";

function eventWhere(emitter: ClientConnection, predicate: (e: any) => boolean) {
  return new Promise<any>((resolve, reject) => {
    const listener = (e: any) => {
      if (predicate(e)) {
        clearTimeout(timer);
        emitter.off("event", listener);
        resolve(e);
      }
    };
    const timer = setTimeout(() => {
      emitter.off("event", listener);
      reject(new Error("Event timeout"));
    }, 10_000);
    emitter.on("event", listener);
  });
}

test("TLS pairing, identity rejection, live snapshots, and reconnect", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-host-"));
  const vault = path.join(root, "vault");
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, "Home.md"), "# Brain");
  const host = new HostService(
    { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
    path.join(root, "data"),
  );
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async () => ({ data: [] });
  const client = new ClientConnection();
  const invalid = new ClientConnection();
  try {
    await host.start();
    const config = host.localConnection();
    assert.deepEqual(decodeConnection(encodeConnection(config)), config);
    const rejected = eventWhere(invalid, (e) => e.state === "error");
    invalid.connect({ ...config, fingerprint: "a".repeat(64) });
    assert.match((await rejected).message, /identity changed/);
    assert.equal(host.status().clients, 0);
    const snapshot = eventWhere(client, (e) => e.type === "snapshot");
    client.connect(config);
    assert.equal((await snapshot).snapshot.graph.nodes[0].title, "Brain");
    assert.equal(
      (await client.request("note.read", { id: "Home.md" })).body,
      "# Brain",
    );
    await assert.rejects(
      client.request("note.read", { id: "../data/host-identity.json" }),
      /no longer/,
    );
    await assert.rejects(
      client.request("command.exec", { command: "anything" }),
      /Unknown/,
    );
    client.disconnect();
    const reconnect = eventWhere(client, (e) => e.type === "snapshot");
    client.connect(config);
    await reconnect;
    assert.equal(client.connected, true);
    const unauthorized = new WebSocket(config.address, {
      rejectUnauthorized: false,
    });
    const denied = new Promise<number>((resolve) =>
      unauthorized.on("close", (code) => resolve(code)),
    );
    unauthorized.on("open", () =>
      unauthorized.send(JSON.stringify({ type: "auth", token: "wrong" })),
    );
    assert.equal(await denied, 4003);
  } finally {
    client.disconnect();
    invalid.disconnect();
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("animation describes observed actions and excludes reasoning from history", () => {
  assert.equal(
    describeAction({
      type: "commandExecution",
      commandActions: [{ type: "read", path: "Home.md" }],
    }).action,
    "reading",
  );
  assert.equal(
    describeAction({ type: "fileChange", changes: [{ path: "Home.md" }] })
      .action,
    "editing",
  );
  assert.equal(
    describeAction({ type: "commandExecution", command: "unknown-tool" })
      .action,
    "running",
  );
  assert.equal(
    visibleItems([
      { id: "1", type: "reasoning", text: "private" },
      { id: "2", type: "agentMessage", text: "hello" },
    ]).length,
    1,
  );
});
