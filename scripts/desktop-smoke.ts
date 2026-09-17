import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { makeClientHost } from "./client-fixture";
import { longConversationSmoke } from "./pwa-performance-smoke";
import { autoApproveSmoke } from "./pwa-auto-approve-smoke";

const temporary = await mkdtemp(path.join(os.tmpdir(), "agentview-desktop-"));
const data = path.join(temporary, "client");
const host = await makeClientHost(temporary, "Desktop");
const other = await makeClientHost(temporary, "Other");
let app: ElectronApplication | undefined;
let page: Page;
const errors: string[] = [];
async function launch() {
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
  page = await app.firstWindow();
  await page.evaluate("globalThis.__name = (value) => value");
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
}
async function connected() {
  await page.locator(".connection-pill:not(.lost)").waitFor();
}
try {
  const thread = await host.handle("thread.create", {});
  await host.handle("thread.rename", {
    id: thread.id,
    name: "Desktop owned conversation",
  });
  await host.handle("host.preferences.update", { defaultPermissions: "full" });
  await launch();
  const invitation = await host.createInvitation("Desktop parity test");
  await page
    .getByLabel("Connection key", { exact: true })
    .fill(invitation.code);
  await page
    .getByRole("button", { name: "Connect to workspace", exact: true })
    .click();
  await connected();
  assert.equal(await page.locator(".connection-pill").innerText(), "Local");
  await page
    .locator(".thread-list button")
    .filter({ hasText: "Desktop owned conversation" })
    .click();
  await page.getByLabel("Message your agent").waitFor();
  await page.getByTitle("Attach files or images").waitFor();
  await page
    .getByRole("button", { name: "Auto-approve off", exact: true })
    .waitFor();
  const input = page.getByLabel("Message your agent");
  await input.fill("Protected desktop draft survives restart");
  await page.locator('input[type="file"]').setInputFiles("assets/icon.png");
  await page.locator(".message-attachments img").waitFor();
  // Wait for the encrypted write, then restart the actual native process.
  await page.waitForTimeout(500);
  const ciphertext = await readFile(path.join(data, "drafts.bin"), "utf8");
  assert.ok(!ciphertext.includes("Protected desktop draft"));
  await app!.close();
  await launch();
  await connected();
  await page.getByLabel("Message your agent").waitFor();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[aria-label="Message your agent"]',
        ) as HTMLTextAreaElement
      )?.value === "Protected desktop draft survives restart",
  );
  await page.locator(".message-attachments img").waitFor();
  await page.getByTitle("Send message", { exact: true }).click();
  await page
    .getByText("Image received by the host runtime.", { exact: true })
    .waitFor();
  await autoApproveSmoke(page, host, thread.id);
  assert.equal(await page.locator(".graph-scene").count(), 1);
  assert.ok(await page.locator(".window-bar").isVisible());
  const layout = await page.locator(".composer-draft").evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert.ok(layout.bottom <= layout.height);
  await longConversationSmoke(page, host);
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.getByText("No queued work.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable notifications", exact: true })
    .click();
  await page
    .getByText("Windows notifications enabled while AgentView is open.")
    .waitFor();
  await page
    .getByRole("button", { name: "Disable notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "Disconnect & change host" }).click();
  const second = await other.createInvitation("Host isolation test");
  await page.getByLabel("Connection key", { exact: true }).fill(second.code);
  await page
    .getByRole("button", { name: "Connect to workspace", exact: true })
    .click();
  await connected();
  await page
    .locator(".thread-list button")
    .filter({ hasText: "Other conversation" })
    .click();
  assert.equal(await page.getByLabel("Message your agent").inputValue(), "");
  assert.equal(await page.locator(".message-attachments img").count(), 0);
  await mkdir("artifacts/desktop-parity", { recursive: true });
  await page.screenshot({ path: "artifacts/desktop-parity/client.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop parity: native TLS pairing, encrypted draft/attachment restart, send, approvals, tools, notifications, host isolation and layout passed.",
  );
} catch (error) {
  console.error(page! ? await page.locator("body").innerText() : error);
  throw error;
} finally {
  await app?.close();
  await host.stop();
  await other.stop();
  await rm(temporary, { recursive: true, force: true });
}
