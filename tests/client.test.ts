import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceConnection, type SocketHandlers } from "../src/shared/client";
import type { AppEvent, Connection } from "../src/shared/types";

const config: Connection = {
  version: 3,
  kind: "invite",
  hostId: crypto.randomUUID(),
  credentialId: crypto.randomUUID(),
  secret: "a".repeat(64),
  fingerprint: "b".repeat(64),
  address: "wss://192.0.2.1:43120",
};

test("LAN dial timeout does not cut off a secure handshake; foreground does not restart pairing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let handlers!: SocketHandlers;
  let dials = 0,
    closes = 0;
  const client = new WorkspaceConnection(
    (_a, _p, h) => {
      handlers = h;
      dials++;
      return {
        send() {},
        close() {
          closes++;
          h.close(1000, "");
        },
      };
    },
    () => {},
    async () => {},
  );
  client.connect(config);
  t.mock.timers.tick(3000);
  handlers.open();
  client.resume();
  t.mock.timers.tick(4000);
  assert.equal(dials, 1);
  assert.equal(
    closes,
    0,
    "Pairing has its own longer deadline after socket open",
  );
  client.disconnect();
});

test("unreachable invitation finishes with actionable error instead of retrying forever", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events: AppEvent[] = [];
  const client = new WorkspaceConnection(
    (_a, _p, h) => ({
      send() {},
      close() {
        h.close(1006, "Network unavailable");
      },
    }),
    (e) => events.push(e),
    async () => {},
  );
  client.connect({ ...config, remoteAddress: "wss://remote.example.test/" });
  for (let i = 0; i < 31; i++) t.mock.timers.tick(1000);
  const last = events.at(-1);
  assert.equal(last?.type, "connection");
  assert.equal((last as any).state, "error");
  assert.match((last as any).message, /Host and its remote tunnel/);
  const count = events.length;
  t.mock.timers.tick(60_000);
  assert.equal(events.length, count);
  client.disconnect();
});
