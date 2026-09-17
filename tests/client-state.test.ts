import test from "node:test";
import assert from "node:assert/strict";
import {
  drafts,
  attachments,
  outbox,
  restoreClientState,
  clearClientState,
  setClientPersistence,
  saveDrafts,
  requestWithReceipt,
  recoverRequests,
  type ClientState,
} from "../src/ui/client-state";

test("client persistence isolates hosts and recovers uncertain receipts without repeating work", async () => {
  let stored: ClientState | undefined;
  setClientPersistence(async (state) => {
    stored = structuredClone(state);
  });
  restoreClientState("first");
  drafts.set("chat", "unsent work");
  attachments.set("chat", [
    { id: "upload", name: "image", mime: "image/png", size: 10 },
  ]);
  await saveDrafts("chat");
  const saved = stored!;
  assert.equal(restoreClientState("first", saved), "chat");
  assert.equal(drafts.get("chat"), "unsent work");
  const requests: string[] = [];
  await assert.rejects(
    requestWithReceipt(
      async (method) => {
        requests.push(method);
        throw new Error("Disconnected.");
      },
      "thread.send",
      { id: "chat", clientUserMessageId: "request" },
      true,
    ),
  );
  assert.equal(outbox.get("request")?.state, "uncertain");
  const events: any[] = [];
  await recoverRequests(
    async (method) => {
      requests.push(method);
      return { state: "accepted", result: { threadId: "chat" } };
    },
    (event) => events.push(event),
  );
  assert.deepEqual(requests, ["request.execute", "request.status"]);
  assert.equal(events[0].type, "requestRecovered");
  assert.equal(outbox.get("request")?.state, "accepted");
  restoreClientState("second", saved);
  assert.equal(drafts.size + attachments.size + outbox.size, 0);
  await clearClientState();
});

test("a host switch while persistence is pending prevents sending the old workspace action", async () => {
  let release!: () => void;
  setClientPersistence(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  restoreClientState("first");
  let sent = false;
  const request = requestWithReceipt(
    async () => {
      sent = true;
    },
    "thread.send",
    {},
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  restoreClientState("second");
  release();
  await assert.rejects(request, /Workspace changed/);
  assert.equal(sent, false);
  await clearClientState();
});
