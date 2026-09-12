import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PairingRegistry, type Sql } from "../src/pairing/registry";
import { encodeConnection, decodeConnection } from "../src/shared/pairing";
import { sixDigitCode } from "../src/shared/pairing-code";
import { loadHostSettings } from "../src/host/settings";
import worker, { PairingDirectory } from "../cloud/worker";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql: Sql = {
    exec<T>(query: string, ...values: (string | number | null)[]) {
      const statement = db.prepare(query);
      const rows = statement.all(...values) as T[];
      return { toArray: () => rows };
    },
  };
  const registry = new PairingRegistry(sql);
  const invitation = encodeConnection({
    version: 3,
    hostId: randomUUID(),
    credentialId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    kind: "invite",
    address: "wss://192.168.0.4:43120",
    remoteAddress: "wss://host.example.com",
    fingerprint: "a".repeat(64),
  });
  const now = Date.now();
  const token = randomBytes(32).toString("hex");
  const publish = () =>
    registry.handle(
      "publish",
      { invitation, token, expiresAt: now + 300_000 },
      "host",
      now,
    );
  return { db, sql, registry, now, token, publish, invitation };
}
test("six-digit pairing is one-use, retryable by the same claimant and hides the LAN route", () => {
  const f = fixture();
  try {
    const created = f.publish();
    assert.equal(created.status, 200);
    const code = (created.body as any).code;
    assert.match(code, /^\d{6}$/);
    assert.equal((f.publish().body as any).code, code);
    const claimId = randomUUID();
    const result = f.registry.handle(
      "claim",
      { code, claimId },
      "phone",
      f.now,
    );
    assert.equal(result.status, 200);
    const config = decodeConnection((result.body as any).invitation);
    assert.equal(config.address, "wss://host.example.com");
    assert.equal(
      f.registry.handle("claim", { code, claimId }, "phone", f.now).status,
      200,
    );
    assert.equal(
      f.registry.handle(
        "claim",
        { code, claimId: randomUUID() },
        "other",
        f.now,
      ).status,
      404,
    );
    assert.equal(
      f.registry.handle("claim", { code, claimId }, "phone", f.now + 300_001)
        .status,
      404,
    );
  } finally {
    f.db.close();
  }
});
test("pairing codes expire, cancel with their secret and reject LAN-only/device payloads", () => {
  const f = fixture();
  try {
    const code = (f.publish().body as any).code;
    f.registry.handle("cancel", { token: "b".repeat(64) }, "host", f.now);
    assert.equal(
      f.registry.handle(
        "claim",
        { code, claimId: randomUUID() },
        "phone",
        f.now,
      ).status,
      200,
    );
    f.registry.handle("cancel", { token: f.token }, "host", f.now);
    assert.equal(
      f.registry.handle(
        "claim",
        { code, claimId: randomUUID() },
        "phone",
        f.now,
      ).status,
      404,
    );
    const config = decodeConnection(f.invitation);
    for (const changed of [
      { ...config, remoteAddress: undefined },
      { ...config, kind: "device" as const },
    ])
      assert.equal(
        f.registry.handle(
          "publish",
          {
            invitation: encodeConnection(changed),
            token: f.token,
            expiresAt: f.now + 1000,
          },
          "bad",
          f.now,
        ).status,
        400,
      );
  } finally {
    f.db.close();
  }
});
test("guessing is limited per caller and globally across callers", () => {
  const f = fixture();
  try {
    const body = { code: "000000", claimId: randomUUID() };
    for (let i = 0; i < 10; i++)
      assert.equal(f.registry.handle("claim", body, "same", f.now).status, 404);
    assert.equal(f.registry.handle("claim", body, "same", f.now).status, 429);
    for (let i = 11; i < 30; i++)
      assert.equal(
        f.registry.handle("claim", body, `other-${i}`, f.now).status,
        404,
      );
    assert.equal(
      f.registry.handle("claim", body, "another", f.now).status,
      429,
    );
    assert.equal(
      f.registry.handle("claim", body, "fresh", f.now + 60_001).status,
      404,
    );
    assert.equal(sixDigitCode("012 345"), "012345");
    assert.equal(sixDigitCode("12345"), undefined);
  } finally {
    f.db.close();
  }
});
test("Host preserves remote settings including UTF-8 BOM and fails visibly on corrupt settings", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "agentview-settings-"),
  );
  const file = path.join(directory, "settings.json");
  const defaults = {
    vaultPath: directory,
    codexPath: "",
    port: 43120,
    autoStart: false,
  };
  try {
    assert.deepEqual(await loadHostSettings(file, defaults), defaults);
    await writeFile(
      file,
      "\uFEFF" +
        JSON.stringify({
          ...defaults,
          port: 43124,
          remoteAddress: "wss://host.example.com",
        }),
    );
    const saved = await loadHostSettings(file, defaults);
    assert.equal(saved.port, 43124);
    assert.equal(saved.remoteAddress, "wss://host.example.com/");
    await writeFile(file, "broken");
    await assert.rejects(loadHostSettings(file, defaults));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Worker routes only pairing POSTs, rejects cross-origin/large bodies, and serves uncached atomic claims", async () => {
  const f = fixture();
  let alarm = 0;
  const directory = new PairingDirectory({
    storage: {
      sql: f.sql,
      async setAlarm(value) {
        alarm = value;
      },
    },
  });
  const env = {
    ASSETS: {
      async fetch() {
        return new Response("static");
      },
    },
    PAIRING: { idFromName: () => "fixture", get: () => directory },
  };
  const send = (
    action: string,
    body: unknown,
    origin = "https://app.example.com",
  ) =>
    worker.fetch(
      new Request(`https://app.example.com/api/pair/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.1",
          Origin: origin,
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  try {
    assert.equal(
      await (
        await worker.fetch(new Request("https://app.example.com/"), env)
      ).text(),
      "static",
    );
    assert.equal(
      (await send("publish", {}, "https://elsewhere.example")).status,
      403,
    );
    assert.equal(
      (await send("publish", { bytes: "x".repeat(13_000) })).status,
      413,
    );
    const published = await send("publish", {
      invitation: f.invitation,
      expiresAt: f.now + 300_000,
      token: f.token,
    });
    assert.equal(published.status, 200);
    assert.equal(published.headers.get("Cache-Control"), "no-store");
    const { code } = (await published.json()) as any;
    const claims = await Promise.all([
      send("claim", { code, claimId: randomUUID() }),
      send("claim", { code, claimId: randomUUID() }),
    ]);
    assert.deepEqual(
      claims.map((response) => response.status).sort(),
      [200, 404],
    );
    assert.ok(alarm > Date.now());
  } finally {
    f.db.close();
  }
});

test("domain migration redirects web visits and shares pairing across old and new origins", async () => {
  const f = fixture();
  const directory = new PairingDirectory({
    storage: { sql: f.sql, async setAlarm() {} },
  });
  const env = {
    ASSETS: {
      async fetch() {
        return new Response("static");
      },
    },
    PAIRING: { idFromName: () => "fixture", get: () => directory },
  };
  const oldOrigin = "https://app.hardline-labs.com";
  const newOrigin = "https://agentviewapp.hardline-labs.com";
  const send = (origin: string, action: string, body: unknown) =>
    worker.fetch(
      new Request(`${origin}/api/pair/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.1",
          Origin: origin,
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  try {
    const redirect = await worker.fetch(
      new Request(`${oldOrigin}/?source=qr`),
      env,
    );
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("Location"), `${newOrigin}/?source=qr`);
    assert.equal(
      await (await worker.fetch(new Request(newOrigin), env)).text(),
      "static",
    );
    const published = await send(oldOrigin, "publish", {
      invitation: f.invitation,
      token: f.token,
      expiresAt: f.now + 300_000,
    });
    assert.equal(published.status, 200);
    assert.equal(published.headers.get("Location"), null);
    const { code } = (await published.json()) as { code: string };
    const claimed = await send(newOrigin, "claim", {
      code,
      claimId: randomUUID(),
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.headers.get("Cache-Control"), "no-store");
    assert.equal(
      (await send(oldOrigin, "cancel", { token: f.token })).status,
      200,
    );
  } finally {
    f.db.close();
  }
});
