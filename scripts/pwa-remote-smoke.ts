import assert from "node:assert/strict";
import { pairingRequest } from "../src/shared/pairing-code";
import { checkRemotePairing } from "../src/host/remote-pairing";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Resolver } from "node:dns/promises";
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
let tunnelLog = "";
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
    const read = (chunk: Buffer) => {
      tunnelLog = (tunnelLog + chunk.toString()).slice(-12000);
      const match = tunnelLog.match(
        /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/,
      );
      if (match && tunnelLog.includes("Registered tunnel connection")) {
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
  const resolverAddress = process.env.AGENTVIEW_TEST_DNS;
  const browserArgs: string[] = [];
  if (resolverAddress) {
    const resolver = new Resolver();
    resolver.setServers([resolverAddress]);
    const hostname = new URL(endpoint).hostname;
    const deadline = Date.now() + 45_000;
    let address: string | undefined;
    while (!address) {
      [address] = await resolver.resolve4(hostname).catch(() => []);
      if (!address && Date.now() > deadline)
        throw new Error(
          "Test hostname did not resolve through the requested DNS server.",
        );
      if (!address) await delay(2000);
    }
    browserArgs.push(`--host-resolver-rules=MAP ${hostname} ${address}`);
    console.log(
      "Test DNS override: Chromium only; TLS still validates the public hostname.",
    );
  }
  host.settings.remoteAddress = endpoint;
  for (const engine of resolverAddress ? [chromium] : [chromium, webkit]) {
    const browser = await engine.launch({ args: browserArgs });
    try {
      // Normal public TLS validation on both the Site and the WSS endpoint.
      const context = await browser.newContext({ ...devices["iPhone 13"] });
      const page = await context.newPage();
      // Registration may precede DNS and edge readiness. Probe in the browser
      // that will make the connection, using its normal TLS verification.
      const deadline = Date.now() + 30_000;
      while (true) {
        const response = await page
          .goto(endpoint.replace("wss:", "https:"), { timeout: 5000 })
          .catch(() => undefined);
        if (response?.status() === 404) break;
        if (Date.now() > deadline)
          throw new Error(
            `Public test tunnel is not reachable in ${engine.name()}.\n${tunnelLog.slice(-2000)}`,
          );
        await delay(1000);
      }
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
      await page.getByLabel("Pairing code", { exact: true }).waitFor();
      const invitation = await host.createInvitation("Public PWA verification");
      if (!process.env.AGENTVIEW_TEST_DNS)
        await checkRemotePairing(host.localConnection());
      const published = await pairingRequest(
        "publish",
        {
          invitation: invitation.code,
          expiresAt: invitation.expiresAt,
          token: randomBytes(32).toString("hex"),
        },
        new URL("/api/pair", url).href,
      );
      await page
        .getByLabel("Pairing code", { exact: true })
        .fill(published.code);
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
      if (engine === chromium) {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForFunction(() =>
          Boolean(navigator.serviceWorker.controller),
        );
        await context.setOffline(true);
        await page.reload();
        await page.locator(".browser-app").waitFor();
        await context.setOffline(false);
        await page
          .locator(".connection-pill:not(.lost)")
          .waitFor({ timeout: 35000 });
      }
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
