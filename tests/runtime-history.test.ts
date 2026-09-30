import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readRuntimeHistory,
  readRuntimeDetail,
} from "../src/host/runtime-history";
import { HISTORY_BYTES } from "../src/host/history";
import { fixtureItemPage } from "../scripts/history-fixture";
import { prependHistory } from "../src/shared/history-pages";
import { HostService } from "../src/host/service";
import type { Turn } from "../src/shared/types";

function runtime(turns: Turn[]) {
  return async (method: string, params: any) => {
    if (method === "thread/turns/list") {
      assert.equal(
        params.itemsView,
        "notLoaded",
        "Metadata never downloads turn contents",
      );
      const end = params.cursor ? Number(params.cursor) : turns.length;
      const start = Math.max(0, end - params.limit);
      return {
        data: turns
          .slice(start, end)
          .reverse()
          .map((turn) => ({ ...turn, items: [] })),
        nextCursor: start ? String(start) : null,
      };
    }
    assert.equal(method, "thread/items/list");
    assert.equal(
      params.limit,
      1,
      "Original outputs stay in item-sized runtime reads",
    );
    return fixtureItemPage(turns, params);
  };
}

test("worker byte pages reconstruct hours-long turns without whole-turn requests", async () => {
  const turns: Turn[] = [
    {
      id: "older",
      status: "completed",
      items: [{ id: "old", type: "agentMessage", text: "Older history" }],
    },
    {
      id: "long",
      status: "completed",
      items: Array.from({ length: 1200 }, (_, i) => ({
        id: `item-${i}`,
        type: "commandExecution",
        command: "inspect",
        aggregatedOutput: "x".repeat(65_000),
      })),
    },
  ];
  const rpc = runtime(turns);
  let cursor: string | null = null,
    combined: Turn[] = [],
    pages = 0;
  do {
    const page = await readRuntimeHistory(rpc, "chat", cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= HISTORY_BYTES);
    assert.ok(
      page.data.every((turn) =>
        turn.items.every(
          (item) =>
            !item.aggregatedOutput || item.aggregatedOutput.length <= 600,
        ),
      ),
    );
    combined = prependHistory([...page.data].reverse(), combined);
    cursor = page.nextCursor;
    pages++;
    assert.ok(pages < 30);
  } while (cursor);
  assert.ok(pages > 1);
  assert.deepEqual(
    combined.map((t) => [t.id, t.items.map((i) => i.id)]),
    turns.map((t) => [t.id, t.items.map((i) => i.id)]),
  );
  assert.equal(turns[1].items[0].aggregatedOutput?.length, 65_000);
});

test("UTF-8 messages, metadata pagination and empty current turns remain byte bounded", async () => {
  const turns: Turn[] = Array.from({ length: 105 }, (_, i) => ({
    id: `turn-${i}`,
    status: "completed",
    items: [
      { id: `item-${i}`, type: "agentMessage", text: "😀".repeat(12_000) },
    ],
  }));
  turns.push({ id: "current", status: "inProgress", items: [] });
  const rpc = runtime(turns);
  let cursor: string | null = null,
    combined: Turn[] = [];
  do {
    const page = await readRuntimeHistory(rpc, "chat", cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= HISTORY_BYTES);
    if (!cursor) assert.equal(page.data[0].id, "current");
    combined = prependHistory([...page.data].reverse(), combined);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(
    combined.map((t) => t.id),
    turns.map((t) => t.id),
  );
});

test("on-demand detail is bounded before the worker pipe and retains the original", async () => {
  const original = {
    id: "huge",
    type: "mcpToolCall",
    result: { text: "original".repeat(100_000) },
  };
  const saved: Turn[] = [
    { id: "turn", status: "completed", items: [original] },
  ];
  const rpc = runtime(saved);
  const page = await readRuntimeHistory(rpc, "chat", null);
  const ref = page.data[0].items[0].detail!;
  saved[0].items.push({
    id: "newer",
    type: "agentMessage",
    text: "Arrived after opening history",
  });
  let offset: number | null = 0,
    text = "";
  do {
    const chunk = await readRuntimeDetail(rpc, ref, offset);
    assert.ok(Buffer.byteLength(JSON.stringify(chunk)) < 256 * 1024);
    text += chunk.text;
    offset = chunk.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(text), original);
  await assert.rejects(
    readRuntimeDetail(rpc, { ...ref, itemId: "other" }, 0),
    /History changed/,
  );
  await assert.rejects(readRuntimeHistory(rpc, "chat", "av2:bad"), /invalid/);
});

test("a partial saved turn never restores its older cached prefix", async () => {
  const host = new HostService(
    { vaultPath: process.cwd(), port: 0, codexPath: "", autoStart: false },
    process.cwd(),
  );
  host.codex.ready = true;
  host.codex.persistent = true;
  host.codex.runtimeInfo.historyPaging = true;
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    type: "agentMessage",
    text: "message",
  }));
  (host as any).liveTurns.set("chat", [
    { id: "turn", status: "completed", items },
  ]);
  host.codex.rpc = async (method) =>
    method === "thread/read"
      ? { thread: { id: "chat", preview: "" } }
      : {
          data: [{ id: "turn", status: "completed", items: items.slice(90) }],
          nextCursor: "older",
        };
  const page = await host.handle("thread.read", { id: "chat" });
  assert.deepEqual(
    page.turns[0].items.map((i: any) => i.id),
    items.slice(90).map((i) => i.id),
  );
});

test("old retained workers fail safely until migrated instead of requesting full history", async () => {
  const host = new HostService(
    { vaultPath: process.cwd(), port: 0, codexPath: "", autoStart: false },
    process.cwd(),
  );
  host.codex.ready = true;
  host.codex.persistent = true;
  const calls: string[] = [];
  host.codex.rpc = async (method) => {
    calls.push(method);
    return { thread: { id: "chat" } };
  };
  await assert.rejects(
    host.handle("thread.read", { id: "chat" }),
    /updated execution worker/,
  );
  assert.deepEqual(calls, ["thread/read"]);
});
