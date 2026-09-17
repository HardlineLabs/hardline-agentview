import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { makeClientHost } from "./client-fixture";

const artifact = process.env.AGENTVIEW_UI_TEST_ARTIFACT;
if (!artifact)
  throw new Error(
    "Set AGENTVIEW_UI_TEST_ARTIFACT to a signed UI bundle directory.",
  );
const envelope = JSON.parse(
  await readFile(path.join(artifact, "latest.json"), "utf8"),
);
const manifest = JSON.parse(
  Buffer.from(envelope.payload, "base64").toString("utf8"),
);
const bundle = (await readFile(path.join(artifact, manifest.bundle))).toString(
  "base64",
);
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "agentview-update-smoke-"),
);
const data = path.join(temporary, "client");
const host = await makeClientHost(temporary, "Update");
let app: ElectronApplication | undefined;
const errors: string[] = [];
async function launch(offline = false) {
  const env = { ...process.env, AGENTVIEW_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.AGENTVIEW_PACKAGED_CLIENT
      ? {
          executablePath: path.resolve(process.env.AGENTVIEW_PACKAGED_CLIENT),
          args: [],
        }
      : { args: [".", "--role=client"] }),
    env,
  });
  await app.context().addInitScript("globalThis.__name = (value) => value");
  await app.evaluate("globalThis.__name = (value) => value");
  // Inject only the network boundary in the test process. The shipped updater still
  // verifies the actual production signature, bytes and native bridge version.
  await app.evaluate(
    async (_electron, fixture) => {
      globalThis.fetch = async (input) => {
        if (fixture.offline) throw new Error("Test update network is offline.");
        return new Response(
          String(input).endsWith("latest.json")
            ? JSON.stringify(fixture.envelope)
            : Buffer.from(fixture.bundle, "base64"),
        );
      };
    },
    { envelope, bundle, offline },
  );
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate("globalThis.__name = (value) => value");
  return page;
}
try {
  const thread = await host.handle("thread.create", {});
  await host.handle("thread.rename", {
    id: thread.id,
    name: "Update continuity",
  });
  let page = await launch();
  await page
    .getByLabel("Connection key", { exact: true })
    .fill((await host.createInvitation("UI update test")).code);
  await page
    .getByRole("button", { name: "Connect to workspace", exact: true })
    .click();
  await page.locator(".connection-pill:not(.lost)").waitFor();
  await page
    .locator(".thread-list button")
    .filter({ hasText: "Update continuity" })
    .click();
  await page
    .getByLabel("Message your agent")
    .fill("Draft across signed UI update");
  await page.locator('input[type="file"]').setInputFiles("assets/icon.png");
  await page.locator(".message-attachments img").waitFor();
  const pid = app!.process().pid;
  await page.getByRole("button", { name: "Update UI", exact: true }).click();
  await page.waitForURL(`**/${manifest.sha256}/index.html`);
  await page.locator(".connection-pill:not(.lost)").waitFor();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[aria-label="Message your agent"]',
        ) as HTMLTextAreaElement
      )?.value === "Draft across signed UI update",
  );
  await page.locator(".message-attachments img").waitFor();
  await page.getByText("UI updated.", { exact: true }).waitFor();
  assert.equal(
    app!.process().pid,
    pid,
    "UI update must keep the native process alive",
  );
  assert.equal(
    host.snapshot().threads.some((item) => item.id === thread.id),
    true,
  );
  const selection = JSON.parse(
    await readFile(path.join(data, "ui-updates", "selection.json"), "utf8"),
  );
  assert.equal(selection.pending, false);
  await page.getByRole("button", { name: "Update UI", exact: true }).click();
  await page.getByText("Your UI is up to date.", { exact: true }).waitFor();
  await mkdir("artifacts/ui-update-smoke", { recursive: true });
  await page.screenshot({ path: "artifacts/ui-update-smoke/updated.png" });
  await app!.close();
  page = await launch(true);
  await page.waitForURL(`**/${manifest.sha256}/index.html`);
  await page.locator(".connection-pill:not(.lost)").waitFor();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[aria-label="Message your agent"]',
        ) as HTMLTextAreaElement
      )?.value === "Draft across signed UI update",
  );
  await page.getByRole("button", { name: "Update UI", exact: true }).click();
  await page
    .getByText("Test update network is offline.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Message your agent").inputValue(),
    "Draft across signed UI update",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Signed desktop update: native process continuity, TLS connection, selected chat, draft/attachment preservation, current-version check and offline restart passed.",
  );
} finally {
  await app?.close();
  await host.stop();
  await rm(temporary, { recursive: true, force: true });
}
