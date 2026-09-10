import { test } from "node:test";
import assert from "node:assert/strict";
import { observeRecord } from "../src/host/observer";

test("session activity interprets tool calls but never reasoning, messages or outputs", () => {
  assert.equal(
    observeRecord({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input: "text(await tools.exec_command({cmd: 'Get-Content Home.md'}))",
      },
    })?.action,
    "reading",
  );
  assert.equal(
    observeRecord({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "apply_patch",
        arguments: "Home.md",
      },
    })?.action,
    "editing",
  );
  assert.equal(
    observeRecord({
      type: "response_item",
      payload: { type: "reasoning", text: "Get-Content Home.md" },
    }),
    undefined,
  );
  assert.equal(
    observeRecord({
      type: "response_item",
      payload: { type: "function_call_output", output: "apply_patch" },
    }),
    undefined,
  );
  assert.equal(
    observeRecord({ type: "event_msg", payload: { type: "task_complete" } })
      ?.active,
    false,
  );
});
