import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HostService } from "../src/host/service";
import { automaticApproval } from "../src/host/permissions";

test("auto-approval accepts only complete, supported permission decisions", () => {
  const request = (method: string, params = {}) =>
    automaticApproval({ id: "a", method, params });
  assert.deepEqual(request("item/commandExecution/requestApproval"), {
    decision: "accept",
  });
  assert.deepEqual(
    request("item/fileChange/requestApproval", {
      availableDecisions: ["accept", "decline"],
    }),
    { decision: "accept" },
  );
  assert.equal(
    request("item/commandExecution/requestApproval", {
      availableDecisions: ["decline"],
    }),
    undefined,
  );
  assert.equal(
    request("item/commandExecution/requestApproval", {
      availableDecisions: "accept",
    }),
    undefined,
  );
  assert.deepEqual(
    request("item/permissions/requestApproval", {
      permissions: { network: { enabled: true } },
    }),
    {
      permissions: { network: { enabled: true } },
      scope: "turn",
    },
  );
  assert.equal(request("item/permissions/requestApproval"), undefined);
  for (const method of [
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "future/requestApproval",
  ])
    assert.equal(
      request(method, { mode: "form", requestedSchema: { type: "object" } }),
      undefined,
    );
});

test("chat opt-in survives Host replacement, stays isolated, pauses outside Full Access and stops on opt-out", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-auto-approve-"));
  const vault = path.join(root, "vault");
  await mkdir(vault);
  await writeFile(path.join(vault, "Home.md"), "# Test workspace");
  await writeFile(
    path.join(root, "threads.json"),
    JSON.stringify(["chosen", "other"]),
  );
  const responses: { id: string | number; result: unknown }[] = [];
  const make = () => {
    const host = new HostService(
      { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
      root,
    );
    // No real runtime or account; only the transport and saved Host state are real.
    host.connectAgent = async () => {
      host.codex.ready = true;
    };
    host.codex.respond = (id, result) => {
      responses.push({ id, result });
    };
    host.features.notice = async () => {};
    host.refreshThreads = async () => {};
    return host;
  };
  let host = make();
  const emit = (
    id: string,
    threadId?: string,
    method = "item/commandExecution/requestApproval",
    extra = {},
  ) => {
    host.codex.emit("request", { id, method, params: { threadId, ...extra } });
  };
  try {
    await host.start();
    await assert.rejects(
      host.handle("thread.autoApprove", { id: "chosen", enabled: true }),
      /Full access/,
    );
    await host.handle("host.preferences.update", {
      defaultPermissions: "full",
    });
    await assert.rejects(
      host.handle("thread.autoApprove", { id: "external", enabled: true }),
      /AgentView chat/,
    );
    await assert.rejects(
      host.handle("thread.autoApprove", { id: "chosen", enabled: "true" }),
      /setting/,
    );
    emit("pending", "chosen");
    assert.equal(responses.length, 0);
    await host.handle("thread.autoApprove", { id: "chosen", enabled: true });
    assert.deepEqual(responses, [
      { id: "pending", result: { decision: "accept" } },
    ]);
    emit("isolated", "other");
    emit("unscoped");
    emit("question", "chosen", "item/tool/requestUserInput");
    emit("mcp", "chosen", "mcpServer/elicitation/request", { mode: "url" });
    assert.equal(responses.length, 1);
    emit("file", "chosen", "item/fileChange/requestApproval");
    assert.equal(responses.length, 2);
    await host.stop();
    host = make();
    await host.start();
    assert.deepEqual(host.snapshot().autoApproveThreads, ["chosen"]);
    emit("after-restart", "chosen");
    assert.equal(responses.length, 3);
    await host.handle("host.preferences.update", {
      defaultPermissions: "workspace",
    });
    emit("paused", "chosen");
    assert.equal(responses.length, 3);
    await host.handle("host.preferences.update", {
      defaultPermissions: "full",
    });
    // Opt-out is allowed while the runtime is unavailable, without starting work.
    assert.equal(
      responses.length,
      4,
      "Returning to Full access handles paused requests",
    );
    host.codex.ready = false;
    await host.handle("thread.autoApprove", { id: "chosen", enabled: false });
    host.codex.ready = true;
    emit("manual-again", "chosen");
    assert.equal(responses.length, 4);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, "auto-approve.json"), "utf8")),
      [],
    );
    host.codex.emit("notification", {
      method: "serverRequest/resolved",
      params: { threadId: "chosen", requestId: "paused" },
    });
    assert.ok(!host.snapshot().approvals.some((a) => a.id === "paused"));
    // Simultaneous client changes serialize, and the last acknowledged setting wins.
    await Promise.all([
      host.handle("thread.autoApprove", { id: "chosen", enabled: true }),
      host.handle("thread.autoApprove", { id: "chosen", enabled: false }),
    ]);
    assert.deepEqual(host.snapshot().autoApproveThreads, []);
    const count = responses.length;
    emit("after-race", "chosen");
    assert.equal(responses.length, count);
    assert.ok(
      host
        .snapshot()
        .activity.some(
          (a) => a.action === "auto-approved" && a.threadId === "chosen",
        ),
    );
  } finally {
    await host.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("worker replay handles eligible pending approvals and leaves stale or failed responses manual", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "agentview-approval-replay-"),
  );
  const vault = path.join(root, "vault");
  await mkdir(vault);
  await writeFile(path.join(root, "threads.json"), JSON.stringify(["chosen"]));
  await writeFile(
    path.join(root, "auto-approve.json"),
    JSON.stringify(["chosen"]),
  );
  await writeFile(
    path.join(root, "preferences.json"),
    JSON.stringify({ defaultPermissions: "full" }),
  );
  const host = new HostService(
    { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
    root,
  );
  const connect = host.connectAgent.bind(host);
  host.connectAgent = async () => {};
  host.codex.start = async () => {
    host.codex.ready = true;
    host.codex.persistent = true;
  };
  host.features.notice = async () => {};
  const request = (id: string, turnId = "current") => ({
    id,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "chosen", turnId },
  });
  host.codex.rpc = async (method) =>
    method === "runtime/state"
      ? {
          turns: [["chosen", "current"]],
          approvals: [request("replayed"), request("stale", "old")],
        }
      : { data: [] };
  const responses: (string | number)[] = [];
  host.codex.respond = (id) => {
    responses.push(id);
  };
  try {
    await host.start();
    await connect();
    assert.deepEqual(responses, ["replayed"]);
    assert.deepEqual(
      host.snapshot().approvals.map((a) => a.id),
      ["stale"],
    );
    host.codex.respond = () => {
      throw new Error("Runtime disconnected");
    };
    host.codex.emit("request", request("failed"));
    assert.ok(host.snapshot().approvals.some((a) => a.id === "failed"));
    assert.equal(
      host.snapshot().activity.filter((a) => a.action === "auto-approved")
        .length,
      1,
    );
    host.codex.emit("notification", {
      method: "serverRequest/resolved",
      params: { requestId: "failed", threadId: "chosen" },
    });
    assert.ok(!host.snapshot().approvals.some((a) => a.id === "failed"));
  } finally {
    await host.stop();
    await rm(root, { recursive: true, force: true });
  }
});
