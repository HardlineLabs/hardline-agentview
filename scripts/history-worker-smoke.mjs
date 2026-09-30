// Read-only check against existing history through an isolated execution worker.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const threadId = process.env.AGENTVIEW_HISTORY_THREAD;
const executable = process.env.AGENTVIEW_CODEX_EXECUTABLE;
assert.ok(
  threadId && executable,
  "Set AGENTVIEW_HISTORY_THREAD and AGENTVIEW_CODEX_EXECUTABLE; this only reads that existing chat.",
);
const root = await mkdtemp(path.join(os.tmpdir(), "agentview-history-worker-"));
const token = randomBytes(32).toString("hex");
const pipe =
  "\\\\.\\pipe\\agentview-history-" + randomBytes(20).toString("hex");
await writeFile(
  path.join(root, "runtime-endpoint.json"),
  JSON.stringify({ pipe, token }),
);
const worker = spawn(
  process.execPath,
  [path.resolve("dist/electron/runtime.cjs"), root, executable],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
let id = 0;
const pending = new Map();
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timeout: ${method}`));
    }, 60000);
    pending.set(requestId, { resolve, reject, timer });
    socket.write(JSON.stringify({ id: requestId, method, params }) + "\n");
  });
}
try {
  for (let tries = 0; tries < 100; tries++) {
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = net.connect(pipe);
        candidate.once("connect", () => {
          candidate.off("error", reject);
          resolve(candidate);
        });
        candidate.once("error", reject);
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(socket, "Isolated worker started");
  socket.on("error", () => {});
  socket.on("close", () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Worker pipe closed"));
    }
    pending.clear();
  });
  createInterface({ input: socket }).on("line", (line) => {
    const message = JSON.parse(line);
    const p = pending.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error.message));
    else p.resolve({ result: message.result, bytes: Buffer.byteLength(line) });
  });
  const attached = await rpc("runtime/attach", { token });
  assert.equal(attached.result.historyPaging, true);
  let cursor = null,
    pages = 0,
    items = 0,
    maximum = 0;
  const seen = new Set();
  const start = Date.now();
  do {
    const page = await rpc("runtime/history/page", { threadId, cursor });
    assert.ok(page.bytes <= 256 * 1024, `Page is ${page.bytes} bytes`);
    maximum = Math.max(maximum, page.bytes);
    for (const turn of page.result.data)
      for (const item of turn.items) {
        const key = `${turn.id}/${item.id}`;
        assert.equal(seen.has(key), false, "No repeated history items");
        seen.add(key);
        items++;
      }
    cursor = page.result.nextCursor;
    pages++;
    assert.ok(pages < 10000);
    await rpc("runtime/state");
  } while (cursor);
  const reopened = await rpc("runtime/history/page", {
    threadId,
    cursor: null,
  });
  assert.ok(reopened.bytes <= 256 * 1024);
  await rpc("runtime/state");
  console.log(
    JSON.stringify({
      pages,
      items,
      maximumResponseBytes: maximum,
      elapsedMs: Date.now() - start,
      reopen: "passed",
      pipe: "connected",
    }),
  );
  await rpc("runtime/shutdown");
  await new Promise((resolve) => worker.once("exit", resolve));
} finally {
  socket?.destroy();
  // Only our isolated, idle worker. Never touches the installed Host or its runtime.
  if (worker.exitCode === null) worker.kill();
  for (const p of pending.values()) clearTimeout(p.timer);
  const resolved = path.resolve(root);
  assert.ok(
    resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith("agentview-history-worker-"),
  );
  await rm(resolved, { recursive: true, force: true });
}
