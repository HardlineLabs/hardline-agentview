import { _electron as electron, chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const serial = process.env.AGENTVIEW_ANDROID_SERIAL;
if (!serial)
  throw new Error("Set AGENTVIEW_ANDROID_SERIAL to the intended test device.");
const adb = (...args) =>
  execFileSync("adb", ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const dir = path.resolve(".local/mobile-smoke");
const capture = async (name) => {
  // Android's compositor owns the accelerated canvas; CDP screenshots omit that layer.
  adb("shell", "screencap", "-p", "/sdcard/agentview-validation.png");
  adb("pull", "/sdcard/agentview-validation.png", path.join(dir, name));
};
const hostData = path.join(dir, "host");
await mkdir(hostData, { recursive: true });
const remoteAddress = process.env.AGENTVIEW_TEST_REMOTE || "";
const settings = {
  vaultPath:
    process.env.AGENTVIEW_TEST_VAULT ||
    path.join(process.env.USERPROFILE, "Desktop/hardline labs vault"),
  port: 43123,
  codexPath: "",
  autoStart: false,
  remoteAddress,
  ...(process.env.AGENTVIEW_TEST_TUNNEL
    ? {
        tunnelConfig: process.env.AGENTVIEW_TEST_TUNNEL,
        cloudflaredPath: process.env.AGENTVIEW_CLOUDFLARED || "cloudflared",
      }
    : {}),
};
await writeFile(path.join(hostData, "settings.json"), JSON.stringify(settings));
const env = { ...process.env, AGENTVIEW_DATA_DIR: hostData };
delete env.ELECTRON_RUN_AS_NODE;
let host, browser, desktop;
const errors = [];
try {
  assert.equal(adb("get-state"), "device");
  host = await electron.launch({ args: [process.cwd(), "--role=host"], env });
  const hw = await host.firstWindow();
  await hw.waitForFunction(
    async () => {
      const status = await window.agentview.invoke("host.status");
      return status.agentReady && status.running && status.notes > 0;
    },
    null,
    { timeout: 60_000 },
  );
  adb(
    "install",
    "-r",
    path.resolve("android/app/build/outputs/apk/debug/app-debug.apk"),
  );
  adb("shell", "am", "force-stop", "labs.hardline.agentview");
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  adb("shell", "am", "start", "-n", "labs.hardline.agentview/.MainActivity");
  let pid;
  for (let i = 0; i < 25; i++) {
    try {
      pid = adb("shell", "pidof", "labs.hardline.agentview");
    } catch {
      pid = "";
    }
    if (
      pid &&
      adb("shell", "cat", "/proc/net/unix").includes(
        `webview_devtools_remote_${pid}`,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 400));
  }
  adb("forward", "tcp:9433", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9433");
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".client-app");
  const status = await hw.evaluate(() =>
    window.agentview.invoke("host.status"),
  );
  let invite = await hw.evaluate(() =>
    window.agentview.invoke("host.invite", { name: "Android validation" }),
  );
  // Reset only this test app's connection, including any automatic startup reconnect.
  await page.evaluate(() => window.agentview.invoke("connection.disconnect"));
  await page.reload();
  await page.getByLabel("Connection key").waitFor();
  await capture("pairing.png");
  await page.getByLabel("Connection key").fill(invite.code);
  await page.getByRole("button", { name: "Connect to workspace" }).click();
  await page
    .locator(".connection-pill")
    .filter({ hasText: "Local" })
    .waitFor({ timeout: 25_000 });
  await page.getByLabel("Message your agent").waitFor();
  await page.getByLabel("Message your agent").fill("A draft worth keeping");
  await capture("chat.png");
  await page.locator(".mobile-live").click();
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await page.waitForTimeout(1000);
  const pixels = await page.locator("canvas").evaluate((canvas) => {
    const bytes = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i] > 80) lit++;
    return lit;
  });
  assert.ok(pixels > 500, "The graph renders visible nodes and connections");
  await capture("brain.png");
  await page
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Message your agent").inputValue(),
    "A draft worth keeping",
  );
  await page.getByRole("button", { name: "Open conversations" }).click();
  await capture("drawer.png");
  if (await page.locator(".thread").count()) {
    await page.locator(".thread").first().click();
    await page.locator(".context-usage").waitFor();
    await page.locator(".turn").first().waitFor({ timeout: 30000 });
    await capture("conversation.png");
    await page.getByRole("button", { name: "Open conversations" }).click();
  }
  if (remoteAddress) {
    await page.getByRole("button", { name: "Workspace settings" }).click();
    await page
      .getByRole("button", { name: "Disconnect & change host" })
      .click();
    invite = await hw.evaluate(() =>
      window.agentview.invoke("host.invite", {
        name: "Android remote validation",
      }),
    );
    await page.getByLabel("Connection key").fill(invite.code);
    await page
      .locator("summary")
      .filter({ hasText: "Use a different" })
      .click();
    // Only make LAN unreachable. The native socket must use the actual public Cloudflare route.
    await page.getByLabel("Host address").fill("127.0.0.1:1");
    await page.getByRole("button", { name: "Connect to workspace" }).click();
    await page
      .locator(".connection-pill")
      .filter({ hasText: "Remote" })
      .waitFor({ timeout: 40_000 });
    await capture("remote.png");
    await page.reload();
    await page
      .locator(".connection-pill")
      .filter({ hasText: "Remote" })
      .waitFor({ timeout: 30_000 });
    assert.equal(await page.locator(".chat-panel").isVisible(), true);
    desktop = await electron.launch({
      args: [process.cwd(), "--role=client"],
      env: { ...env, AGENTVIEW_DATA_DIR: path.join(dir, "desktop-client") },
    });
    const desktopPage = await desktop.firstWindow();
    const desktopInvite = await hw.evaluate(() =>
      window.agentview.invoke("host.invite", {
        name: "Desktop remote validation",
      }),
    );
    await desktopPage.evaluate(
      (code) =>
        window.agentview.invoke("connection.connect", {
          code,
          address: "127.0.0.1:1",
        }),
      desktopInvite.code,
    );
    await desktopPage
      .locator(".connection-pill")
      .filter({ hasText: "Remote" })
      .waitFor({ timeout: 30000 });
    assert.equal(
      (await desktopPage.evaluate(() => window.agentview.invoke("snapshot")))
        .graph.nodes.length,
      status.notes,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      device: adb("shell", "getprop", "ro.product.model"),
      notes: status.notes,
      remote: Boolean(remoteAddress),
      checks: [
        "native TLS and secure pairing",
        "chat and graph navigation",
        "draft retained",
        "conversation drawer",
        "context usage",
        ...(remoteAddress
          ? ["public Cloudflare route", "secure storage across reload"]
          : []),
      ],
    }),
  );
} finally {
  await desktop?.close().catch(() => {});
  await browser?.close().catch(() => {});
  try {
    adb("forward", "--remove", "tcp:9433");
  } catch {
    /* No forwarding if startup failed. */
  }
  adb("shell", "rm", "-f", "/sdcard/agentview-validation.png");
  await host?.close().catch(() => {});
}
