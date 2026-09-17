import assert from "node:assert/strict";
import test from "node:test";
import { activeTargets } from "../src/ui/activity-targets";
import type { Activity, Agent } from "../src/shared/types";

const agent: Agent = {
  id: "agent-1",
  name: "Codex",
  threadId: "thread-1",
  action: "reading",
  target: "notes/current.md",
  updated: 100_000,
  active: true,
};

test("keeps multiple recent note targets for an active desktop agent", () => {
  const activity: Activity[] = [
    { id: "2", agentId: "agent-1", action: "reading", target: "notes/two.md", detail: "two", time: 99_000 },
    { id: "1", threadId: "thread-1", action: "reading", target: "notes/one.md", detail: "one", time: 98_000 },
    { id: "old", agentId: "agent-1", action: "reading", target: "notes/old.md", detail: "old", time: 1_000 },
  ];
  assert.deepEqual(
    activeTargets(agent, activity, new Set(["notes/current.md", "notes/one.md", "notes/two.md", "notes/old.md"]), 100_000),
    ["notes/current.md", "notes/two.md", "notes/one.md"],
  );
});

test("does not retain historical fan-out for an inactive agent", () => {
  assert.deepEqual(
    activeTargets({ ...agent, active: false }, [], new Set(["notes/current.md"]), 100_000),
    ["notes/current.md"],
  );
});
