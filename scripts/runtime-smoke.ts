// Explicit live check: uses the signed-in account, owns and removes one test thread.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Codex, findCodex } from "../src/host/codex";
import { threadPolicy, turnPolicy } from "../src/host/permissions";

const root = await mkdtemp(path.join(os.tmpdir(), "agentview-runtime-check-"));
const cwd = path.join(root, "workspace");
await mkdir(cwd);
const output = path.join(root, "outside-workspace.txt");
const first = new Codex(),
  second = new Codex();
let id: string | undefined;
try {
  const executable = await findCodex();
  await first.start(executable);
  const started = await first.rpc("thread/start", {
    cwd,
    ephemeral: false,
    ...threadPolicy("full"),
  });
  id = started.thread.id;
  assert.equal(started.approvalPolicy, "on-request");
  assert.equal(started.sandbox.type, "dangerFullAccess");
  await first.rpc("thread/name/set", {
    threadId: id,
    name: "AgentView isolated runtime validation",
  });
  let approvals = 0;
  first.on("request", (r) => {
    approvals++;
    first.respond(r.id, { decision: "decline" });
  });
  const completed = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Live test exceeded three minutes")),
      180000,
    );
    first.on("notification", (event) => {
      if (event.method === "turn/completed" && event.params.threadId === id) {
        clearTimeout(timeout);
        resolve(event.params.turn);
      }
    });
  });
  await first.rpc("turn/start", {
    threadId: id,
    ...turnPolicy("full", cwd),
    input: [
      {
        type: "text",
        text: `This is a bounded AgentView integration check. Use your shell to write the exact text AGENTVIEW_OK to this file outside your working folder: ${output}. No other files should be changed. Then describe the attached image in one sentence. Do not ask for confirmation. Do not contact external services or start other work.`,
      },
      { type: "localImage", path: path.resolve("assets/icon.png") },
    ],
  });
  const turn = await completed;
  assert.equal(turn.status, "completed");
  assert.equal(approvals, 0);
  assert.equal((await readFile(output, "utf8")).trim(), "AGENTVIEW_OK");
  first.close();
  await second.start(executable);
  const read = await second.rpc("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  assert.equal(read.thread.ephemeral, false);
  assert.equal(read.thread.name, "AgentView isolated runtime validation");
  assert.ok(
    read.thread.turns.some((t: any) =>
      t.items.some((i: any) => i.type === "agentMessage" && i.text),
    ),
  );
  const resumed = await second.rpc("thread/resume", {
    threadId: id,
    ...threadPolicy("full"),
  });
  assert.equal(resumed.thread.id, id);
  assert.equal(resumed.approvalPolicy, "on-request");
  assert.equal(resumed.sandbox.type, "dangerFullAccess");
  console.log(
    JSON.stringify({
      threadId: id,
      persisted: true,
      independentResume: true,
      fullAccess: true,
      approvalRequests: approvals,
      imageResponse: true,
    }),
  );
} finally {
  if (id) {
    const runtime = second.ready ? second : first;
    if (!runtime.ready) await runtime.start(await findCodex());
    await runtime.rpc("thread/delete", { threadId: id });
  }
  first.close();
  second.close();
  await rm(root, { recursive: true, force: true });
}
