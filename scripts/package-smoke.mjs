import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright";
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const directory = path.resolve(
  process.env.AGENTVIEW_PACKAGED_HOST || "out/host/win-unpacked",
);
const archive = path.join(directory, "resources/app.asar");
const entries = asar.listPackage(archive);
assert.ok(
  !entries.some((entry) => /[/\\]node_modules[/\\]/.test(entry)),
  "Dependency caches must not enter the packaged app",
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "agentview-packaged-"));
let app;
try {
  const vault = path.join(temporary, "vault");
  await mkdir(vault);
  await writeFile(path.join(vault, "Home.md"), "# Packaged host validation\n");
  const port = 43987;
  await writeFile(
    path.join(temporary, "settings.json"),
    JSON.stringify({
      vaultPath: vault,
      port,
      autoStart: false,
      codexPath: path.join(temporary, "missing-codex.exe"),
      remoteAddress: "wss://fixture.example.com/",
    }),
  );
  app = await electron.launch({
    executablePath: path.join(directory, "AgentView Host.exe"),
    args: ["--role=host"],
    env: { ...process.env, AGENTVIEW_DATA_DIR: temporary },
  });
  const window = await app.firstWindow();
  await window.waitForFunction(
    async () => (await window.agentview.invoke("host.status")).running,
  );
  const status = await window.evaluate(() =>
    window.agentview.invoke("host.status"),
  );
  assert.equal(status.settings.port, port);
  assert.equal(status.settings.remoteAddress, "wss://fixture.example.com/");
  const info = await window.evaluate(() => window.agentview.invoke("app.info"));
  assert.equal(info.version, require("../package.json").version);
  const invite = await window.evaluate(() =>
    window.agentview.invoke("host.invite", { name: "Fixture" }),
  );
  assert.ok(invite.code.startsWith("agentview://"));
  console.log(
    "Packaged Host: clean payload, saved remote configuration, listener and invitation passed.",
  );
} finally {
  await app?.close();
  await rm(temporary, { recursive: true, force: true });
}
