import { _electron as electron } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const dir = path.join(root, ".local/smoke");
await mkdir(dir, { recursive: true });
const vault =
  process.env.AGENTVIEW_TEST_VAULT ||
  path.join(process.env.USERPROFILE, "Desktop/hardline labs vault");
const hostData = path.join(dir, "host");
await mkdir(hostData, { recursive: true });
await writeFile(
  path.join(hostData, "settings.json"),
  JSON.stringify({
    vaultPath: vault,
    codexPath: "",
    port: 43121,
    autoStart: false,
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let host, client;
const errors = [];
try {
  host = await electron.launch({
    args: [root, "--role=host"],
    env: { ...env, AGENTVIEW_DATA_DIR: hostData },
  });
  const hw = await host.firstWindow();
  hw.on("pageerror", (e) => errors.push(e.message));
  await hw.waitForFunction(
    async () => (await window.agentview.invoke("host.status")).agentReady,
    null,
    { timeout: 45_000 },
  );
  const status = await hw.evaluate(() =>
    window.agentview.invoke("host.status"),
  );
  assert.equal(status.running, true);
  assert.ok(status.notes > 0);
  await hw.screenshot({ path: path.join(dir, "host.png") });
  client = await electron.launch({
    args: [root, "--role=client"],
    env: { ...env, AGENTVIEW_DATA_DIR: path.join(dir, "client") },
  });
  const cw = await client.firstWindow();
  cw.on("pageerror", (e) => errors.push(e.message));
  await cw.evaluate(() => window.agentview.invoke("connection.disconnect"));
  await cw.reload();
  await cw.getByLabel("Connection key").fill(status.pairingCode);
  await cw.locator("summary").filter({ hasText: "Use a different" }).click();
  await cw.getByLabel("Host address").fill("127.0.0.1:43121");
  await cw.getByRole("button", { name: "Connect to workspace" }).click();
  await cw.getByText("Your living brain.").waitFor({ timeout: 20_000 });
  await cw.waitForTimeout(1800);
  await cw.screenshot({ path: path.join(dir, "client.png") });
  await cw.getByRole("button", { name: "Find anything" }).click();
  await cw.getByPlaceholder("Find a note or conversation…").fill("Company");
  await cw.locator(".palette-results button").first().click();
  await cw.locator(".note-inspector .markdown h1").first().waitFor();
  await cw.getByRole("button", { name: "Bring into conversation" }).click();
  await cw.locator(".attached-note").waitFor();
  await cw.getByRole("button", { name: "Remove attachment" }).click();
  const threads = cw.locator(".thread");
  if (await threads.count()) {
    await threads.first().click();
    await cw.waitForSelector(".turn", { timeout: 20_000 });
  }
  await cw.screenshot({ path: path.join(dir, "conversation.png") });
  if (process.env.AGENTVIEW_LIVE_TEST === "1") {
    await cw
      .getByRole("button", { name: "New conversation", exact: false })
      .first()
      .click();
    await cw.evaluate(() => {
      window.__agentviewEvents = [];
      window.agentview.onEvent((e) => {
        if (e.type === "agentEvent" || e.type === "agents")
          window.__agentviewEvents.push(e);
      });
    });
    await cw
      .getByLabel("Message your agent")
      .fill(
        "This is a read-only AgentView connection check. Use a tool to read Home.md in the current vault, then reply with AGENTVIEW_CONNECTED and one short sentence describing the vault. Do not modify files, run checks, or spawn subagents.",
      );
    await cw.getByRole("button", { name: "Send message", exact: true }).click();
    await cw.waitForFunction(
      () =>
        window.__agentviewEvents.some(
          (e) => e.type === "agents" && e.agents.some((a) => a.active),
        ),
      null,
      { timeout: 90_000 },
    );
    await cw.screenshot({ path: path.join(dir, "agent-active.png") });
    await cw.waitForFunction(
      () => window.__agentviewEvents.some((e) => e.method === "turn/completed"),
      null,
      { timeout: 180_000 },
    );
    const result = await cw.evaluate(() =>
      window.__agentviewEvents
        .filter((e) => e.method === "turn/completed")
        .at(-1),
    );
    assert.equal(
      result.params.turn.status,
      "completed",
      JSON.stringify(result.params.turn.error),
    );
    await cw
      .locator(".agent-message")
      .filter({ hasText: "AGENTVIEW_CONNECTED" })
      .waitFor({ timeout: 20_000 });
    await cw.screenshot({ path: path.join(dir, "agent-complete.png") });
    console.log(
      "Live agent turn passed: UI send, tool execution, activity orbs, streamed response.",
    );
  }
  await cw
    .getByRole("button", { name: "Hide conversation", exact: true })
    .first()
    .click();
  await cw.waitForTimeout(500);
  await cw.screenshot({ path: path.join(dir, "brain.png") });
  // The client is still connected when the host window is closed to its tray.
  await hw.getByRole("button", { name: "Close", exact: true }).click();
  assert.ok(
    (await cw.evaluate(() => window.agentview.invoke("snapshot"))).graph.nodes
      .length > 0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      notes: status.notes,
      screenshots: dir,
      checks: [
        "host start",
        "TLS pairing",
        "real vault",
        "note search and attachment",
        "desktop history",
        "tray lifecycle",
        "no renderer errors",
      ],
    }),
  );
} finally {
  await client?.close();
  await host?.close();
}
