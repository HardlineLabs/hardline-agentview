import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HostService } from "../src/host/service";

// Deterministic runtime behind real TLS and encrypted Host transport.
export async function makeClientHost(
  temporary: string,
  name: string,
  readDelay: () => number = () => 0,
) {
  const root = path.join(temporary, name);
  const vault = path.join(root, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(
    path.join(vault, "Home.md"),
    `---\ntype: guide\ndomain: company\nstatus: current\n---\n# ${name} workspace\n\n[[Ideas]]\n`,
  );
  await writeFile(
    path.join(vault, "Ideas.md"),
    `---\ntype: reference\ndomain: agentview\nstatus: current\n---\n# ${name} ideas\n\nA private note for ${name}.\n`,
  );
  await writeFile(
    path.join(vault, "Large.md"),
    "# Large note\n" + "Workspace content. ".repeat(35000),
  );
  const host = new HostService(
    { vaultPath: vault, port: 0, codexPath: "", autoStart: false },
    path.join(root, "host"),
  );
  const thread = {
    id: `${name}-thread`,
    name: `${name} conversation`,
    preview: "Plan a small useful project",
    cwd: vault,
    updatedAt: Date.now() / 1000,
    createdAt: Date.now() / 1000,
    status: { type: "idle" },
  };
  const fixtureThreads = new Map<string, any>([[thread.id, thread]]);
  const fixtureTurns = new Map<string, any[]>();
  host.codex.start = async () => {
    host.codex.ready = true;
  };
  host.codex.rpc = async (method: string, params: any) => {
    if (method === "model/list")
      return {
        data: [
          {
            id: "fixture",
            model: "fixture",
            displayName: "Test agent",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "High" },
              { reasoningEffort: "low", description: "Low" },
            ],
          },
        ],
      };
    if (method === "thread/list")
      return {
        data: [...fixtureThreads.values()].filter(
          (t) => Boolean(t.archived) === Boolean(params?.archived),
        ),
      };
    if (method === "thread/start") {
      const created = {
        ...thread,
        id: crypto.randomUUID(),
        name: "New fixture",
        preview: "",
        ephemeral: false,
      };
      fixtureThreads.set(created.id, created);
      fixtureTurns.set(created.id, []);
      return { thread: created };
    }
    if (method === "thread/name/set") {
      fixtureThreads.get(params.threadId).name = params.name;
      return {};
    }
    if (method === "thread/archive" || method === "thread/unarchive") {
      fixtureThreads.get(params.threadId).archived =
        method === "thread/archive";
      return {};
    }
    if (method === "thread/delete") {
      fixtureThreads.delete(params.threadId);
      return {};
    }
    if (method === "turn/start") {
      const turn = {
        id: crypto.randomUUID(),
        status: "inProgress",
        items: [
          {
            id: crypto.randomUUID(),
            type: "userMessage",
            content: params.input,
          },
        ],
      };
      fixtureTurns.set(params.threadId, [
        ...(fixtureTurns.get(params.threadId) || []),
        turn,
      ]);
      setTimeout(() => {
        turn.status = "completed";
        (turn.items as any[]).push({
          id: crypto.randomUUID(),
          type: "agentMessage",
          text: params.input.some((i: any) => i.type === "localImage")
            ? "Image received by the host runtime."
            : "Onboarding received by the host runtime.",
        });
        host.codex.emit("notification", {
          method: "turn/completed",
          params: { threadId: params.threadId, turn },
        });
      }, 150);
      return { turn };
    }
    if (method === "thread/read") {
      if (readDelay())
        await new Promise((resolve) => setTimeout(resolve, readDelay()));
      return { thread: fixtureThreads.get(params.threadId) };
    }
    if (method === "thread/turns/list" && fixtureTurns.has(params.threadId))
      return {
        data: [...fixtureTurns.get(params.threadId)!].reverse(),
        nextCursor: null,
      };
    if (method === "thread/turns/list")
      return {
        data: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "message-1",
                type: "agentMessage",
                text: `Welcome to ${name}. Your workspace stays on this computer.`,
              },
              {
                id: "long-message",
                type: "agentMessage",
                text:
                  Array.from(
                    { length: 35 },
                    (_, i) =>
                      `Paragraph ${i + 1}. A long conversation should scroll only inside the message panel.`,
                  ).join("\n\n") +
                  "\n\n```text\n" +
                  "wide-output-".repeat(100) +
                  "\n```",
              },
            ],
          },
        ],
        nextCursor: null,
      };
    if (method === "account/rateLimits/read")
      return {
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: Date.now() / 1000 + 7200,
          },
        },
      };
    return { data: [] };
  };
  await host.start();
  host.settings.remoteAddress = `wss://127.0.0.1:${host.settings.port}/`;
  return host;
}
