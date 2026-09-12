// Opt-in live check: owns one no-tool test conversation in the installed Host.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { ClientConnection } from "../src/electron/connection";

if (process.env.AGENTVIEW_LIVE_TEST !== "1")
  throw new Error(
    "Set AGENTVIEW_LIVE_TEST=1 to test the signed-in installed Host.",
  );
const root = process.env.AGENTVIEW_DATA_DIR;
if (!root)
  throw new Error(
    "Set AGENTVIEW_DATA_DIR to the installed Host data directory.",
  );
const json = async (file: string) =>
  JSON.parse(await readFile(path.join(root, file), "utf8"));
const settings = await json("settings.json");
const devices = await json("devices.json");
const device = devices.credentials.find((entry: any) => !entry.expiresAt);
if (!device)
  throw new Error("Pair a client before running the installed check.");
const identity = await json("host-identity.json");
const client = new ClientConnection();
let id: string | undefined;
try {
  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Host connection timed out")),
      15000,
    );
    client.on("event", (event) => {
      if (event.type === "snapshot") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  client.connect({
    version: 3,
    hostId: devices.hostId,
    credentialId: device.id,
    secret: device.secret,
    kind: "device",
    address: `wss://127.0.0.1:${settings.port}`,
    fingerprint: new X509Certificate(identity.cert).fingerprint256,
  });
  await connected;
  const diagnostics = await client.request("host.diagnostics", {});
  assert.equal(diagnostics.defaultPermissions, "full");
  const recover = process.env.AGENTVIEW_TEST_THREAD;
  const thread = recover
    ? (await client.request("thread.read", { id: recover })).thread
    : await client.request("thread.create", {});
  if (recover)
    assert.equal(thread.name, "AgentView installed approval validation");
  id = thread.id;
  await client.request("thread.rename", {
    id,
    name: "AgentView installed approval validation",
  });
  const started = recover
    ? null
    : await client.request("thread.send", {
        id,
        text: "This is an installed AgentView validation. Reply AGENTVIEW_APPROVAL_OK. Do not use tools, modify files, or perform any other work.",
      });
  const deadline = Date.now() + 120000;
  let finished = false;
  while (Date.now() < deadline) {
    let history;
    try {
      history = await client.request("thread.read", { id });
    } catch (error) {
      // The runtime may announce a new turn before flushing its first rollout.
      if (!/rollout .* is empty/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const turn = history.turns.find(
      (entry: any) => !started || entry.id === started.turn.id,
    );
    if (turn && turn.status !== "inProgress") {
      assert.equal(turn.status, "completed");
      finished = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(finished, "Installed test turn timed out");
  // Read only this test's runtime metadata, never other conversation contents.
  const rollout = path.resolve(thread.path);
  const sessions = path.resolve(diagnostics.codexHome, "sessions") + path.sep;
  assert.ok(rollout.toLowerCase().startsWith(sessions.toLowerCase()));
  const records = (await readFile(rollout, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const context = records.findLast(
    (record) => record.type === "turn_context",
  )?.payload;
  assert.equal(context?.approval_policy, "on-request");
  assert.equal(context?.sandbox_policy?.type, "danger-full-access");
  console.log(
    JSON.stringify({
      hostVersion: diagnostics.hostVersion,
      approvalPolicy: context.approval_policy,
      sandbox: context.sandbox_policy.type,
      installedHostTurn: "passed",
      workerVersion: diagnostics.runtime.workerVersion,
    }),
  );
} finally {
  if (id)
    await client.request("thread.delete", { id, confirm: id }).catch((error) => {
      console.error(`Test conversation ${id} retained: ${error.message}`);
      process.exitCode = 1;
    });
  client.disconnect();
}
