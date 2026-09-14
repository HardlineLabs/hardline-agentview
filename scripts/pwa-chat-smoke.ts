import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { HostService } from "../src/host/service";

// Exercise the real UI and encrypted Host API while independently controlling
// runtime acknowledgement, input delivery and persistence timing.
export async function chatRecoverySmoke(page: Page, host: HostService) {
  const rpc = host.codex.rpc;
  let thread: any, turn: any, start: any, steer: any;
  let unavailable = true;
  let acknowledge: (() => void) | undefined;
  let rejectSteer = false;
  host.codex.rpc = async (method, params) => {
    if (method === "thread/start") {
      const result = await rpc(method, params);
      thread = result.thread;
      return result;
    }
    if (method === "turn/start" && params.threadId === thread?.id) {
      start = params;
      turn = {
        id: crypto.randomUUID(),
        status: "inProgress",
        items: [
          {
            id: params.clientUserMessageId,
            type: "userMessage",
            content: params.input,
          },
        ],
      };
      host.codex.emit("notification", {
        method: "turn/started",
        params: { threadId: thread.id, turn },
      });
      return { turn };
    }
    if (method === "thread/read" && params.threadId === thread?.id) {
      if (unavailable)
        throw new Error(
          "failed to read session metadata: rollout at fixture.jsonl is empty",
        );
      return {
        thread: {
          ...thread,
          model: start.model,
          reasoningEffort: start.effort,
        },
      };
    }
    if (method === "thread/turns/list" && params.threadId === thread?.id)
      return { data: [turn], nextCursor: null };
    if (method === "turn/steer") {
      if (rejectSteer)
        throw new Error(
          "The active turn changed. Review the conversation before sending again.",
        );
      steer = params;
      await new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      return { turnId: turn.id };
    }
    return rpc(method, params);
  };
  try {
    await page.getByTitle("New conversation", { exact: true }).click();
    await page
      .getByRole("button", { name: "Reasoning effort", exact: true })
      .click();
    await page.getByRole("option", { name: "low", exact: true }).click();
    await page
      .getByLabel("Message your agent")
      .fill("Keep this accepted message visible");
    await page.getByTitle("Send message", { exact: true }).click();
    await page
      .locator(".user-message")
      .filter({ hasText: "Keep this accepted message visible" })
      .waitFor();
    await page.getByText("Loading saved history…", { exact: true }).waitFor();
    assert.equal(start.effort, "low");
    assert.equal(
      await page
        .getByRole("button", { name: "Reasoning effort", exact: true })
        .innerText(),
      "low",
    );
    assert.equal(await page.getByText(/rollout at fixture/).count(), 0);
    unavailable = false;
    await page
      .getByText("Loading saved history…", { exact: true })
      .waitFor({ state: "detached" });
    assert.equal(
      await page
        .getByRole("button", { name: "Reasoning effort", exact: true })
        .innerText(),
      "low",
    );

    await page
      .getByLabel("Message your agent")
      .fill("Please include the alternate case");
    await page.getByTitle("Steer agent", { exact: true }).click();
    const pending = page.locator(".steering-pending");
    await pending.getByText("Sending…", { exact: true }).waitFor();
    assert.match(
      await pending.innerText(),
      /Please include the alternate case/,
    );
    const deadline = Date.now() + 15_000;
    while (!acknowledge && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(acknowledge, "Steering must reach the fixture runtime");
    acknowledge();
    await pending.getByText("Waiting for agent", { exact: true }).waitFor();
    const item = {
      id: steer.clientUserMessageId,
      type: "userMessage",
      content: steer.input,
    };
    turn.items.push(item);
    host.codex.emit("notification", {
      method: "item/started",
      params: { threadId: thread.id, turnId: turn.id, item },
    });
    await pending.waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator(".user-message")
        .filter({ hasText: "Please include the alternate case" })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByText("Steering message accepted by the active agent.", {
          exact: true,
        })
        .count(),
      0,
    );
    rejectSteer = true;
    await page
      .getByLabel("Message your agent")
      .fill("Retain rejected direction");
    await page.getByTitle("Steer agent", { exact: true }).click();
    await page.getByText(/The active turn changed/).waitFor();
    assert.equal(await pending.count(), 0);
    assert.equal(
      await page.getByLabel("Message your agent").inputValue(),
      "Retain rejected direction",
    );

    turn.status = "completed";
    host.codex.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread.id, turn },
    });
    await page.getByTitle("Send message", { exact: true }).waitFor();
    await page.reload();
    await page
      .locator(".user-message")
      .filter({ hasText: "Please include the alternate case" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Reasoning effort", exact: true })
        .innerText(),
      "low",
    );
  } finally {
    acknowledge?.();
    host.codex.rpc = rpc;
  }
}
