// Opt-in: open the installed Host, click Pair, connect remotely, remove only the test device.
import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { ClientConnection } from "../src/electron/connection";
import { pairingRequest } from "../src/shared/pairing-code";
import { decodeConnection } from "../src/shared/pairing";
import { randomUUID } from "node:crypto";

async function main() {
  const executable = process.env.AGENTVIEW_PACKAGED_HOST;
  if (process.env.AGENTVIEW_LIVE_TEST !== "1" || !executable)
    throw new Error(
      "Set AGENTVIEW_LIVE_TEST=1 and AGENTVIEW_PACKAGED_HOST to the installed executable; stop Host first.",
    );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: executable,
    args: ["--role=host"],
    env,
  });
  const transport = app.process();
  let client: ClientConnection | undefined;
  let testDevice: string | undefined;
  let page;
  try {
    page = await app.firstWindow();
    const before = await page.evaluate(() =>
      (window as any).agentview.invoke("host.status"),
    );
    const existing =
      before.devices?.map((device: any) => device.id).sort() || [];
    await page
      .getByPlaceholder("Device name")
      .fill("Installed pairing validation");
    // Click as soon as the local listener is ready, without waiting for the tunnel ourselves.
    await page
      .getByRole("button", { name: "Pair device", exact: true })
      .click();
    await page
      .getByLabel("Pairing code", { exact: true })
      .waitFor({ timeout: 45_000 });
    const code = (
      await page.getByLabel("Pairing code", { exact: true }).innerText()
    ).replace(/\s/g, "");
    assert.match(code, /^\d{6}$/);
    const claimed = await pairingRequest("claim", {
      code,
      claimId: randomUUID(),
    });
    const config = decodeConnection(claimed.invitation);
    client = new ClientConnection((paired) => {
      testDevice = paired.credentialId;
    });
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Public encrypted connection timed out")),
        15_000,
      );
      client!.on("event", (event) => {
        if (event.type === "snapshot") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    client.connect({ ...config, routePreference: "remote" });
    await connected;
    assert.ok(testDevice);
    const after = await page.evaluate(() =>
      (window as any).agentview.invoke("host.status"),
    );
    assert.equal(after.remoteStatus, "Connected");
    assert.deepEqual(
      after.devices
        .filter((device: any) => device.id !== testDevice)
        .map((device: any) => device.id)
        .sort(),
      existing,
    );
    console.log(
      "PASS: opened packaged Host, clicked Pair, claimed six-digit code and received an authenticated public WSS snapshot; existing devices preserved.",
    );
  } finally {
    client?.disconnect();
    if (testDevice && page)
      await page.evaluate(
        (id) => (window as any).agentview.invoke("host.revoke", { id }),
        testDevice,
      );
    // A detached worker may retain the debugger pipe after the transport exits.
    const closing = app.close();
    await Promise.race([
      closing,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    assert.notEqual(transport.exitCode, null, "Host transport did not exit");
  }
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
