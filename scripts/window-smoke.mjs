import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  copyFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { _electron as electron } from "playwright";

const temporary = await mkdtemp(path.join(os.tmpdir(), "agentview-window-"));
const directory =
  process.env.AGENTVIEW_PACKAGED_HOST || "out/host/win-unpacked";
const executable = path.resolve(directory, "AgentView Host.exe");
const args = ["--role=host"];
const env = { ...process.env, AGENTVIEW_DATA_DIR: temporary };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  // A broken configuration must not prevent window controls or recovery.
  await writeFile(path.join(temporary, "settings.json"), "invalid settings");
  const started = performance.now();
  app = await electron.launch({
    executablePath: executable,
    args: [...args, "--hidden"],
    env,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "AgentView Host", exact: true })
    .waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  console.log(
    `Hidden Host UI loaded in ${Math.round(performance.now() - started)} ms`,
  );
  let launcher = executable;
  let launchArgs = args;
  if (directory) {
    const source = path.resolve(directory, "resources/host-launcher.exe");
    if (
      await access(source).then(
        () => true,
        () => false,
      )
    ) {
      const install = path.join(temporary, "installed");
      await mkdir(install);
      // The managed launcher requires a target below its own directory.
      const { symlink } = await import("node:fs/promises");
      await symlink(
        path.resolve(directory),
        path.join(install, "version"),
        "junction",
      );
      await writeFile(
        path.join(install, "current.json"),
        "\ufeff" + JSON.stringify({ executable: "version/AgentView Host.exe" }),
      );
      launcher = path.join(install, "AgentView Host.exe");
      await copyFile(source, launcher);
      // Windows runner/user Temp paths can contain DOS short-name aliases.
      const shortPath = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:AGENTVIEW_TEST_LAUNCHER).ShortPath",
        ],
        {
          windowsHide: true,
          env: { ...env, AGENTVIEW_TEST_LAUNCHER: launcher },
        },
      );
      launcher = shortPath.stdout.trim();
      launchArgs = [];
    }
  }
  async function reopen(label, previousId) {
    const began = performance.now();
    const child = spawn(launcher, launchArgs, {
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let launchError = "";
    child.stderr.on("data", (bytes) => {
      launchError = (launchError + bytes).slice(-2000);
    });
    child.on("error", (error) => {
      launchError = error.message;
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const launchTimeout = setTimeout(() => child.kill(), 4000);
    await exited;
    clearTimeout(launchTimeout);
    assert.equal(
      child.exitCode,
      0,
      `${label}: launcher failed. ${launchError}`,
    );
    const deadline = Date.now() + 4000;
    while (
      !(await app.evaluate(({ BrowserWindow }, previousId) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          window &&
          window.id !== previousId &&
          window.isVisible() &&
          !window.isMinimized() &&
          !window.webContents.isCrashed()
        );
      }, previousId))
    ) {
      assert.ok(
        Date.now() < deadline,
        `${label}: window did not open within four seconds (launcher exit ${child.exitCode}). ${launchError}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    console.log(`${label}: ${Math.round(performance.now() - began)} ms`);
  }
  await reopen("Open hidden Host");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].minimize(),
  );
  await reopen("Restore minimized Host");
  for (let n = 0; n < 3; n++) {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await reopen(`Reopen closed-to-tray Host ${n + 1}`);
  }
  const recreatedPage = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].destroy(),
  );
  await reopen("Recreate missing Host window after hidden startup");
  let current = await recreatedPage;
  await current
    .getByRole("heading", { name: "AgentView Host", exact: true })
    .waitFor();
  await current.waitForLoadState("load");
  const oldId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
  );
  const recoveredPage = app.waitForEvent("window");
  await app.evaluate(
    ({ BrowserWindow }) =>
      new Promise((resolve) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        contents.once("render-process-gone", resolve);
        contents.forcefullyCrashRenderer();
      }),
  );
  await reopen("Recover crashed renderer", oldId);
  current = await recoveredPage;
  await current
    .getByRole("heading", { name: "AgentView Host", exact: true })
    .waitFor({ timeout: 5000 });
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  );
  console.log(
    "Host window lifecycle passed with unavailable backend settings.",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (app) {
    const timeout = setTimeout(() => app.process().kill(), 5000);
    await app.close().catch(() => {});
    clearTimeout(timeout);
  }
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
