import { chromium } from "playwright";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const data = path.join(root, ".local/portable-smoke");
const processes = [];
const browsers = [];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(path.join(data, "host"), { recursive: true });
await writeFile(
  path.join(data, "host/settings.json"),
  JSON.stringify({
    vaultPath:
      process.env.AGENTVIEW_TEST_VAULT ||
      path.join(process.env.USERPROFILE, "Desktop/hardline labs vault"),
    port: 43122,
    codexPath: "",
    autoStart: false,
  }),
);

async function launch(role, port) {
  const name = role === "host" ? "AgentView Host.exe" : "AgentView.exe";
  const process = spawn(
    path.join(root, "out", role, name),
    [`--remote-debugging-port=${port}`],
    {
      env: { ...env, AGENTVIEW_DATA_DIR: path.join(data, role) },
      windowsHide: true,
      stdio: "ignore",
    },
  );
  processes.push(process);
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, `${name} exposes its test window`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  browsers.push(browser);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => Boolean(window.agentview));
  return page;
}

try {
  const host = await launch("host", 9437);
  let status;
  for (let attempt = 0; attempt < 90; attempt++) {
    status = await host.evaluate(() => window.agentview.invoke("host.status"));
    if (status.agentReady && status.running && status.notes > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(
    status?.agentReady && status.running && status.notes > 0,
    "Portable Host starts its listener, runtime and vault",
  );
  const invitation = await host.evaluate(() =>
    window.agentview.invoke("host.invite", { name: "Portable smoke client" }),
  );
  const client = await launch("client", 9438);
  await client.evaluate(() => window.agentview.invoke("connection.disconnect"));
  await client.reload();
  await client.getByLabel("Connection key").fill(invitation.code);
  await client
    .locator("summary")
    .filter({ hasText: "Use a different" })
    .click();
  await client.getByLabel("Host address").fill("127.0.0.1:43122");
  await client.getByRole("button", { name: "Connect to workspace" }).click();
  await client.getByText("Your living brain.").waitFor();
  await client.waitForTimeout(1200);
  assert.equal(
    (await client.evaluate(() => window.agentview.invoke("snapshot"))).graph
      .nodes.length,
    status.notes,
  );
  await client.screenshot({ path: path.join(data, "client.png") });
  await host.screenshot({ path: path.join(data, "host.png") });
  console.log(
    JSON.stringify({
      ok: true,
      notes: status.notes,
      checks: [
        "portable host launch",
        "portable client launch",
        "independent roles",
        "TLS pairing",
        "live vault",
      ],
      screenshots: data,
    }),
  );
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  // These are only the two portable launcher process trees created by this test.
  for (const process of processes)
    if (process.pid && process.exitCode === null)
      await promisify(execFile)(
        "taskkill.exe",
        ["/PID", String(process.pid), "/T", "/F"],
        { windowsHide: true },
      ).catch(() => {});
}
