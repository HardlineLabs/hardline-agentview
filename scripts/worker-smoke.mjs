// Verify the packaged runtime owner independently of the tray and network host.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline";
const temporary = await mkdtemp(path.join(os.tmpdir(), "agentview-worker-"));
const vault = path.join(temporary, "vault"),
  data = path.join(temporary, "host");
await mkdir(vault);
await mkdir(data);
await writeFile(
  path.join(vault, "Home.md"),
  "# Isolated runtime lifecycle test",
);
await writeFile(
  path.join(data, "settings.json"),
  JSON.stringify({
    vaultPath: vault,
    codexPath: "",
    port: 0,
    autoStart: false,
  }),
);
const env = { ...process.env, AGENTVIEW_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
let app, page, pid, hostPid, socket, testThread;
const pending = new Map();
let requestId = 0;
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
function stopRenderers() {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe', 'AgentView Host.exe') -and $_.CommandLine -and $_.CommandLine.Contains($env:AGENTVIEW_TEST_PROFILE) -and $_.CommandLine.Contains('--type=') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ],
    {
      env: { ...process.env, AGENTVIEW_TEST_PROFILE: data },
      windowsHide: true,
    },
  );
}
async function launch() {
  app = await electron.launch({
    ...(process.env.AGENTVIEW_PACKAGED === "1"
      ? {
          executablePath: path.join(
            process.cwd(),
            "out/host/win-unpacked/AgentView Host.exe",
          ),
          args: ["--hidden"],
        }
      : { args: [process.cwd(), "--role=host", "--hidden"] }),
    env,
  });
  hostPid = await app.evaluate(() => process.pid);
  page = await app.firstWindow();
  const deadline = Date.now() + 60000;
  while (
    !(await page.evaluate(() => window.agentview.invoke("host.status")))
      .agentReady
  ) {
    if (Date.now() > deadline) throw new Error("Host did not become ready");
    await new Promise((r) => setTimeout(r, 500));
  }
}
try {
  await launch();
  console.log("Host launched");
  const diagnostics = await Promise.race([
    page.evaluate(() => window.agentview.invoke("host.diagnostics")),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Diagnostics timed out")), 15000),
    ),
  ]);
  console.log(
    "Diagnostics received",
    JSON.stringify({
      persistent: diagnostics.persistentRuntime,
      runtime: diagnostics.runtime,
      data: await app.evaluate(({ app }) => app.getPath("userData")),
    }),
  );
  assert.equal(diagnostics.persistentRuntime, true);
  pid = diagnostics.runtime.pid;
  const before = JSON.parse(
    await readFile(path.join(data, "runtime-endpoint.json"), "utf8"),
  );
  assert.ok(before.pipe && before.token);
  socket = net.connect(before.pipe);
  createInterface({ input: socket }).on("line", (line) => {
    const message = JSON.parse(line),
      request = pending.get(message.id);
    if (!message.method && request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  await rpc("runtime/attach", { token: before.token });
  if (process.env.AGENTVIEW_LIVE_TEST === "1") {
    const result = await rpc("thread/start", {
      cwd: vault,
      ephemeral: false,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
    testThread = result.thread.id;
    await rpc("turn/start", {
      threadId: testThread,
      sandboxPolicy: { type: "dangerFullAccess" },
      approvalPolicy: "never",
      input: [
        {
          type: "text",
          text: `Bounded runtime lifecycle test: run one shell command which waits 15 seconds then writes the exact text SURVIVED to ${path.join(vault, "survived.txt")}. Change no other files and perform no other tasks. Reply done afterward.`,
        },
      ],
    });
    assert.ok(
      (await rpc("runtime/state")).turns.some(([id]) => id === testThread),
    );
    await assert.rejects(rpc("runtime/shutdown"), /active work/);
  }
  process.kill(hostPid);
  app = undefined;
  hostPid = undefined;
  stopRenderers();
  await new Promise((r) => setTimeout(r, 1000));
  console.log("Host stopped; checking runtime");
  process.kill(pid, 0);
  await launch();
  assert.equal(
    (await page.evaluate(() => window.agentview.invoke("host.diagnostics")))
      .runtime.pid,
    pid,
  );
  const after = JSON.parse(
    await readFile(path.join(data, "runtime-endpoint.json"), "utf8"),
  );
  assert.equal(after.pipe, before.pipe);
  assert.equal(after.token, before.token);
  if (testThread) {
    const deadline = Date.now() + 180000;
    while (
      (await rpc("runtime/state")).turns.some(([id]) => id === testThread)
    ) {
      if (Date.now() > deadline) throw new Error("Live turn did not finish");
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(
      (await readFile(path.join(vault, "survived.txt"), "utf8")).trim(),
      "SURVIVED",
    );
    const history = await rpc("thread/read", {
      threadId: testThread,
      includeTurns: true,
    });
    assert.ok(history.thread.turns.some((turn) => turn.status === "completed"));
    await rpc("thread/delete", { threadId: testThread });
    testThread = undefined;
    console.log(
      "Active agent turn survived the Host crash and completed with persisted history",
    );
  }
  await page.evaluate(() => window.agentview.invoke("host.stopRuntime"));
  console.log(
    "Independent runtime: authenticated attach, tray shutdown, restart and explicit shutdown passed",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (testThread && socket) {
    try {
      const state = await rpc("runtime/state");
      const active = state.turns.find(([id]) => id === testThread);
      if (active) {
        await rpc("turn/interrupt", {
          threadId: testThread,
          turnId: active[1],
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      await rpc("thread/delete", { threadId: testThread });
    } catch {}
  }
  socket?.destroy();
  if (app) {
    await Promise.race([
      page
        ?.evaluate(() => window.agentview.invoke("host.stopRuntime"))
        .catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  if (hostPid) {
    try {
      process.kill(hostPid);
    } catch {}
  }
  if (pid) {
    try {
      process.kill(pid);
    } catch {}
  }
  stopRenderers();
  await new Promise((r) => setTimeout(r, 1600));
  await rm(temporary, { recursive: true, force: true });
}
