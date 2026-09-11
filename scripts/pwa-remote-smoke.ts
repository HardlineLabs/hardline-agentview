import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, webkit, devices } from "playwright";
import { HostService } from "../src/host/service";

const url = process.env.AGENTVIEW_PWA_URL;
if (!url || new URL(url).protocol !== "https:")
  throw new Error("Set AGENTVIEW_PWA_URL to the published HTTPS client.");
const root = await mkdtemp(path.join(os.tmpdir(), "agentview-public-check-"));
const vault = path.join(root, "vault");
await mkdir(vault);
await writeFile(
  path.join(vault, "Home.md"),
  "---\ntype: guide\ndomain: company\nstatus: current\n---\n# Remote validation workspace\n\nOnly synthetic test content.\n",
);
await writeFile(path.join(root, "tunnel.json"), "{}");
const host = new HostService(
  { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
  path.join(root, "host"),
);
host.codex.start = async () => {
  host.codex.ready = true;
};
host.codex.rpc = async () => ({ data: [] });
let tunnel: ChildProcess | undefined;
try {
  await host.start();
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Test tunnel did not start within 45 seconds.")),
      45_000,
    );
    tunnel = spawn(
      process.env.AGENTVIEW_CLOUDFLARED || "cloudflared",
      [
        "tunnel",
        "--config",
        path.join(root, "tunnel.json"),
        "--url",
        `https://127.0.0.1:${host.settings.port}`,
        "--origin-server-name",
        "localhost",
        "--origin-ca-pool",
        path.join(root, "host", "host-cert.pem"),
        "--no-autoupdate",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    const read = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-12000);
      const match = log.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/);
      if (match && log.includes("Registered tunnel connection")) {
        clearTimeout(timeout);
        resolve(`wss://${match[1]}/`);
      }
    };
    tunnel.stdout!.on("data", read);
    tunnel.stderr!.on("data", read);
    tunnel.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not start cloudflared."));
    });
    tunnel.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Test tunnel exited before becoming ready."));
    });
  });
  // Quick-tunnel DNS and edge routing can lag behind connector registration.
  const deadline = Date.now() + 30_000;
  while (true) {
    const response = await fetch(endpoint.replace("wss:", "https:"), {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    if (response?.status === 404) break;
    if (Date.now() > deadline)
      throw new Error("Public test tunnel did not become reachable.");
    await delay(1000);
  }
  host.settings.remoteAddress = endpoint;
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      // Normal public TLS validation on both the Site and the WSS endpoint.
      const context = await browser.newContext({ ...devices["iPhone 13"] });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("requestfailed", (request) =>
        console.error(
          engine.name(),
          request.url(),
          request.failure()?.errorText,
        ),
      );
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.getByLabel("Connection key").waitFor();
      const invitation = await host.createInvitation("Public PWA verification");
      await page.getByLabel("Connection key").fill(invitation.code);
      await page
        .getByRole("button", { name: "Connect to workspace", exact: true })
        .click();
      await page
        .locator(".connection-pill:not(.lost)")
        .waitFor({ timeout: 35_000 });
      const snapshot = await page.evaluate(() =>
        window.agentview!.invoke("snapshot"),
      );
      assert.equal(
        snapshot.graph.nodes[0].title,
        "Remote validation workspace",
      );
      const note = await page.evaluate(() =>
        window.agentview!.invoke("note.read", { id: "Home.md" }),
      );
      assert.match(note.body, /Only synthetic test content/);
      await page.reload();
      await page
        .locator(".connection-pill:not(.lost)")
        .waitFor({ timeout: 35_000 });
      await page.evaluate(() =>
        window.agentview!.invoke("connection.disconnect"),
      );
      assert.deepEqual(errors, []);
      console.log(
        `${engine.name()}: published HTTPS client paired, read encrypted workspace data and restored pairing through public WSS with normal certificate validation`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  if (tunnel && tunnel.exitCode === null) {
    const exited = new Promise((resolve) => tunnel!.once("exit", resolve));
    tunnel.kill();
    await exited;
  }
  await host.stop();
  await rm(root, { recursive: true, force: true });
}
