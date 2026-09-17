import { test } from "node:test";
import assert from "node:assert/strict";
import { HostService } from "../src/host/service";
import { elicitationContent } from "../src/shared/elicitation";

function fixture() {
  const host = new HostService(
    { vaultPath: process.cwd(), port: 0, codexPath: "", autoStart: false },
    process.cwd(),
  );
  host.codex.ready = true;
  const state = host as any;
  const thread = {
    id: "owned",
    cwd: process.cwd(),
    createdAt: 1,
    updatedAt: 1,
    preview: "",
    model: "selected-model",
    reasoningEffort: "low",
    status: { type: "active" },
  };
  const turn = {
    id: "running",
    status: "inProgress",
    items: [
      {
        id: "user",
        type: "userMessage",
        content: [{ type: "text", text: "Accepted message" }],
      },
    ],
  };
  state.liveThreads.set(thread.id, thread);
  state.liveTurns.set(thread.id, [turn]);
  state.threads = [
    { ...thread, reasoningEffort: "high", projectId: "legacy-project" },
  ];
  state.owned.add(thread.id);
  state.loaded.add(thread.id);
  state.activeTurns.set(thread.id, turn.id);
  return { host, state, thread, turn };
}

test("MCP Allow and Decline forward distinct actions; invalid forms remain pending", async () => {
  const { host, state } = fixture();
  const responses: any[] = [];
  host.codex.respond = (_id, result) => {
    responses.push(result);
  };
  const schema = {
    type: "object",
    required: ["decision"],
    properties: { decision: { type: "string", enum: ["once", "session"] } },
  };
  state.approvals.set(1, {
    id: 1,
    method: "mcpServer/elicitation/request",
    params: { mode: "form", requestedSchema: schema },
  });
  await assert.rejects(
    host.handle("approval.respond", { id: 1, allow: true }),
    /Complete decision/,
  );
  assert.equal(responses.length, 0);
  assert.ok(state.approvals.has(1));
  await host.handle("approval.respond", {
    id: 1,
    allow: true,
    content: { decision: "once", unrelated: true },
  });
  assert.deepEqual(responses.pop(), {
    action: "accept",
    content: { decision: "once" },
    _meta: null,
  });
  for (const mode of ["form", "url"]) {
    state.approvals.set(2, {
      id: 2,
      method: "mcpServer/elicitation/request",
      params: { mode, requestedSchema: schema },
    });
    await host.handle("approval.respond", { id: 2, allow: false });
    assert.deepEqual(responses.pop(), {
      action: "decline",
      content: null,
      _meta: null,
    });
  }
  state.approvals.set(3, {
    id: 3,
    method: "mcpServer/elicitation/request",
    params: {
      mode: "form",
      requestedSchema: { type: "object", properties: {} },
    },
  });
  await host.handle("approval.respond", { id: 3, allow: true });
  assert.deepEqual(responses.pop(), {
    action: "accept",
    content: {},
    _meta: null,
  });
});

test("MCP form values retain their types and reject invalid required choices", () => {
  const schema = {
    type: "object",
    required: ["confirmed"],
    properties: {
      confirmed: { type: "boolean" },
      count: { type: "integer", minimum: 1 },
      choices: {
        type: "array",
        minItems: 1,
        items: { type: "string", anyOf: [{ const: "one", title: "One" }] },
      },
    },
  };
  assert.deepEqual(
    elicitationContent(schema, {
      confirmed: false,
      count: 2,
      choices: ["one"],
    }),
    { confirmed: false, count: 2, choices: ["one"] },
  );
  assert.throws(
    () => elicitationContent(schema, { confirmed: "true" }),
    /Check confirmed/,
  );
  assert.throws(
    () => elicitationContent(schema, { confirmed: true, count: 1.5 }),
    /Check count/,
  );
  assert.throws(
    () => elicitationContent(schema, { confirmed: true, choices: ["other"] }),
    /Check choices/,
  );
});

test("empty rollout preserves a live accepted turn and choices until persisted history is ready", async () => {
  const { host, thread, turn } = fixture();
  let reads = 0;
  host.codex.rpc = async () => {
    reads++;
    throw new Error(
      "failed to read session metadata: rollout at example.jsonl is empty",
    );
  };
  const pending = await host.handle("thread.read", { id: thread.id });
  assert.equal(reads, 2);
  assert.equal(pending.historyPending, true);
  assert.deepEqual(pending.turns, [turn]);
  assert.equal(pending.thread.reasoningEffort, "low");
  assert.equal(pending.thread.projectId, "legacy-project");
  host.codex.rpc = async (method) =>
    method === "thread/read"
      ? { thread }
      : {
          data: [{ id: "older", status: "completed", items: [] }],
          nextCursor: null,
        };
  const recovered = await host.handle("thread.read", { id: thread.id });
  assert.equal(recovered.historyPending, false);
  assert.deepEqual(
    recovered.turns.map((t: any) => t.id),
    ["older", "running"],
  );
});

test("history fallback never hides unrelated failures or claims unknown history is empty", async () => {
  const { host } = fixture();
  host.codex.rpc = async () => {
    throw new Error("Permission denied");
  };
  await assert.rejects(
    host.handle("thread.read", { id: "owned" }),
    /Permission denied/,
  );
  host.codex.rpc = async () => {
    throw new Error("rollout at example.jsonl is empty");
  };
  await assert.rejects(
    host.handle("thread.read", { id: "unknown" }),
    /is empty/,
  );
  await assert.rejects(
    host.handle("thread.read", { id: "owned", cursor: "older" }),
    /is empty/,
  );
});

test("reopening paginated history never appends cached onboarding after newer turns", async () => {
  const { host, state, thread } = fixture();
  const history = Array.from({ length: 20 }, (_, index) => ({
    id: `turn-${index}`,
    status: "completed",
    items: [
      {
        id: `message-${index}`,
        type: "userMessage",
        content: [
          { type: "text", text: index ? `Message ${index}` : "Onboard" },
        ],
      },
    ],
  }));
  state.liveTurns.set(thread.id, history);
  host.codex.rpc = async (method, params) => {
    if (method === "thread/read") return { thread };
    assert.equal(method, "thread/turns/list");
    assert.equal(params.sortDirection, "desc");
    assert.equal(params.limit, 15);
    return {
      data: (params.cursor ? history.slice(0, 5) : history.slice(5)).reverse(),
      nextCursor: params.cursor ? null : "older",
    };
  };
  for (let reopen = 0; reopen < 2; reopen++) {
    const latest = await host.handle("thread.read", { id: thread.id });
    assert.deepEqual(latest.turns, history.slice(5));
    assert.equal(latest.nextCursor, "older");
    const older = await host.handle("thread.read", {
      id: thread.id,
      cursor: latest.nextCursor,
    });
    assert.deepEqual([...older.turns, ...latest.turns], history);
    assert.equal(older.nextCursor, null);
  }
});

test("history overlap keeps fresh cached updates and only appends newer unpersisted turns", async () => {
  const { host, state, thread } = fixture();
  const saved = Array.from({ length: 18 }, (_, index) => ({
    id: `saved-${index}`,
    status: index === 17 ? "inProgress" : "completed",
    items: [
      { id: `reply-${index}`, type: "agentMessage", text: "Saved response" },
    ],
  }));
  const updated = {
    ...saved[17],
    status: "completed",
    items: [{ ...saved[17].items[0], text: "Finished response" }],
  };
  const pending = [
    { id: "not-yet-saved", status: "completed", items: [] },
    { id: "current-work", status: "inProgress", items: [] },
  ];
  state.liveTurns.set(thread.id, [...saved.slice(0, 17), updated, ...pending]);
  host.codex.rpc = async (method) =>
    method === "thread/read"
      ? { thread }
      : { data: saved.slice(-15).reverse(), nextCursor: "older" };
  const latest = await host.handle("thread.read", { id: thread.id });
  assert.deepEqual(latest.turns, [...saved.slice(3, 17), updated, ...pending]);
  saved[17] = updated;
  saved.push(...pending);
  const persisted = await host.handle("thread.read", { id: thread.id });
  assert.deepEqual(persisted.turns, saved.slice(-15));
});

test("legacy full history keeps its original order when live turns overlap", async () => {
  const { host, state, thread, turn } = fixture();
  const older = { id: "onboarding", status: "completed", items: [] };
  state.liveTurns.set(thread.id, [older, turn]);
  host.codex.rpc = async (method) => {
    if (method === "thread/turns/list") throw new Error("Method not found");
    return { thread: { ...thread, turns: [older, turn] } };
  };
  const result = await host.handle("thread.read", { id: thread.id });
  assert.deepEqual(result.turns, [older, turn]);
  assert.equal(result.nextCursor, null);
});

test("steering retains the client message identity so the pending bubble reconciles with runtime input", async () => {
  const { host } = fixture();
  let params: any;
  host.codex.rpc = async (method, p) => {
    assert.equal(method, "turn/steer");
    params = p;
    return { turnId: "running" };
  };
  const result = await host.handle("thread.steer", {
    id: "owned",
    expectedTurnId: "running",
    text: "More direction",
    clientUserMessageId: "message-id",
  });
  assert.equal(result.steered, true);
  assert.equal(params.clientUserMessageId, "message-id");
  assert.equal(params.expectedTurnId, "running");
});
