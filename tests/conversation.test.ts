import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConversationEvent } from "../src/shared/conversation";

test("early streaming events survive missing history and final metadata-only completion", () => {
  let turns = applyConversationEvent([], "item/agentMessage/delta", {
    turnId: "t",
    itemId: "i",
    delta: "Hello",
  });
  turns = applyConversationEvent(turns, "item/agentMessage/delta", {
    turnId: "t",
    itemId: "i",
    delta: " world",
  });
  turns = applyConversationEvent(turns, "turn/started", {
    turn: { id: "t", items: [], status: "inProgress" },
  });
  turns = applyConversationEvent(turns, "turn/completed", {
    turn: { id: "t", items: [], status: "completed" },
  });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].items[0].text, "Hello world");
  assert.equal(turns[0].status, "completed");
});

test("tool completion replaces progress and private reasoning is excluded", () => {
  let turns = applyConversationEvent([], "item/started", {
    turnId: "t",
    item: { id: "r", type: "reasoning" },
  });
  assert.equal(turns.length, 0);
  turns = applyConversationEvent(turns, "item/started", {
    turnId: "t",
    item: { id: "c", type: "commandExecution", status: "inProgress" },
  });
  turns = applyConversationEvent(turns, "item/completed", {
    turnId: "t",
    item: {
      id: "c",
      type: "commandExecution",
      status: "completed",
      aggregatedOutput: "done",
    },
  });
  assert.equal(turns[0].items.length, 1);
  assert.equal(turns[0].items[0].aggregatedOutput, "done");
});
