import { fixtureItemPage } from "./history-fixture";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { HostService } from "../src/host/service";
import type { Turn } from "../src/shared/types";
import path from "node:path";

async function typingLatency(page: Page) {
  await page.evaluate(() => {
    const timings: number[] = [];
    const input = document.querySelector('[aria-label="Message your agent"]')!;
    const listener = () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => timings.push(performance.now() - start)),
      );
    };
    (window as any).typingTimings = timings;
    (window as any).stopTypingMeasure = () =>
      input.removeEventListener("input", listener);
    input.addEventListener("input", listener);
  });
  await page
    .getByLabel("Message your agent")
    .pressSequentially("A responsive draft in a long conversation", {
      delay: 25,
    });
  await page.waitForFunction(() => (window as any).typingTimings.length >= 40);
  const timings = await page.evaluate(() => {
    (window as any).stopTypingMeasure();
    return (window as any).typingTimings as number[];
  });
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length * 0.95)];
}

// A single long turn bypasses turn-count pagination. Use real encrypted transport
// and production rendering, with synthetic data only.
export async function longConversationSmoke(page: Page, host: HostService) {
  const rpc = host.codex.rpc;
  const thread = await host.handle("thread.create", {});
  await rpc("thread/name/set", {
    threadId: thread.id,
    name: "Long conversation",
  });
  const turn: Turn = {
    id: "long-turn",
    status: "completed",
    items: Array.from({ length: 1200 }, (_, index) =>
      index % 3 === 0
        ? {
            id: `long-${index}`,
            type: "userMessage",
            content: [{ type: "text", text: `Long request ${index}` }],
          }
        : index % 3 === 1
          ? {
              id: `long-${index}`,
              type: "commandExecution",
              status: "completed",
              command: `echo long-tool-${index}`,
              aggregatedOutput:
                `Tool output ${index}\n` +
                "Synthetic output stays offscreen until expanded.\n".repeat(
                  2200,
                ),
            }
          : {
              id: `long-${index}`,
              type: "agentMessage",
              text:
                `Long reply ${index}\n\n` +
                "A paragraph with **formatted text**, a [link](https://example.com), and `code`.\n\n".repeat(
                  8,
                ),
            },
    ),
  };
  const older: Turn = {
    id: "older-turn",
    status: "completed",
    items: [
      {
        id: "older-message",
        type: "agentMessage",
        text: "Earlier performance history",
      },
    ],
  };
  host.codex.rpc = async (method, params) => {
    if (method === "thread/items/list" && params.threadId === thread.id)
      return fixtureItemPage([older, turn], params);
    if (method === "thread/turns/list" && params.threadId === thread.id)
      return {
        data: [turn, older],
        nextCursor: null,
      };
    return rpc(method, params);
  };
  const firstPage = await host.handle("thread.read", { id: thread.id });
  let firstIndex = Number(
    firstPage.turns
      .flatMap((t: Turn) => t.items)
      .find((i: any) => i.type === "userMessage")!
      .id.split("-")[1],
  );
  const panel = page.locator(".chat-scroll");
  const toolLayout = () =>
    page.waitForFunction(() => {
      const tool = document.querySelector(
        '[data-message-key="long-turn/long-1"]',
      )!;
      const next = document.querySelector(
        '[data-message-key="long-turn/long-2"]',
      )!;
      return (
        Math.abs(
          next.getBoundingClientRect().top -
            tool.getBoundingClientRect().bottom,
        ) < 2
      );
    });
  const bottom = async () => {
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByText("Long reply 1199", { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const element = document.querySelector(".chat-scroll")!;
      return (
        element.scrollHeight - element.scrollTop - element.clientHeight < 5
      );
    });
  };
  const top = async () => {
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });
    // Native end anchoring first measures rows newly mounted at this boundary.
    await page.waitForTimeout(200);
    await panel.evaluate((element) => {
      element.scrollTop = 1;
    });
    await page.waitForTimeout(50);
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await page
      .getByText(`Long request ${firstIndex}`, { exact: true })
      .waitFor();
  };
  try {
    await page.getByTitle("New conversation", { exact: true }).click();
    const baselineP95 = await typingLatency(page);
    await page.getByLabel("Message your agent").fill("");
    await host.refreshThreads();
    const drawer = page.getByRole("button", {
      name: "Open conversations",
      exact: true,
    });
    if (await drawer.isVisible()) await drawer.click();
    const opened = Date.now();
    await page
      .locator(".thread-list button")
      .filter({ hasText: "Long conversation" })
      .click();
    await page.getByText("Long reply 1199", { exact: true }).waitFor();
    await bottom();
    const openingMs = Date.now() - opened;
    if (process.env.AGENTVIEW_PWA_CAPTURES)
      await page.screenshot({
        path: path.join(
          process.env.AGENTVIEW_PWA_CAPTURES,
          `${page.context().browser()!.browserType().name()}-long-conversation.png`,
        ),
      });
    assert.ok(
      (await page.locator(".browser-message").count()) < 80,
      "Only a small window of 1,200 items is mounted",
    );
    assert.equal(
      await page.locator(".tool-item pre").count(),
      0,
      "Collapsed output is not mounted",
    );
    const typingP95 = await typingLatency(page);
    // Windows WebKit can have a slow frame cadence even in an empty chat.
    assert.ok(
      typingP95 < Math.max(150, baselineP95 + 75),
      `Long-chat input-to-frame p95 ${typingP95} ms regressed against empty chat ${baselineP95} ms`,
    );

    await top();
    // Loading older history must retain the reader's visible message and offset.
    const before = await page
      .getByText(`Long request ${firstIndex}`, { exact: true })
      .boundingBox();
    await panel.dispatchEvent("wheel", { deltaY: -100 });
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>(".load-more")?.disabled,
    );
    await page
      .waitForFunction(
        ({ y, index }) => {
          const anchor = document.querySelector(
            `[data-message-key="long-turn/long-${index}"] .user-message > div`,
          );
          return (
            anchor && Math.abs(anchor.getBoundingClientRect().top - y) < 10
          );
        },
        { y: before!.y, index: firstIndex },
      )
      .catch(async (error) => {
        console.error("History anchor", {
          before,
          actual: await page.evaluate((index) => {
            const panel = document.querySelector(".chat-scroll")!;
            const list = document.querySelector(".browser-transcript")!;
            const row = document.querySelector(
              `[data-message-key="long-turn/long-${index}"]`,
            )!;
            return {
              scrollTop: panel.scrollTop,
              panelTop: panel.getBoundingClientRect().top,
              listTop: list.getBoundingClientRect().top,
              rowTop: row.getBoundingClientRect().top,
              textTop: row
                .querySelector(".user-message > div")!
                .getBoundingClientRect().top,
            };
          }, firstIndex),
        });
        throw error;
      });
    // Late ResizeObserver/iOS scroll compensation must preserve it too.
    await page.waitForTimeout(500);
    const after = await page
      .getByText(`Long request ${firstIndex}`, { exact: true })
      .boundingBox();
    assert.ok(
      before && after && Math.abs(before.y - after.y) < 10,
      `Prepending history preserves the visible anchor (${before?.y} -> ${after?.y})`,
    );
    for (
      let pages = 0;
      await page.getByRole("button", { name: "Earlier messages" }).count();
      pages++
    ) {
      assert.ok(pages < 20, "History pagination terminates");
      await panel.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page
        .getByRole("button", { name: "Earlier messages", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>(".load-more")?.disabled,
      );
    }
    firstIndex = 0;
    await top();
    await panel.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page
      .getByText("Earlier performance history", { exact: true })
      .waitFor();

    await top();
    const firstTool = page.locator(
      '[data-message-key="long-turn/long-1"] .tool-item',
    );
    await firstTool.locator("summary").click();
    await firstTool.locator("pre").waitFor();
    assert.match(await firstTool.locator("pre").innerText(), /Tool output 1/);
    // Visible content can precede the virtualizer's ResizeObserver measurement.
    // Wait for adjacent rows to settle before jumping to the measured bottom.
    await toolLayout();
    await bottom();
    assert.equal(
      await page.getByText("Long request 0", { exact: true }).count(),
      0,
      "Offscreen history is unmounted",
    );
    await top();
    await firstTool.locator("pre").waitFor();
    await firstTool.locator("summary").click();
    await firstTool.locator("pre").waitFor({ state: "detached" });
    await toolLayout();

    // Reading the middle while the tail streams must not pull the reader down.
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await page.waitForTimeout(250);
    const anchor = await panel.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const row = [
        ...element.querySelectorAll<HTMLElement>(".browser-message"),
      ].find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top <= top && rect.bottom > top;
      })!;
      return {
        key: row.dataset.messageKey!,
        y: row.getBoundingClientRect().top,
      };
    });
    for (let index = 0; index < 60; index++)
      host.codex.emit("notification", {
        method: "item/agentMessage/delta",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          itemId: "long-1199",
          delta: " streamed",
        },
      });
    await page.waitForTimeout(300);
    const anchorAfter = await page
      .locator(`[data-message-key="${anchor.key}"]`)
      .boundingBox();
    assert.ok(
      anchorAfter && Math.abs(anchorAfter.y - anchor.y) < 10,
      "Streaming preserves a history reader's position",
    );
    assert.ok((await page.locator(".browser-message").count()) < 80);
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByText(/Long reply 1199/).waitFor();
    for (let index = 0; index < 30; index++)
      host.codex.emit("notification", {
        method: "item/agentMessage/delta",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          itemId: "long-1199",
          delta: "\n\nFollowing new output.",
        },
      });
    await page.waitForFunction(() => {
      const element = document.querySelector(".chat-scroll")!;
      return (
        element.scrollHeight - element.scrollTop - element.clientHeight < 5
      );
    });
    assert.equal(
      await page.getByLabel("Message your agent").inputValue(),
      "A responsive draft in a long conversation",
    );
    console.log(
      `Long conversation: 1,200 items / 40+ MB original tools, ${openingMs} ms open, ${Math.round(typingP95)} ms input-to-frame p95 (empty chat ${Math.round(baselineP95)} ms); bounded rendering, tool details, pagination and live scroll passed`,
    );
    await page.getByLabel("Message your agent").fill("");
  } finally {
    host.codex.rpc = rpc;
    await host.handle("thread.delete", { id: thread.id, confirm: thread.id });
  }
}
