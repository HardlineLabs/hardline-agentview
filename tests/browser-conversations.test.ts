import { test } from "node:test";
import assert from "node:assert/strict";
import { RecentConversations } from "../src/browser/conversations";
import type { ChatPage } from "../src/shared/types";

const page = (id: string, text = "short"): ChatPage => ({
  thread: { id } as ChatPage["thread"],
  turns: [
    {
      id: "turn",
      status: "completed",
      items: [{ id: "message", type: "agentMessage", text }],
    },
  ],
  nextCursor: "older",
});
test("browser cache evicts by retained content as well as chat count without truncating history", () => {
  const cache = new RecentConversations(4000, 5);
  const first = page("first", "x".repeat(1000));
  const second = page("second", "y".repeat(1000));
  cache.set("first", first);
  cache.set("second", second);
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), second);
  assert.equal(first.turns[0].items[0].text?.length, 1000);
  assert.equal(first.nextCursor, "older");
  const oversized = page("second", "z".repeat(3000));
  cache.set("second", oversized);
  assert.equal(
    cache.get("second"),
    undefined,
    "Oversized refreshed pages also remove stale copies",
  );
  const bounded = new RecentConversations(100000, 2);
  bounded.set("a", page("a"));
  bounded.set("b", page("b"));
  bounded.set("a", page("a"));
  bounded.set("c", page("c"));
  assert.equal(bounded.get("b"), undefined);
  assert.ok(bounded.get("a"));
  bounded.delete("a");
  assert.equal(bounded.get("a"), undefined);
  bounded.clear();
  assert.equal(bounded.get("c"), undefined);
});
