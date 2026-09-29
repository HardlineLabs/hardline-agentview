import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayHistory,
  historyPosition,
  itemText,
  HISTORY_BYTES,
} from "../src/host/history";
import { prependHistory } from "../src/shared/history-pages";
import { threadLabel, defaultThreadName } from "../src/shared/thread-label";
import { HostService } from "../src/host/service";
import type { Thread, Turn } from "../src/shared/types";

test("forty-megabyte tool history becomes previews without modifying stored detail", () => {
  const result = "x".repeat(600_000);
  const turns: Turn[] = [
    {
      id: "turn",
      status: "completed",
      items: [
        {
          id: "question",
          type: "userMessage",
          content: [{ type: "text", text: "Keep my question" }],
        },
        ...Array.from({ length: 70 }, (_, i) => ({
          id: `tool-${i}`,
          type: "mcpToolCall",
          tool: "browser",
          result: { text: result },
        })),
        { id: "answer", type: "agentMessage", text: "Keep my answer" },
      ],
    },
  ];
  const page = displayHistory("chat", turns, { cursor: null }, null);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 30_000);
  assert.equal(page.turns[0].items[0].content?.[0].text, "Keep my question");
  assert.equal(page.turns[0].items.at(-1)?.text, "Keep my answer");
  assert.equal(page.turns[0].items[1].result, undefined);
  assert.equal((turns[0].items[1].result as any).text.length, 600_000);
  assert.deepEqual(page.turns[0].items[1].detail, {
    threadId: "chat",
    turnId: "turn",
    itemId: "tool-0",
    cursor: null,
  });
});

test("byte pagination can split one turn and reconstruct every item exactly once", () => {
  const turns: Turn[] = [
    {
      id: "turn",
      status: "completed",
      items: Array.from({ length: 110 }, (_, i) => ({
        id: String(i),
        type: "agentMessage",
        text: "😀".repeat(12_000),
      })),
    },
  ];
  let cursor: string | null = null,
    combined: Turn[] = [],
    pages = 0;
  do {
    const page = displayHistory(
      "chat",
      turns,
      historyPosition(cursor || undefined),
      null,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < HISTORY_BYTES + 5000);
    combined = prependHistory(page.turns, combined);
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 30);
  assert.ok(pages > 1 && pages < 30);
  assert.deepEqual(
    combined[0].items.map((i) => i.id),
    turns[0].items.map((i) => i.id),
  );
  assert.equal(combined[0].items.length, 110);
});

test("oversized messages retain full text for on-demand reads and reject invalid cursors", () => {
  const item = {
    id: "message",
    type: "agentMessage",
    text: "a".repeat(2_000_000),
  };
  const page = displayHistory(
    "chat",
    [{ id: "turn", status: "completed", items: [item] }],
    { cursor: null },
    null,
  );
  assert.equal(page.turns[0].items[0].text?.length, 24_000);
  assert.equal(itemText(item).length, 2_000_000);
  assert.throws(() => historyPosition("av1:bad"), /invalid/);
});

function fixture() {
  const host = new HostService(
    { vaultPath: process.cwd(), port: 0, codexPath: "", autoStart: false },
    process.cwd(),
  );
  host.codex.ready = true;
  const state = host as any;
  const thread: Thread = {
    id: "chat",
    preview: "Question",
    cwd: process.cwd(),
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
  };
  let exists = true,
    archived = false;
  const calls: string[] = [];
  host.codex.rpc = async (method, p) => {
    calls.push(method);
    if (method === "thread/list")
      return {
        data:
          exists && Boolean(p.archived) === archived
            ? [{ ...thread, archived }]
            : [],
        nextCursor: null,
      };
    if (method === "thread/archive") archived = true;
    if (method === "thread/unarchive") archived = false;
    if (method === "thread/delete") exists = false;
    return { data: [] };
  };
  return {
    host,
    state,
    thread,
    calls,
    removeExternally: () => {
      exists = false;
    },
  };
}

test("idle runtime state clears a stale observed flag and permits archive", async () => {
  const { host, state, thread, calls } = fixture();
  state.agents.set(thread.id, {
    id: thread.id,
    threadId: thread.id,
    active: true,
    action: "running",
    updated: 1,
  });
  state.loaded.add(thread.id);
  await host.handle("thread.archive", { id: thread.id });
  assert.ok(calls.includes("thread/archive"));
  assert.equal(calls.includes("thread/unsubscribe"), false);
  assert.equal(state.threads[0].archived, true);
  assert.equal(state.agents.has(thread.id), false);
});

test("refresh cannot resurrect an externally removed chat from the live cache", async () => {
  const { host, state, thread, removeExternally } = fixture();
  state.liveThreads.set(thread.id, thread);
  state.liveTurns.set(thread.id, []);
  removeExternally();
  await host.refreshThreads();
  assert.equal(state.threads.length, 0);
  assert.equal(state.liveThreads.size, 0);
});

test("real running work still blocks destructive actions regardless of stale catalog", async () => {
  const { host, state, thread, calls } = fixture();
  state.activeTurns.set(thread.id, "working");
  await assert.rejects(
    host.handle("thread.archive", { id: thread.id }),
    /finish or stop/,
  );
  assert.equal(calls.includes("thread/archive"), false);
});

test("missing chats make confirmed deletion idempotent but do not bypass confirmation", async () => {
  const { host, thread, removeExternally } = fixture();
  removeExternally();
  await assert.rejects(
    host.handle("thread.delete", { id: thread.id }),
    /Confirm/,
  );
  assert.deepEqual(
    await host.handle("thread.delete", { id: thread.id, confirm: thread.id }),
    { alreadyDeleted: true },
  );
});

test("catalog failure fails closed rather than treating all conversations as deleted", async () => {
  const { host, thread } = fixture();
  host.codex.rpc = async () => {
    throw new Error("Offline");
  };
  await assert.rejects(
    host.handle("thread.delete", { id: thread.id, confirm: thread.id }),
    /verify/,
  );
});

test("titles use canonical names and compact one-line fallbacks", () => {
  assert.equal(
    threadLabel({ name: "My named chat", preview: "x".repeat(20000) }),
    "My named chat",
  );
  assert.equal(
    threadLabel({ preview: "First line\n" + "x".repeat(20000) }),
    "First line",
  );
  assert.ok(threadLabel({ preview: "x".repeat(20000) }).length <= 64);
  assert.notEqual(
    defaultThreadName("Onboard to Hardline", "abcdef"),
    defaultThreadName("Onboard to Hardline", "ghijkl"),
  );
});

test("Host pages tool detail on demand and retains its complete original content", async () => {
  const { host } = fixture();
  const rpc = host.codex.rpc;
  const original = {
    id: "tool",
    type: "mcpToolCall",
    tool: "inspect",
    result: { text: "detail".repeat(20000) },
  };
  host.codex.rpc = async (method, params) =>
    method === "thread/turns/list"
      ? {
          data: [{ id: "turn", status: "completed", items: [original] }],
          nextCursor: null,
        }
      : rpc(method, params);
  let offset: number | null = 0;
  let text = "";
  while (offset !== null) {
    const page = await host.handle("thread.item.read", {
      ref: { threadId: "chat", turnId: "turn", itemId: "tool" },
      offset,
    });
    assert.ok(page.text.length <= 32000);
    text += page.text;
    offset = page.nextOffset;
  }
  assert.deepEqual(JSON.parse(text), original);
});

test("a real external writer lock is surfaced without claiming deletion succeeded", async () => {
  const { host, state, thread } = fixture();
  const rpc = host.codex.rpc;
  host.codex.rpc = async (method, params) => {
    if (method === "thread/delete")
      throw new Error("already has an active writer");
    return rpc(method, params);
  };
  await assert.rejects(
    host.handle("thread.delete", { id: thread.id, confirm: thread.id }),
    /another Codex session/,
  );
  assert.equal(state.threads.length, 1);
});
