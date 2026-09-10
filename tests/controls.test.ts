import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostService } from "../src/host/service";
import {
  listAll,
  threadSources,
  assignProjects,
  desktopAssignments,
} from "../src/host/catalog";
import { observeUsage, SessionObserver } from "../src/host/observer";
import { moveToward } from "../src/ui/motion";
import type { Thread } from "../src/shared/types";

const thread = (id: string): Thread => ({
  id,
  preview: id,
  cwd: process.cwd(),
  updatedAt: 1,
  createdAt: 1,
  status: { type: "idle" },
});

test("catalog exhausts pagination, includes all sources and preserves project/category assignment", async () => {
  const calls: any[] = [];
  const result = await listAll(
    async (_method, p) => {
      calls.push(p);
      return p.cursor
        ? { data: [thread("older")], nextCursor: null }
        : {
            data: Array.from({ length: 100 }, (_, i) => thread(String(i))),
            nextCursor: "next",
          };
    },
    "thread/list",
    { sourceKinds: threadSources, modelProviders: [] },
  );
  assert.equal(result.length, 101);
  assert.equal(calls[1].cursor, "next");
  assert.ok(calls[0].sourceKinds.includes("subAgent"));
  await assert.rejects(
    listAll(async () => ({ data: [], nextCursor: "same" }), "thread/list"),
    /Repeated cursor/,
  );
  const assigned = assignProjects(
    [
      {
        ...thread("canonical"),
        projectId: "runtime",
        section: { id: "pin", name: "Pinned" },
      },
      thread("legacy"),
      thread("folder"),
    ],
    [{ id: "folder-project", name: "Folder", path: process.cwd() }],
    { canonical: "old", legacy: "legacy-project" },
  );
  assert.deepEqual(
    assigned.map((t) => t.projectId),
    ["runtime", "legacy-project", "folder-project"],
  );
  assert.equal(assigned[0].section?.name, "Pinned");
});

test("legacy project adapter reads only local assignments and translates migrated identities", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-catalog-"));
  try {
    await fs.writeFile(
      path.join(root, ".codex-global-state.json"),
      JSON.stringify({
        "thread-project-assignments": {
          a: { projectKind: "local", projectId: "old" },
          b: { projectKind: "remote", projectId: "remote" },
        },
        "app-server-project-id-by-legacy-project-id-by-host": {
          [`local:${root}`]: { old: "new" },
        },
      }),
    );
    assert.deepEqual(await desktopAssignments(root), { a: "new" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("steering targets the current owned turn; archive, restore and delete stay in the runtime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-controls-"));
  await fs.writeFile(path.join(root, "Home.md"), "# Home");
  const host = new HostService(
    { vaultPath: root, port: 0, codexPath: "", autoStart: false },
    path.join(root, "data"),
  );
  const calls: { method: string; params: any }[] = [];
  let archived = false,
    deleted = false;
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/list")
      return {
        data:
          !deleted && Boolean(params.archived) === archived
            ? [thread("owned")]
            : [],
        nextCursor: null,
      };
    if (method === "thread/start") return { thread: thread("owned") };
    if (method === "turn/start")
      return { turn: { id: "turn-1", status: "inProgress", items: [] } };
    if (method === "turn/steer") return { turnId: "turn-1" };
    if (method === "thread/archive") archived = true;
    if (method === "thread/unarchive") archived = false;
    if (method === "thread/delete") deleted = true;
    if (method === "account/rateLimits/read") {
      assert.equal(params, null);
      return {
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: {
              usedPercent: 42,
              windowDurationMins: 300,
              resetsAt: 1234,
            },
          },
        },
      };
    }
    return { data: [] };
  };
  try {
    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await host.handle("thread.create", {});
    await host.handle("thread.send", { id: "owned", text: "Start" });
    await assert.rejects(
      host.handle("thread.steer", {
        id: "owned",
        text: "Change",
        expectedTurnId: "stale",
      }),
      /active turn changed/,
    );
    await assert.rejects(
      host.handle("thread.archive", { id: "owned" }),
      /finish or stop/,
    );
    const response = await host.handle("thread.steer", {
      id: "owned",
      text: "Focus here",
      expectedTurnId: "turn-1",
      noteId: "Home.md",
    });
    assert.equal(response.steered, true);
    assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
    assert.match(
      calls.find((c) => c.method === "turn/steer")!.params.input[0].text,
      /Focus here.*\n\nAttached vault note/s,
    );
    host.codex.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "owned",
        turn: { id: "turn-1", status: "completed" },
      },
    });
    await assert.rejects(
      host.handle("thread.steer", {
        id: "owned",
        text: "Late",
        expectedTurnId: "turn-1",
      }),
      /finished or belongs/,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await host.handle("thread.archive", { id: "owned" });
    assert.equal(host.snapshot().threads[0].archived, true);
    await assert.rejects(
      host.handle("thread.send", { id: "owned", text: "No" }),
      /Restore/,
    );
    await host.handle("thread.unarchive", { id: "owned" });
    assert.equal(host.snapshot().threads[0].archived, false);
    await assert.rejects(
      host.handle("thread.delete", { id: "owned" }),
      /Confirm/,
    );
    await host.handle("thread.delete", { id: "owned", confirm: "owned" });
    assert.equal(host.snapshot().threads.length, 0);
    assert.equal(host.snapshot().limits?.buckets[0].primary?.usedPercent, 42);
    host.codex.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "other",
        tokenUsage: {
          total: { totalTokens: 200 },
          last: { totalTokens: 100 },
          modelContextWindow: 1000,
        },
      },
    });
    await assert.rejects(
      host.handle("thread.steer", {
        id: "other",
        text: "No",
        expectedTurnId: "external",
      }),
      /belongs to Desktop/,
    );
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("persisted usage survives old timestamps and never treats message text as token telemetry", async () => {
  const record = {
    type: "event_msg",
    timestamp: "2020-01-01T00:00:00Z",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: 8000 },
        last_token_usage: { total_tokens: 900 },
        model_context_window: 10000,
      },
    },
  };
  assert.equal(observeUsage(record)?.last.totalTokens, 900);
  assert.equal(
    observeUsage({ type: "response_item", payload: record.payload }),
    undefined,
  );
  assert.equal(
    observeUsage({
      type: "event_msg",
      payload: { type: "token_count", info: null },
    }),
    undefined,
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-usage-"));
  await fs.mkdir(path.join(root, "archived_sessions"));
  const file = path.join(root, "archived_sessions", "test.jsonl");
  await fs.writeFile(file, JSON.stringify(record) + "\n");
  const observer = new SessionObserver(root);
  let usage: any;
  observer.on("usage", (event) => {
    usage = event;
  });
  try {
    await observer.track([{ ...thread("old"), path: file, archived: true }]);
    assert.equal(usage.threadId, "old");
    assert.equal(usage.usage.total.totalTokens, 8000);
  } finally {
    await observer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("agent travel is speed limited and independent of monitor refresh rate", () => {
  const results = [60, 144, 240].map((hz) => {
    const pos = { x: 0, y: 0 };
    for (let i = 0; i < hz * 2; i++) moveToward(pos, { x: 1000, y: 0 }, 1 / hz);
    return pos.x;
  });
  for (const value of results) assert.ok(Math.abs(value - 170) < 0.01);
  const pos = { x: 1, y: 1 };
  moveToward(pos, pos, 1 / 60);
  assert.deepEqual(pos, { x: 1, y: 1 });
});
