import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { HostService } from "../src/host/service";

// Browser controls and encrypted RPC are real; approval requests come from the
// isolated fixture runtime, never from a creator's conversation.
export async function autoApproveSmoke(
  page: Page,
  host: HostService,
  threadId: string,
) {
  const respond = host.codex.respond;
  const decisions: { id: string | number; result: unknown }[] = [];
  host.codex.respond = (id, result) => {
    decisions.push({ id, result });
  };
  const emit = (
    id: string,
    method = "item/commandExecution/requestApproval",
    params = {},
  ) =>
    host.codex.emit("request", {
      id,
      method,
      params: {
        threadId,
        command: "Write-Output 'isolated fixture'",
        ...params,
      },
    });
  const on = () =>
    page.getByRole("button", { name: "Auto-approve on", exact: true });
  const off = () =>
    page.getByRole("button", { name: "Auto-approve off", exact: true });
  const manual = async (id: string) => {
    emit(id);
    const card = page.locator(".approval-card");
    await card.waitFor();
    assert.ok(!decisions.some((d) => d.id === id));
    await card.getByRole("button", { name: "Decline", exact: true }).click();
    await card.waitFor({ state: "detached" });
  };
  try {
    // Opt-in also resolves an already pending supported approval in this chat.
    emit("auto-pending");
    await page.locator(".approval-card").waitFor();
    await off().click();
    await on().waitFor();
    await page.locator(".approval-card").waitFor({ state: "detached" });
    assert.deepEqual(decisions[0], {
      id: "auto-pending",
      result: { decision: "accept" },
    });
    emit("auto-file", "item/fileChange/requestApproval");
    emit("auto-permissions", "item/permissions/requestApproval", {
      permissions: { network: { enabled: true } },
    });
    assert.equal(decisions.length, 3);
    await page.locator(".auto-approve-history summary").waitFor();
    await page.locator(".auto-approve-history summary").click();
    await page.getByText(/Permissions automatically approved ·/).waitFor();
    if (process.env.AGENTVIEW_PWA_CAPTURES)
      await page.screenshot({
        path: `${process.env.AGENTVIEW_PWA_CAPTURES}/${page.context().browser()!.browserType().name()}-auto-approve.png`,
      });
    // Requests without a chat identity, and requests in another chat, stay manual.
    emit("auto-other", "item/commandExecution/requestApproval", {
      threadId: "another-chat",
    });
    assert.equal(decisions.length, 3);
    await host.handle("approval.respond", { id: "auto-other", allow: false });
    emit("auto-question", "item/tool/requestUserInput", {
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Choose a fixture color",
          options: [
            { label: "Blue", description: "Use blue" },
            { label: "Green", description: "Use green" },
          ],
        },
      ],
    });
    await page.locator(".approval-card").waitFor();
    assert.ok(!decisions.some((d) => d.id === "auto-question"));
    await host.handle("approval.respond", {
      id: "auto-question",
      answers: { choice: { answers: ["Blue"] } },
    });
    await page.locator(".approval-card").waitFor({ state: "detached" });
    const url = page.url().split("#")[0];
    // Leave the app's service-worker scope as well as its WebSocket client.
    await page.goto("about:blank");
    // No client is needed to answer the fixture runtime's request.
    emit("auto-away");
    assert.deepEqual(decisions.at(-1), {
      id: "auto-away",
      result: { decision: "accept" },
    });
    await page.goto(`${url}#thread=${encodeURIComponent(threadId)}`);
    await on().waitFor();
    assert.equal(await on().getAttribute("aria-pressed"), "true");
    await page.reload();
    await on().waitFor();
    await host.handle("host.preferences.update", {
      defaultPermissions: "workspace",
    });
    await page
      .getByRole("button", { name: "Auto-approve paused", exact: true })
      .waitFor();
    await manual("auto-paused");
    await host.handle("host.preferences.update", {
      defaultPermissions: "full",
    });
    await on().waitFor();
    await on().click();
    await off().waitFor();
    await manual("auto-off");
    await page.reload();
    await off().waitFor();
    assert.equal(await off().getAttribute("aria-pressed"), "false");
    assert.ok(!host.snapshot().autoApproveThreads?.includes(threadId));
  } finally {
    host.codex.respond = respond;
    await host.handle("thread.autoApprove", { id: threadId, enabled: false });
  }
}
