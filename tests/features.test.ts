import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HostService } from "../src/host/service";
import { HostFeatures } from "../src/host/features";
import { WorkspaceFiles } from "../src/host/files";
import { Codex } from "../src/host/codex";
import { validateSubscription } from "../src/host/push";

test("durable requests survive restart and never repeat accepted or uncertain mutations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-receipts-"));
  let calls = 0;
  const make = () =>
    new HostFeatures(
      root,
      new Codex(),
      () => [],
      async () => {
        calls++;
        return { id: "durable-thread" };
      },
      () => {},
      () => false,
      async () => {},
    );
  try {
    const first = make();
    await first.load();
    const request = {
      requestId: "request-1234567890",
      method: "thread.create",
      params: {},
    };
    assert.equal(
      (await first.handle("request.execute", request, "phone")).id,
      "durable-thread",
    );
    const second = make();
    await second.load();
    assert.equal(
      (await second.handle("request.execute", request, "phone")).id,
      "durable-thread",
    );
    assert.equal(calls, 1);
    await assert.rejects(
      second.handle(
        "request.execute",
        { ...request, params: { model: "other" } },
        "phone",
      ),
      /another action/,
    );
    assert.equal(
      (await second.handle("request.status", request, "different-phone")).state,
      "missing",
    );
    const receipts = JSON.parse(
      await readFile(path.join(root, "requests.json"), "utf8"),
    );
    receipts["phone:pending-123456789"] = {
      state: "pending",
      signature: "test",
      time: Date.now(),
    };
    await writeFile(path.join(root, "requests.json"), JSON.stringify(receipts));
    const third = make();
    await third.load();
    assert.equal(
      (
        await third.handle(
          "request.status",
          { requestId: "pending-123456789" },
          "phone",
        )
      ).state,
      "uncertain",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace files bound paths and ranges, and attachments preserve bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-files-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "sample.txt"), "abcdefgh");
  await writeFile(path.join(root, "outside.txt"), "private");
  const files = new WorkspaceFiles(path.join(root, "data"), () => [
    { id: "test", name: "Test", path: workspace },
  ]);
  try {
    const result = await files.read("test", "sample.txt", 2, 3);
    assert.equal(Buffer.from(result.data, "base64").toString(), "cde");
    assert.equal(result.nextOffset, 5);
    await assert.rejects(
      files.read("test", "../outside.txt"),
      /inside this workspace/,
    );
    await assert.rejects(
      files.read("missing", "sample.txt"),
      /Unknown workspace/,
    );
    await assert.rejects(
      files.read("test", "sample.txt", -1),
      /Invalid file range/,
    );
    const uploaded = await files.upload(
      "photo.png",
      Buffer.from("test-pixels").toString("base64"),
      "image/png",
    );
    assert.equal(
      (await readFile(await files.attachment(uploaded.id))).toString(),
      "test-pixels",
    );
    await assert.rejects(files.attachment("../outside"), /Invalid attachment/);
    await assert.rejects(
      files.upload("big", "a".repeat(8 * 1024 * 1024 + 1), ""),
      /6 MB/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("permissions, rename, bulk results, legacy persistence and image input reach runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-api-"));
  await writeFile(path.join(root, "Home.md"), "# Test");
  const host = new HostService(
    { vaultPath: root, codexPath: "", port: 0, autoStart: false },
    path.join(root, "data"),
  );
  const threads: any[] = ["one", "busy"].map((id) => ({
    id,
    preview: id,
    cwd: root,
    createdAt: 1,
    updatedAt: 1,
    status: { type: id === "busy" ? "active" : "idle" },
    ephemeral: false,
  }));
  const calls: any[] = [];
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async (method, p) => {
    calls.push({ method, p });
    if (method === "thread/list") return { data: p.archived ? [] : threads };
    if (method === "thread/start") return { thread: threads[0] };
    if (method === "thread/name/set") {
      threads[0].name = p.name;
      return {};
    }
    if (method === "thread/read")
      return {
        thread: {
          ...threads.find((t) => t.id === p.threadId),
          turns: [
            {
              id: "old",
              status: "completed",
              items: [
                { id: "answer", type: "agentMessage", text: "Saved response" },
              ],
            },
          ],
        },
      };
    if (method === "thread/turns/list")
      throw new Error("Unsupported pagination");
    if (method === "turn/start")
      return { turn: { id: "new", status: "inProgress", items: [] } };
    return { data: [] };
  };
  try {
    await host.start();
    await host.connectAgent();
    await host.handle("host.preferences.update", {
      defaultPermissions: "full",
      onboarding: "Read the workspace guide.",
    });
    await host.handle("thread.create", {});
    assert.equal(
      calls.find((c) => c.method === "thread/start").p.sandbox,
      "danger-full-access",
    );
    assert.equal(
      calls.find((c) => c.method === "thread/start").p.ephemeral,
      false,
    );
    assert.equal(
      calls.find((c) => c.method === "thread/start").p.historyMode,
      undefined,
    );
    await host.handle("thread.rename", { id: "one", name: "Renamed" });
    assert.equal(
      (await host.handle("thread.read", { id: "one" })).turns[0].items[0].text,
      "Saved response",
    );
    const uploaded = await host.handle("files.upload", {
      name: "photo.png",
      data: "dGVzdA==",
      mime: "image/png",
    });
    await host.handle("thread.send", {
      id: "one",
      text: "Inspect",
      attachments: [uploaded],
    });
    const turn = calls.find((c) => c.method === "turn/start");
    assert.equal(turn.p.approvalPolicy, "never");
    assert.equal(turn.p.sandboxPolicy.type, "dangerFullAccess");
    assert.equal(turn.p.input[1].type, "localImage");
    assert.ok(path.isAbsolute(turn.p.input[1].path));
    const bulk = await host.handle("thread.bulk", {
      ids: ["one", "busy", "gone"],
      action: "archive",
    });
    assert.ok(bulk.results.every((r: any) => !r.ok));
    await assert.rejects(
      host.handle("thread.bulk", { ids: ["one"], action: "delete" }),
      /Confirm/,
    );
    assert.equal(
      (await host.handle("thread.recovery", { id: "one" })).persisted,
      true,
    );
  } finally {
    await host.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("push subscription rejects arbitrary endpoints and credentials", () => {
  const keys = { auth: "test", p256dh: "test" };
  assert.throws(
    () => validateSubscription({ endpoint: "https://127.0.0.1/private", keys }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      validateSubscription({
        endpoint: "https://web.push.apple.com.attacker.example/test",
        keys,
      }),
    /Unsupported/,
  );
  assert.equal(
    validateSubscription({ endpoint: "https://web.push.apple.com/test", keys })
      .endpoint,
    "https://web.push.apple.com/test",
  );
});

test("queued follow-ups wait for current work and retain completion across restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-queue-"));
  const codex = new Codex();
  codex.ready = true;
  let active = true,
    sends = 0;
  const make = () =>
    new HostFeatures(
      root,
      codex,
      () => [],
      async (method) => {
        if (method === "thread.read")
          return { thread: { owned: true }, turns: [] };
        sends++;
        active = true;
        return { threadId: "one", turn: { id: "queued-turn" } };
      },
      () => {},
      () => active,
      async () => {},
    );
  try {
    const first = make();
    await first.load();
    const job = await first.handle("queue.add", {
      id: "one",
      text: "Follow up",
    });
    assert.equal(job.state, "waiting");
    assert.equal(sends, 0);
    active = false;
    await first.drain();
    assert.equal(job.state, "running");
    assert.equal(sends, 1);
    active = false;
    await first.completed("one", { id: "queued-turn", status: "completed" });
    const second = make();
    await second.load();
    await second.reconcile();
    assert.equal(second.jobs[0].state, "completed");
    assert.equal(sends, 1);
    await assert.rejects(
      second.handle("queue.cancel", { id: job.id }),
      /waiting/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
