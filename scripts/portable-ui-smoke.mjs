import { chromium } from "playwright";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// Exercise the actual delivered portable executable against the real HTTPS feed.
const data = await mkdtemp(
  path.join(os.tmpdir(), "agentview-portable-update-"),
);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env, AGENTVIEW_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  path.resolve(process.argv[2] || "out/client/AgentView.exe"),
  [`--remote-debugging-port=${port}`],
  {
    env,
    windowsHide: true,
    stdio: "ignore",
  },
);
let browser;
try {
  let reachable = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        reachable = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null)
      throw new Error(`Portable client exited with ${child.exitCode}.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(reachable, "Portable client exposes its isolated test window");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "Update UI", exact: true }).click();
  await page
    .getByText("UI updated.", { exact: true })
    .waitFor({ timeout: 60000 });
  const info = await page.evaluate(() => window.agentview.invoke("ui.status"));
  assert.notEqual(info.version, "bundled");
  await page.getByRole("button", { name: "Update UI", exact: true }).click();
  await page.getByText("Your UI is up to date.", { exact: true }).waitFor();
  console.log(JSON.stringify({ portable: true, liveFeed: true, ...info }));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 250));
} finally {
  await browser?.close().catch(() => {});
  // Terminate only the isolated launcher tree created by this test if normal close failed.
  if (child.pid && child.exitCode === null)
    await promisify(execFile)("taskkill", [
      "/pid",
      String(child.pid),
      "/t",
      "/f",
    ]).catch(() => {});
  await rm(data, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
