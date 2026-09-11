import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, webkit, devices, type Page } from "playwright";
import QRCode from "qrcode";
import { DatabaseSync } from "node:sqlite";
import { randomInt, randomBytes } from "node:crypto";
import { PairingRegistry, type Sql } from "../src/pairing/registry";
import { HostService, encodeConnection } from "../src/host/service";

// Real host TLS, pairing, encryption, storage and browser UI; only the agent
// runtime is a deterministic fixture. Never uses the developer's vault/account.
const temporary = await mkdtemp(path.join(os.tmpdir(), "agentview-pwa-"));
const captures = process.env.AGENTVIEW_PWA_CAPTURES;
if (captures) await mkdir(captures, { recursive: true });
const hosts: HostService[] = [];
let updateVersion = false;
const pairingDb = new DatabaseSync(":memory:");
const pairingSql: Sql = {
  exec<T>(query: string, ...values: (string | number | null)[]) {
    const rows = pairingDb.prepare(query).all(...values) as T[];
    return { toArray: () => rows };
  },
};
const pairing = new PairingRegistry(pairingSql);
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  if (url.pathname.startsWith("/api/pair/")) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    let body = "";
    for await (const bytes of req) body += bytes;
    const result = pairing.handle(
      url.pathname.slice("/api/pair/".length),
      JSON.parse(body),
      req.socket.remoteAddress || "fixture",
    );
    res
      .writeHead(result.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify(result.body));
    return;
  }
  if (url.pathname === "/index.html") {
    res.writeHead(308, { Location: "/" }).end();
    return;
  }
  const file = path.resolve(
    "dist/client",
    "." + (url.pathname === "/" ? "/index.html" : url.pathname),
  );
  if (!file.startsWith(path.resolve("dist/client") + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let bytes = await readFile(file);
    if (url.pathname === "/sw.js" && updateVersion)
      bytes = Buffer.from(
        bytes
          .toString()
          .replaceAll(/agentview-([a-f0-9]{16})/g, "agentview-test-update-$1"),
      );
    res
      .writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/`;
async function makeHost(name: string) {
  const root = path.join(temporary, name);
  const vault = path.join(root, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(
    path.join(vault, "Home.md"),
    `---\ntype: guide\ndomain: company\nstatus: current\n---\n# ${name} workspace\n\n[[Ideas]]\n`,
  );
  await writeFile(
    path.join(vault, "Ideas.md"),
    `---\ntype: reference\ndomain: agentview\nstatus: current\n---\n# ${name} ideas\n\nA private note for ${name}.\n`,
  );
  await writeFile(
    path.join(vault, "Large.md"),
    "# Large note\n" + "Workspace content. ".repeat(35000),
  );
  const host = new HostService(
    { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
    path.join(root, "host"),
  );
  const thread = {
    id: `${name}-thread`,
    name: `${name} conversation`,
    preview: "Plan a small useful project",
    cwd: vault,
    updatedAt: Date.now() / 1000,
    createdAt: Date.now() / 1000,
    status: { type: "idle" },
  };
  const fixtureThreads = new Map<string, any>([[thread.id, thread]]);
  const fixtureTurns = new Map<string, any[]>();
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async (method: string, params: any) => {
    if (method === "model/list")
      return {
        data: [
          {
            id: "fixture",
            model: "fixture",
            displayName: "Test agent",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "High" },
            ],
          },
        ],
      };
    if (method === "thread/list")
      return {
        data: [...fixtureThreads.values()].filter(
          (t) => Boolean(t.archived) === Boolean(params?.archived),
        ),
      };
    if (method === "thread/start") {
      const created = {
        ...thread,
        id: crypto.randomUUID(),
        name: "New fixture",
        preview: "",
        ephemeral: false,
      };
      fixtureThreads.set(created.id, created);
      fixtureTurns.set(created.id, []);
      return { thread: created };
    }
    if (method === "thread/name/set") {
      fixtureThreads.get(params.threadId).name = params.name;
      return {};
    }
    if (method === "thread/archive" || method === "thread/unarchive") {
      fixtureThreads.get(params.threadId).archived =
        method === "thread/archive";
      return {};
    }
    if (method === "thread/delete") {
      fixtureThreads.delete(params.threadId);
      return {};
    }
    if (method === "turn/start") {
      const turn = {
        id: crypto.randomUUID(),
        status: "inProgress",
        items: [
          {
            id: crypto.randomUUID(),
            type: "userMessage",
            content: params.input,
          },
        ],
      };
      fixtureTurns.set(params.threadId, [
        ...(fixtureTurns.get(params.threadId) || []),
        turn,
      ]);
      setTimeout(() => {
        turn.status = "completed";
        (turn.items as any[]).push({
          id: crypto.randomUUID(),
          type: "agentMessage",
          text: params.input.some((i: any) => i.type === "localImage")
            ? "Image received by the host runtime."
            : "Onboarding received by the host runtime.",
        });
        host.codex.emit("notification", {
          method: "turn/completed",
          params: { threadId: params.threadId, turn },
        });
      }, 150);
      return { turn };
    }
    if (method === "thread/read") {
      return { thread: fixtureThreads.get(params.threadId) };
    }
    if (method === "thread/turns/list" && fixtureTurns.has(params.threadId))
      return {
        data: [...fixtureTurns.get(params.threadId)!].reverse(),
        nextCursor: null,
      };
    if (method === "thread/turns/list")
      return {
        data: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "message-1",
                type: "agentMessage",
                text: `Welcome to ${name}. Your workspace stays on this computer.`,
              },
            ],
          },
        ],
        nextCursor: null,
      };
    if (method === "account/rateLimits/read")
      return {
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: Date.now() / 1000 + 7200,
          },
        },
      };
    return { data: [] };
  };
  await host.start();
  host.settings.remoteAddress = `wss://127.0.0.1:${host.settings.port}/`;
  hosts.push(host);
  return host;
}
const first = await makeHost("First");
const second = await makeHost("Second");
async function pair(page: Page, host: HostService) {
  const invitation = await host.createInvitation("PWA fixture");
  const code = randomInt(1_000_000).toString().padStart(6, "0");
  // Local TLS fixtures intentionally use loopback; public registrations reject it.
  pairingSql.exec(
    "INSERT INTO invitations VALUES (?, ?, ?, ?, NULL)",
    code,
    invitation.code,
    randomBytes(32).toString("hex"),
    invitation.expiresAt!,
  );
  await page.getByLabel("Pairing code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Connect to workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finding your workspace…", exact: true })
    .waitFor();
  await page
    .locator(".connection-pill:not(.lost)")
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".connection-pill").innerText(), "Remote");
}
async function disconnect(page: Page) {
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.getByRole("button", { name: "Disconnect & change host" }).click();
  await page.getByLabel("Pairing code", { exact: true }).waitFor();
}
async function expandedWorkspace(page: Page, engine: string) {
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByLabel("Default agent permissions").selectOption("full");
  await page.getByRole("status").filter({ hasText: "Default saved" }).waitFor();
  await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  await page
    .getByLabel("Default onboarding instruction")
    .fill("Read the workspace guide and summarize the product.");
  await page
    .getByRole("button", { name: "Save onboarding", exact: true })
    .click();
  await page
    .getByText("Onboarding instruction saved.", { exact: true })
    .waitFor();
  if (captures)
    await page.screenshot({
      path: path.join(captures, `${engine}-onboarding.png`),
    });
  await page.getByTitle("Close settings", { exact: true }).click();
  await page.getByTitle("New conversation", { exact: true }).click();
  await page
    .getByRole("button", { name: "Onboard agent", exact: true })
    .click();
  await page
    .getByText("Onboarding received by the host runtime.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Onboard agent", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Conversation name").fill(`${engine} renamed chat`);
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page
    .locator(".chat-heading h3")
    .filter({ hasText: `${engine} renamed chat` })
    .waitFor();
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
  await page.getByText("Saved in the host runtime", { exact: true }).waitFor();
  await page
    .locator(".recovery-card")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByLabel("Attach files or images", { exact: true })
    .setInputFiles("assets/icon.png");
  await page.waitForTimeout(1200);
  await page.locator(".message-attachments img").waitFor();
  await page.getByLabel("Message your agent").fill("Inspect this image");
  // Flush encrypted drafts before simulating a closed/reopened application.
  await page.waitForTimeout(250);
  await page.reload();
  await page.locator(".message-attachments img").waitFor();
  assert.equal(
    await page.getByLabel("Message your agent").inputValue(),
    "Inspect this image",
  );
  await page.getByTitle("Send message", { exact: true }).click();
  await page
    .getByText("Image received by the host runtime.", { exact: true })
    .waitFor();
  if (captures)
    await page.screenshot({
      path: path.join(captures, `${engine}-image-chat.png`),
    });
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select conversations", exact: true })
    .click();
  await page
    .locator(".bulk-list label")
    .filter({ hasText: `${engine} renamed chat` })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Archive (1)", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Confirm bulk action" })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page
    .locator(".thread-list > button")
    .filter({ hasText: `${engine} renamed chat` })
    .waitFor();
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  await page
    .locator(".thread-list > button")
    .filter({ hasText: "First conversation" })
    .click();
  await page
    .getByLabel("Message your agent")
    .fill("Keep this conversation draft");
}
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    // The exemption applies only to these ephemeral local fixture certificates.
    // Production/public-path tests must use normal certificate validation.
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript("globalThis.__name = (value) => value");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const blocked = await context.newPage();
      await blocked.addInitScript(() => {
        Object.defineProperty(indexedDB, "open", { value: () => ({}) });
      });
      await blocked.goto(url);
      await blocked.getByLabel("Pairing code", { exact: true }).fill("123456");
      await blocked
        .getByRole("button", { name: "Connect to workspace", exact: true })
        .click();
      await blocked
        .getByRole("button", { name: "Finding your workspace…", exact: true })
        .waitFor();
      await blocked
        .getByRole("alert")
        .filter({ hasText: /Device storage is unavailable/ })
        .waitFor({ timeout: 12_000 });
      assert.equal(
        await blocked
          .getByRole("button", { name: "Connect to workspace", exact: true })
          .isEnabled(),
        true,
      );
      await blocked.close();
      await page.goto(url);
      await page.getByLabel("Pairing code", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "LAN", exact: true }).count(),
        0,
      );
      if (captures)
        await page.screenshot({
          animations: "disabled",
          path: path.join(captures, `${engine.name()}-start.png`),
        });
      await page
        .getByText("Have an older invitation or QR?", { exact: true })
        .click();
      await page.getByLabel("Connection key").fill("invalid");
      await page
        .getByRole("button", { name: "Connect to workspace", exact: true })
        .click();
      await page
        .getByText(
          "Use a new pairing invitation from AgentView Host 0.3 or later.",
        )
        .waitFor();
      const noRemote = first.localConnection();
      delete noRemote.remoteAddress;
      await page.getByLabel("Connection key").fill(encodeConnection(noRemote));
      await page
        .getByRole("button", { name: "Connect to workspace", exact: true })
        .click();
      await page
        .getByText(/The web app needs a secure remote endpoint/)
        .waitFor();
      await page.getByLabel("Connection key").fill("");
      if (captures)
        await page.screenshot({
          animations: "disabled",
          path: path.join(captures, `${engine.name()}-pairing.png`),
          fullPage: true,
        });
      await page
        .getByRole("button", { name: "Install app", exact: true })
        .click();
      await page.getByRole("dialog", { name: "Install AgentView" }).waitFor();
      await page.getByRole("button", { name: "Got it" }).click();
      if (engine === chromium) {
        const invite = await first.createInvitation("Camera fixture");
        const qr = await QRCode.toDataURL(invite.code, {
          width: 1000,
          margin: 4,
        });
        await page.evaluate(async (data) => {
          const image = new Image();
          image.src = data;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1000;
          canvas.getContext("2d")!.drawImage(image, 0, 0);
          setInterval(
            () => canvas.getContext("2d")!.drawImage(image, 0, 0),
            100,
          );
          Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
            configurable: true,
            value: async () => canvas.captureStream(10),
          });
        }, qr);
        await page
          .getByRole("button", { name: "Scan pairing invitation", exact: true })
          .click();
        await page
          .locator(".connection-pill:not(.lost)")
          .waitFor({ timeout: 20_000 });
        assert.equal(
          await page
            .getByRole("dialog", { name: "Scan pairing invitation" })
            .count(),
          0,
        );
      } else {
        await page.evaluate(() =>
          Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
              getUserMedia: async () => {
                throw new DOMException("Denied", "NotAllowedError");
              },
            },
          }),
        );
        await page
          .getByRole("button", { name: "Scan pairing invitation", exact: true })
          .click();
        await page.getByText(/Camera access was declined/).waitFor();
        await page
          .getByRole("button", {
            name: "Paste an invitation instead",
            exact: true,
          })
          .click();
        await pair(page, first);
      }
      const largeNote = await page.evaluate(() =>
        window.agentview!.invoke("note.read", { id: "Large.md" }),
      );
      assert.ok(
        largeNote.body.length > 600_000,
        "Large encrypted responses match native client limits",
      );
      await page.getByLabel("Message your agent").fill("A draft worth keeping");
      await page.locator(".mobile-live").click();
      await page
        .getByRole("button", { name: "Fit graph", exact: true })
        .click();
      await page.waitForFunction(() => {
        const canvas = document.querySelector("canvas")!;
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 80);
      });
      if (captures)
        await page.screenshot({
          animations: "disabled",
          path: path.join(captures, `${engine.name()}-brain.png`),
        });
      await page
        .getByRole("button", { name: "Back to conversation", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Message your agent").inputValue(),
        "A draft worth keeping",
      );
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await page.getByRole("button", { name: /First conversation/ }).click();
      await page
        .getByText("Welcome to First. Your workspace stays on this computer.")
        .waitFor();
      await page
        .getByLabel("Message your agent")
        .fill("Keep this conversation draft");
      if (captures)
        await page.screenshot({
          animations: "disabled",
          path: path.join(captures, `${engine.name()}-chat.png`),
        });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal overflow",
      );
      await context.setOffline(true);
      await page.locator(".connection-pill.lost").waitFor();
      await context.setOffline(false);
      await page
        .locator(".connection-pill:not(.lost)")
        .waitFor({ timeout: 20_000 });
      assert.equal(
        await page.getByLabel("Message your agent").inputValue(),
        "Keep this conversation draft",
      );
      for (const size of [
        { width: 320, height: 667 },
        { width: 932, height: 430 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForFunction(
          (height) =>
            Math.abs(
              document.querySelector(".browser-app")!.getBoundingClientRect()
                .height - height,
            ) < 2,
          size.height,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `No overflow at ${size.width}px`,
        );
        const composer = await page
          .getByLabel("Message your agent")
          .boundingBox();
        assert.ok(
          composer && composer.y + composer.height <= size.height,
          `Composer stays visible at ${size.width}px`,
        );
        const send = await page
          .getByTitle("Send message", { exact: true })
          .boundingBox();
        assert.ok(
          send && send.y + send.height <= size.height,
          `Send stays visible at ${size.width}px: ${JSON.stringify(send)}`,
        );
        if (captures)
          await page.screenshot({
            animations: "disabled",
            path: path.join(captures, `${engine.name()}-${size.width}.png`),
          });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const rawStorage = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open("agentview-device");
          r.onsuccess = () => resolve(r.result);
        });
        return new Promise<any>((resolve) => {
          const r = db
            .transaction("private")
            .objectStore("private")
            .get("connection");
          r.onsuccess = () => {
            resolve({
              sealed: r.result.data instanceof ArrayBuffer,
              plain: JSON.stringify(r.result),
            });
            db.close();
          };
        });
      });
      assert.equal(rawStorage.sealed, true);
      assert.ok(!rawStorage.plain.includes("secret"));
      await expandedWorkspace(page, engine.name());
      if (engine === chromium) {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForFunction(() =>
          Boolean(navigator.serviceWorker.controller),
        );
        updateVersion = true;
        await page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistration())!.update(),
        );
        await page
          .getByRole("button", { name: "Update & reload" })
          .waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: "Update & reload" }).click();
        await page.waitForEvent("load");
        await page
          .locator(".connection-pill:not(.lost)")
          .waitFor({ timeout: 20_000 });
        await page
          .getByText("Welcome to First. Your workspace stays on this computer.")
          .waitFor();
        assert.equal(
          await page.getByLabel("Message your agent").inputValue(),
          "Keep this conversation draft",
          "Update restores the selected conversation and its draft",
        );
        await context.setOffline(true);
        await page.reload();
        await page.locator(".browser-app").waitFor();
        await context.setOffline(false);
        await page
          .locator(".connection-pill:not(.lost)")
          .waitFor({ timeout: 35_000 });
      }
      await page.reload();
      await page
        .locator(".connection-pill:not(.lost)")
        .waitFor({ timeout: 20_000 });
      await disconnect(page);
      await pair(page, second);
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      assert.equal(
        await page.getByRole("button", { name: /First conversation/ }).count(),
        0,
      );
      await page.getByRole("button", { name: /Second conversation/ }).click();
      await page
        .getByText("Welcome to Second. Your workspace stays on this computer.")
        .waitFor();
      assert.equal(
        await page.getByLabel("Message your agent").inputValue(),
        "",
      );
      const clientDevice = second.status().devices!.at(-1)!;
      await second.revokeDevice(clientDevice.id);
      await page.locator(".connection-pill.lost").waitFor();
      await page
        .getByLabel("Message your agent")
        .fill("Cannot send after revocation");
      assert.equal(
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .isDisabled(),
        true,
      );
      await disconnect(page);
      await page.reload();
      await page.getByLabel("Pairing code", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `${engine.name()}: pairing, validation, encryption, graph, chat, reconnect, isolation, revocation${engine === chromium ? ", offline shell and draft-safe update" : ""} passed`,
      );
    } catch (error) {
      console.error(
        "UI state",
        (await page.locator("body").innerText()).slice(-5000),
      );
      console.error(
        engine.name(),
        await page
          .locator(".pwa-bar")
          .innerText({ timeout: 1000 })
          .catch(() => "no pwa bar"),
      );
      console.error(
        await page
          .locator(".scanner-backdrop")
          .innerText({ timeout: 1000 })
          .catch(() => "no scanner"),
      );
      console.error(
        await page
          .locator(".inline-error")
          .innerText({ timeout: 1000 })
          .catch(() => "no connection error"),
      );
      if (captures)
        await page.screenshot({
          path: path.join(captures, `${engine.name()}-failure.png`),
        });
      console.error(
        await page
          .locator(".pwa-bar")
          .ariaSnapshot({ timeout: 1000 })
          .catch(() => "no accessibility state"),
      );
      throw error;
    } finally {
      await browser.close();
    }
  }
} finally {
  await Promise.all(hosts.map((host) => host.stop()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
