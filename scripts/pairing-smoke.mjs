import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Exercise real Durable Object SQLite and routing in workerd, independently of Codex.
const directory = await mkdtemp(path.join(os.tmpdir(), "agentview-pairing-"));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "dev",
    "--port",
    "8797",
    "--persist-to",
    directory,
  ],
  {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
let log = "";
child.stdout.on("data", (bytes) => {
  log = (log + bytes).slice(-8000);
});
child.stderr.on("data", (bytes) => {
  log = (log + bytes).slice(-8000);
});
const endpoint = "http://127.0.0.1:8797";
const send = (action, body) =>
  fetch(`${endpoint}/api/pair/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(log);
    try {
      if ((await fetch(endpoint)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, log);
  const config = {
    version: 3,
    hostId: randomUUID(),
    credentialId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    kind: "invite",
    address: "wss://host.example.com",
    remoteAddress: "wss://host.example.com",
    fingerprint: "a".repeat(64),
  };
  const created = await send("publish", {
    invitation:
      "agentview://" +
      Buffer.from(JSON.stringify(config)).toString("base64url"),
    expiresAt: Date.now() + 300_000,
    token: randomBytes(32).toString("hex"),
  });
  assert.equal(created.status, 200, await created.clone().text());
  const { code } = await created.json();
  assert.match(code, /^\d{6}$/);
  const claimId = randomUUID();
  assert.equal((await send("claim", { code, claimId })).status, 200);
  assert.equal((await send("claim", { code, claimId })).status, 200);
  assert.equal(
    (await send("claim", { code, claimId: randomUUID() })).status,
    404,
  );
  console.log(
    "Real Worker/SQLite: publish, six-digit claim, retry and one-use rejection passed.",
  );
} finally {
  if (child.exitCode === null) {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else process.kill(-child.pid, "SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
