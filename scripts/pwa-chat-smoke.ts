import assert from "node:assert/strict";
import path from "node:path";
import type { Page } from "playwright";
import type { HostService } from "../src/host/service";

export async function historyOrderSmoke(page: Page, host: HostService) {
  const rpc = host.codex.rpc;
  const thread = await host.handle("thread.create", {});
  await rpc("thread/name/set", { threadId: thread.id, name: "History order" });
  const turns = Array.from({ length: 20 }, (_, index) => ({
    id: `history-${index}`,
    status: "completed",
    items: [
      {
        id: `history-user-${index}`,
        type: "userMessage",
        content: [
          {
            type: "text",
            text: index ? `Request ${index}` : "Onboard this workspace",
          },
        ],
      },
      {
        id: `history-reply-${index}`,
        type: "agentMessage",
        text: `Response ${index}`,
      },
    ],
  }));
  host.codex.rpc = async (method, params) => {
    if (method === "thread/turns/list" && params.threadId === thread.id) {
      const end = params.cursor ? Number(params.cursor) : turns.length;
      const start = Math.max(0, end - params.limit);
      return {
        data: turns.slice(start, end).reverse(),
        nextCursor: start ? String(start) : null,
      };
    }
    return rpc(method, params);
  };
  const open = async (name: string) => {
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page.locator(".thread-list button").filter({ hasText: name }).click();
  };
  const checkOrder = async (start: number) => {
    await page.getByText("Response 19", { exact: true }).waitFor();
    await page.locator(".conversation-updating").waitFor({ state: "detached" });
    assert.deepEqual(
      await page.locator(".turn .user-message").allTextContents(),
      turns.slice(start).map((turn) => turn.items[0].content![0].text),
      "Reopened history keeps onboarding before newer work",
    );
    assert.deepEqual(
      await page.locator(".turn .agent-message .markdown").allTextContents(),
      turns.slice(start).map((turn) => turn.items[1].text),
      "Responses stay beside their requests in chronological order",
    );
  };
  try {
    // Seed the same live event cache used by real turns, independently of saved pagination.
    for (const turn of turns) {
      host.codex.emit("notification", {
        method: "turn/started",
        params: {
          threadId: thread.id,
          turn: { ...turn, status: "inProgress" },
        },
      });
      host.codex.emit("notification", {
        method: "turn/completed",
        params: { threadId: thread.id, turn },
      });
    }
    await host.refreshThreads();
    await open("History order");
    await checkOrder(5);
    await page.getByRole("button", { name: "Earlier messages" }).click();
    await page.getByText("Onboard this workspace", { exact: true }).waitFor();
    await checkOrder(0);
    await open("First conversation");
    await page
      .getByText("Welcome to First. Your workspace stays on this computer.")
      .waitFor();
    await open("History order");
    await checkOrder(5);
    await page.reload();
    await checkOrder(5);
    await page.context().setOffline(true);
    await page.locator(".connection-pill.lost").waitFor();
    await page.context().setOffline(false);
    await page.locator(".connection-pill:not(.lost)").waitFor();
    await checkOrder(5);
  } finally {
    await page.context().setOffline(false);
    host.codex.rpc = rpc;
    await host.handle("thread.delete", { id: thread.id, confirm: thread.id });
  }
}

// Exercise the real UI and encrypted Host API while independently controlling
// runtime acknowledgement, input delivery and persistence timing.
export async function chatRecoverySmoke(
  page: Page,
  host: HostService,
  captures?: string,
) {
  await page.evaluate(() => {
    (window as any).composerFlights = [];
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.classList.contains("composer-flight")
          )
            (window as any).composerFlights.push({
              text: node.textContent,
              hidden: node.getAttribute("aria-hidden"),
              steering: node.classList.contains("composer-steering"),
              motion: (
                node.getAnimations()[0]?.effect as KeyframeEffect
              )?.getKeyframes(),
              replacement: document
                .querySelector(".composer-draft")!
                .getAnimations().length,
            });
        }
    });
    observer.observe(document.querySelector(".chat-panel")!, {
      childList: true,
    });
  });
  const rpc = host.codex.rpc;
  const name = `Chat recovery ${crypto.randomUUID()}`;
  let thread: any, turn: any, start: any, steer: any;
  let unavailable = true;
  let acknowledge: (() => void) | undefined;
  let rejectSteer = false;
  host.codex.rpc = async (method, params) => {
    if (method === "thread/start") {
      const result = await rpc(method, params);
      thread = result.thread;
      await rpc("thread/name/set", { threadId: thread.id, name });
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
    const flights = await page.evaluate(() => (window as any).composerFlights);
    assert.equal(
      flights.length,
      1,
      "Accepted send detaches one decorative bubble",
    );
    assert.equal(flights[0].text, "Keep this accepted message visible");
    assert.equal(flights[0].hidden, "true");
    assert.equal(flights[0].steering, false);
    assert.equal(flights[0].replacement, 1, "The replacement bubble expands");
    assert.match(flights[0].motion.at(-1).transform, /-110px/);
    await page.locator(".composer-flight").waitFor({ state: "detached" });
    assert.equal(await page.getByLabel("Message your agent").inputValue(), "");
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

    const draftBubble = page.locator(".composer-draft");
    assert.match(
      (await draftBubble.getAttribute("class")) || "",
      /composer-steering/,
    );
    await page.getByLabel("Queue after current work").check();
    assert.doesNotMatch(
      (await draftBubble.getAttribute("class")) || "",
      /composer-steering/,
    );
    await page.getByLabel("Queue after current work").uncheck();
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
    const steeringAppearance = await page.evaluate(() => {
      const appearance = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return [
          style.backgroundColor,
          style.backgroundImage,
          style.borderTopStyle,
          style.borderTopColor,
          style.borderRadius,
          style.color,
          style.opacity,
        ];
      };
      return {
        draft: appearance(".composer-draft"),
        pending: appearance(".user-message.steering-pending"),
      };
    });
    assert.deepEqual(
      steeringAppearance.draft,
      steeringAppearance.pending,
      "The steering draft already looks like the pending message",
    );
    if (captures)
      await page.screenshot({
        path: path.join(
          captures,
          `${page.context().browser()!.browserType().name()}-steering-draft.png`,
        ),
      });
    const deadline = Date.now() + 15_000;
    while (!acknowledge && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(acknowledge, "Steering must reach the fixture runtime");
    assert.equal(
      await page
        .getByLabel("Message your agent")
        .evaluate((input: HTMLTextAreaElement) => input.readOnly),
      true,
    );
    assert.equal(
      await page.getByLabel("Message your agent").inputValue(),
      "Please include the alternate case",
      "Pending delivery retains its draft",
    );
    acknowledge();
    await pending.getByText("Waiting for agent", { exact: true }).waitFor();
    await page.locator(".composer-flight").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => (window as any).composerFlights.length),
      2,
    );
    const steeringFlight = await page.evaluate(
      () => (window as any).composerFlights[1],
    );
    assert.equal(steeringFlight.steering, true);
    assert.equal(
      steeringFlight.motion[0].opacity,
      0.7,
      "The flying steering bubble keeps its muted pending style",
    );
    const item = {
      id: crypto.randomUUID(),
      clientId: steer.clientUserMessageId,
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

    // Repeated text is a different message. Delivery can also beat acknowledgement.
    await page.emulateMedia({ reducedMotion: "reduce" });
    acknowledge = undefined;
    await page
      .getByLabel("Message your agent")
      .fill("Please include the alternate case");
    await page.getByTitle("Steer agent", { exact: true }).click();
    await pending.getByText("Sending…", { exact: true }).waitFor();
    const secondDeadline = Date.now() + 15_000;
    while (!acknowledge && Date.now() < secondDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(acknowledge);
    const repeated = {
      ...item,
      id: crypto.randomUUID(),
      clientId: steer.clientUserMessageId,
    };
    turn.items.push(repeated);
    host.codex.emit("notification", {
      method: "item/started",
      params: { threadId: thread.id, turnId: turn.id, item: repeated },
    });
    await pending.waitFor({ state: "detached" });
    acknowledge();
    await page.waitForFunction(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Message your agent"]',
      );
      return input?.value === "";
    });
    assert.equal(
      await pending.count(),
      0,
      "Late acknowledgement must not recreate the delivered bubble",
    );
    assert.equal(
      await page.evaluate(() => (window as any).composerFlights.length),
      2,
      "Reduced motion skips flight and replacement animation",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(
      await page
        .locator(".turn .user-message")
        .filter({ hasText: repeated.content[0].text })
        .count(),
      2,
    );

    // Delivery while another conversation is open reconciles from refreshed history.
    acknowledge = undefined;
    await page
      .getByLabel("Message your agent")
      .fill("Direction delivered while away");
    await page.getByTitle("Steer agent", { exact: true }).click();
    await pending.getByText("Sending…", { exact: true }).waitFor();
    const thirdDeadline = Date.now() + 15_000;
    while (!acknowledge && Date.now() < thirdDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(acknowledge);
    acknowledge();
    await pending.getByText("Waiting for agent", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .locator(".thread-list .thread")
      .filter({ hasText: "First conversation" })
      .click();
    await page
      .getByText("Welcome to First. Your workspace stays on this computer.")
      .waitFor();
    const away = {
      id: crypto.randomUUID(),
      clientId: steer.clientUserMessageId,
      type: "userMessage",
      content: steer.input,
    };
    turn.items.push(away);
    host.codex.emit("notification", {
      method: "item/started",
      params: { threadId: thread.id, turnId: turn.id, item: away },
    });
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .locator(".thread-list .thread")
      .filter({ hasText: name })
      .click();
    await page
      .locator(".turn .user-message")
      .filter({ hasText: "Direction delivered while away" })
      .waitFor();
    await pending.waitFor({ state: "detached" });
    rejectSteer = true;
    await page.locator(".composer-flight").waitFor({ state: "detached" });
    const beforeRejected = await page.evaluate(
      () => (window as any).composerFlights.length,
    );
    await page
      .getByLabel("Message your agent")
      .fill("Retain rejected direction");
    await page.getByTitle("Steer agent", { exact: true }).click();
    await page.getByText(/The active turn changed/).waitFor();
    assert.equal(await pending.count(), 0);
    assert.equal(
      await page.evaluate(() => (window as any).composerFlights.length),
      beforeRejected,
      "Rejected sends do not animate or clear the draft",
    );
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
    assert.doesNotMatch(
      (await draftBubble.getAttribute("class")) || "",
      /composer-steering/,
    );
    assert.equal(
      await draftBubble.evaluate(
        (element) => getComputedStyle(element).borderTopStyle,
      ),
      "solid",
    );
    assert.equal(
      await page.getByLabel("Message your agent").inputValue(),
      "Retain rejected direction",
      "Finishing the agent changes draft styling without losing the draft",
    );
    await page.reload();
    await page
      .locator(".user-message")
      .filter({ hasText: "Direction delivered while away" })
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
