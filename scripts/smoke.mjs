import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
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
const packaged = process.env.AGENTVIEW_PACKAGED === "1";
try {
  host = await electron.launch({
    ...(packaged
      ? {
          executablePath: path.join(
            root,
            "out/host/win-unpacked/AgentView Host.exe",
          ),
          args: [],
        }
      : { args: [root, "--role=host"] }),
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
    ...(packaged
      ? {
          executablePath: path.join(
            root,
            "out/client/win-unpacked/AgentView.exe",
          ),
          args: [],
        }
      : { args: [root, "--role=client"] }),
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
  await cw.getByLabel("Filter by project").waitFor();
  await cw.getByLabel("Filter by category").waitFor();
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
  await cw.locator(".context-usage").waitFor();
  await cw.locator(".usage-limits summary").click();
  await cw.locator(".limit-window").first().waitFor({ timeout: 20_000 });
  await cw.screenshot({ path: path.join(dir, "usage.png") });
  await cw.locator(".usage-limits summary").click();
  const density = await cw.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return {
      width: canvas.width,
      expected: Math.round(
        canvas.getBoundingClientRect().width * devicePixelRatio,
      ),
    };
  });
  assert.equal(density.width, density.expected);
  await client.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 760),
  );
  await cw.getByRole("button", { name: "Fit graph", exact: true }).click();
  await cw.waitForTimeout(400);
  await cw.screenshot({ path: path.join(dir, "compact.png") });
  assert.ok(await cw.getByLabel("Message your agent").isVisible());
  await client.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 940),
  );
  await cw.getByRole("button", { name: "Fit graph", exact: true }).click();
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
        "This is a read-only AgentView connection check. First run a shell command that waits 12 seconds (Start-Sleep -Seconds 12 in PowerShell), so the client can test steering while you work. Then use a tool to read Home.md in the current vault, and reply with AGENTVIEW_CONNECTED and one short sentence. Do not modify files, run checks, or spawn subagents.",
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
      () =>
        window.__agentviewEvents.some(
          (e) =>
            e.method === "item/started" &&
            e.params.item.type === "commandExecution",
        ),
      null,
      { timeout: 90_000 },
    );
    await cw
      .getByLabel("Message your agent")
      .fill(
        "Additional direction from the client: include AGENTVIEW_STEERED in your final reply to confirm that this mid-work message reached you.",
      );
    await cw.getByRole("button", { name: "Steer agent", exact: true }).click();
    await cw
      .getByText("Steering message accepted by the active agent.")
      .waitFor();
    await cw.screenshot({ path: path.join(dir, "agent-steering.png") });
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
    await cw
      .locator(".agent-message")
      .filter({ hasText: "AGENTVIEW_STEERED" })
      .waitFor({ timeout: 20_000 });
    await cw.screenshot({ path: path.join(dir, "agent-complete.png") });
    const testId = result.params.threadId;
    const testThread = await cw.evaluate(
      async (id) =>
        (await window.agentview.invoke("snapshot")).threads.find(
          (t) => t.id === id,
        ),
      testId,
    );
    assert.ok(
      testThread?.owned,
      "Only clear the AgentView test conversation created in this run",
    );
    const openTestThread = async () => {
      const title =
        testThread.name ||
        testThread.preview.slice(0, 48) ||
        "Untitled conversation";
      await cw.locator(".thread").filter({ hasText: title }).first().click();
      await cw.locator(".turn").first().waitFor();
    };
    await cw.getByRole("button", { name: "Archive", exact: true }).click();
    await cw
      .getByRole("button", { name: "Archive conversation", exact: true })
      .click();
    await cw.waitForFunction(
      async (id) =>
        (await window.agentview.invoke("snapshot")).threads.find(
          (t) => t.id === id,
        )?.archived,
      testId,
    );
    await cw.getByRole("button", { name: "Archived", exact: true }).click();
    await openTestThread();
    await cw.getByRole("button", { name: "Restore", exact: true }).click();
    await cw.waitForFunction(
      async (id) =>
        (await window.agentview.invoke("snapshot")).threads.find(
          (t) => t.id === id,
        )?.archived === false,
      testId,
    );
    await cw.getByRole("button", { name: "Chats", exact: true }).click();
    await openTestThread();
    await cw.getByRole("button", { name: "Delete", exact: true }).click();
    await cw
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await cw.waitForFunction(
      async (id) =>
        !(await window.agentview.invoke("snapshot")).threads.some(
          (t) => t.id === id,
        ),
      testId,
    );
    console.log(
      "Live agent turn passed: UI send, mid-work steering, tool activity, context usage, archive, restore and permanent deletion of the test conversation.",
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
