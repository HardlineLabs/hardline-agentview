import https from "node:https";
import { randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import selfsigned from "selfsigned";
import { WebSocketServer, WebSocket } from "ws";
import { Vault } from "./vault";
import { Codex, findCodex } from "./codex";
import { applyConversationEvent } from "../shared/conversation";
import { SessionObserver, type ObservedAction } from "./observer";
import {
  listAll,
  threadSources,
  desktopAssignments,
  assignProjects,
} from "./catalog";
import type {
  Activity,
  Agent,
  AppEvent,
  Approval,
  ChatItem,
  Connection,
  HostSettings,
  HostStatus,
  Model,
  Snapshot,
  Thread,
  Turn,
  Project,
  TokenUsage,
  AccountLimits,
} from "../shared/types";

export function encodeConnection(c: Connection) {
  return "agentview://" + Buffer.from(JSON.stringify(c)).toString("base64url");
}
export function decodeConnection(code: string): Connection {
  const c = JSON.parse(
    Buffer.from(
      code.trim().replace(/^agentview:\/\//, ""),
      "base64url",
    ).toString(),
  );
  const url = new URL(c.address);
  if (
    url.protocol !== "wss:" ||
    !c.token ||
    !/^[A-Fa-f0-9:]{64,95}$/.test(c.fingerprint)
  )
    throw new Error("Paste the connection key from AgentView Host.");
  return c;
}
export function visibleItems(items: ChatItem[]) {
  return items.filter((i) => !["reasoning", "hookPrompt"].includes(i.type));
}
export function describeAction(item: any): {
  action: string;
  detail: string;
  targetText: string;
} {
  const text = item.command || item.tool || item.query || item.type;
  let action = "working";
  if (item.type === "fileChange") action = "editing";
  else if (item.type === "webSearch") action = "searching";
  else if (item.type === "agentMessage") action = "responding";
  else if (item.type === "collabAgentToolCall") action = "coordinating";
  else if (item.type === "sleep") action = "waiting";
  else if (item.commandActions?.some((a: any) => a.type === "read"))
    action = "reading";
  else if (item.commandActions?.some((a: any) => a.type === "search"))
    action = "searching";
  else if (item.type === "commandExecution") action = "running";
  else if (item.type === "mcpToolCall" && item.readOnlyHint === true)
    action = "reading";
  return {
    action,
    detail: String(text).slice(0, 180),
    targetText: JSON.stringify({
      command: item.command,
      commandActions: item.commandActions,
      changes: item.changes,
      arguments: item.arguments,
      path: item.path,
    }),
  };
}

export class HostService extends EventEmitter {
  vault: Vault;
  codex = new Codex();
  private server?: https.Server;
  private sockets = new Set<WebSocket>();
  private threads: Thread[] = [];
  private models: Model[] = [];
  private projects: Project[] = [];
  private sections: { id: string; name: string }[] = [];
  private usage = new Map<string, TokenUsage>();
  private limits: AccountLimits = { buckets: [], checkedAt: 0 };
  private limitsPoll?: NodeJS.Timeout;
  private readingLimits = false;
  private agents = new Map<string, Agent>();
  private activity: Activity[] = [];
  private approvals = new Map<string | number, Approval>();
  private owned = new Set<string>();
  private loaded = new Set<string>();
  private activeTurns = new Map<string, string>();
  private liveThreads = new Map<string, Thread>();
  private liveTurns = new Map<string, Turn[]>();
  private observer?: SessionObserver;
  private commands = new Map<string, Promise<any>>();
  private poll?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private refreshing = false;
  private token = "";
  private fingerprint = "";
  private started = Date.now();
  private error = "";
  private stopping = false;
  constructor(
    public settings: HostSettings,
    private dataDir: string,
  ) {
    super();
    this.vault = new Vault(settings.vaultPath);
    this.vault.on("graph", (graph) => {
      this.broadcast({ type: "graph", graph, projects: this.allProjects() });
      this.emit("status");
    });
    this.vault.on("change", (e) =>
      this.record({
        action: e.action,
        target: e.target,
        detail: `${e.target} ${e.action}`,
      }),
    );
    this.vault.on("fault", (message) => {
      this.error = message;
      this.emit("status");
    });
    this.codex.on("notification", (message) => this.onAgentEvent(message));
    this.codex.on("request", (request) => {
      if (request.params?.threadId)
        this.setAgent(request.params.threadId, {
          action: "waiting",
          active: true,
          detail: "Waiting for your response",
        });
      this.approvals.set(request.id, request);
      this.broadcast({
        type: "approvals",
        approvals: [...this.approvals.values()],
      });
    });
    this.codex.on("status", () => {
      this.emit("status");
      this.broadcast({
        type: "agentStatus",
        ready: this.codex.ready,
        error: this.codex.error,
      });
    });
  }
  async start() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const certPath = path.join(this.dataDir, "host-identity.json");
    let identity: { private: string; cert: string; token: string };
    try {
      identity = JSON.parse(await fs.readFile(certPath, "utf8"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      const pair = await selfsigned.generate(
        [{ name: "commonName", value: "AgentView Host" }],
        { keySize: 2048, days: 3650, algorithm: "sha256" },
      );
      identity = {
        private: pair.private,
        cert: pair.cert,
        token: randomBytes(32).toString("hex"),
      };
      await fs.writeFile(certPath, JSON.stringify(identity), { mode: 0o600 });
    }
    this.token = identity.token;
    this.fingerprint = new X509Certificate(identity.cert).fingerprint256;
    try {
      this.owned = new Set(
        JSON.parse(
          await fs.readFile(path.join(this.dataDir, "threads.json"), "utf8"),
        ),
      );
    } catch {
      /* No conversations yet. */
    }
    await this.vault.start();
    this.server = https.createServer(
      { key: identity.private, cert: identity.cert },
      (_req, res) => {
        res.writeHead(404);
        res.end();
      },
    );
    const wss = new WebSocketServer({
      server: this.server,
      maxPayload: 1_048_576,
    });
    wss.on("connection", (socket) => {
      let authenticated = false;
      const timeout = setTimeout(
        () => socket.close(4001, "Pairing required"),
        5000,
      );
      socket.on("message", async (bytes) => {
        let request: any;
        try {
          request = JSON.parse(bytes.toString());
          if (!authenticated) {
            const supplied = Buffer.from(String(request.token || ""));
            const expected = Buffer.from(this.token);
            if (
              request.type !== "auth" ||
              supplied.length !== expected.length ||
              !timingSafeEqual(supplied, expected)
            ) {
              socket.close(4003, "Connection key does not match");
              return;
            }
            authenticated = true;
            clearTimeout(timeout);
            this.sockets.add(socket);
            socket.send(
              JSON.stringify({ type: "snapshot", snapshot: this.snapshot() }),
            );
            this.emit("status");
            return;
          }
          if (!request.id || typeof request.method !== "string")
            throw new Error("Invalid request.");
          const key = String(request.id);
          let result: any;
          // Keep command outcomes through reconnect; duplicate sends never start a second turn.
          if (
            [
              "thread.send",
              "thread.steer",
              "thread.create",
              "thread.archive",
              "thread.unarchive",
              "thread.delete",
              "approval.respond",
            ].includes(request.method)
          ) {
            if (!this.commands.has(key))
              this.commands.set(
                key,
                this.handle(request.method, request.params || {}),
              );
            result = await this.commands.get(key);
            if (this.commands.size > 500)
              this.commands.delete(this.commands.keys().next().value!);
          } else
            result = await this.handle(request.method, request.params || {});
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({ type: "response", id: request.id, result }),
            );
        } catch (e: any) {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: "response",
                id: request?.id,
                error: e.message || "Request failed.",
              }),
            );
        }
      });
      socket.on("close", () => {
        clearTimeout(timeout);
        this.sockets.delete(socket);
        this.emit("status");
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.settings.port, "0.0.0.0", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    this.settings.port = (this.server.address() as { port: number }).port;
    this.server.on("error", (e) => {
      this.error = e.message;
      this.emit("status");
    });
    this.heartbeat = setInterval(
      () => this.broadcast({ type: "heartbeat", time: Date.now() }),
      10_000,
    );
    void this.connectAgent();
    this.poll = setInterval(() => void this.refreshThreads(), 6000);
    this.limitsPoll = setInterval(() => void this.refreshLimits(), 60_000);
    this.emit("status");
  }
  async connectAgent() {
    try {
      await this.codex.start(await findCodex(this.settings.codexPath));
      if (this.codex.codexHome) {
        this.observer = new SessionObserver(this.codex.codexHome);
        this.observer.on("usage", ({ threadId, usage }) =>
          this.setUsage(threadId, usage),
        );
        this.observer.on("activity", (event: ObservedAction) => {
          const target = this.vault.matchTarget(event.targetText);
          this.setAgent(event.threadId, {
            action: event.action,
            active: event.active,
            target,
            parentId: event.parentId,
            name: event.name,
          });
          if (event.active && event.action !== "working")
            this.record({
              threadId: event.threadId,
              agentId: event.threadId,
              action: event.action,
              target,
              detail: target
                ? `${event.action} ${path.basename(target)}`
                : `${event.name} · ${event.action}`,
            });
        });
      }
      const result = await this.codex.rpc("model/list");
      this.models = result.data || [];
      await this.refreshThreads();
      await this.refreshLimits();
      this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
    } catch (e: any) {
      this.codex.error = e.message;
      this.codex.ready = false;
      this.emit("status");
      this.broadcast({ type: "agentStatus", ready: false, error: e.message });
    }
  }
  async refreshThreads() {
    if (!this.codex.ready || this.refreshing || this.stopping) return;
    this.refreshing = true;
    try {
      const rpc = this.codex.rpc.bind(this.codex);
      const [active, archived, projects, legacy, sections] = await Promise.all([
        listAll<Thread>(rpc, "thread/list", {
          sortKey: "updated_at",
          sourceKinds: threadSources,
          modelProviders: [],
        }),
        listAll<Thread>(rpc, "thread/list", {
          sortKey: "updated_at",
          sourceKinds: threadSources,
          modelProviders: [],
          archived: true,
        }),
        listAll<any>(rpc, "project/list").catch(() => []),
        desktopAssignments(this.codex.codexHome),
        listAll<{ id: string; name: string }>(rpc, "threadSection/list").catch(
          () => [],
        ),
      ]);
      this.sections = sections;
      this.projects = projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.roots?.[0]?.path || "",
        runtime: true,
      }));
      const merged = new Map<string, Thread>(
        [
          ...active.map((t) => ({ ...t, archived: false })),
          ...archived.map((t) => ({ ...t, archived: true })),
        ].map((t: Thread) => [
          t.id,
          { ...t, owned: this.owned.has(t.id), usage: this.usage.get(t.id) },
        ]),
      );
      for (const [id, live] of this.liveThreads)
        if (!merged.has(id)) merged.set(id, { ...live, owned: true });
      this.threads = assignProjects(
        [...merged.values()],
        this.allProjects(),
        legacy,
      ).sort((a, b) => b.updatedAt - a.updatedAt);
      await this.observer?.track(this.threads);
      this.broadcast({
        type: "threads",
        threads: this.threads,
        projects: this.allProjects(),
        sections: this.sections,
      });
    } catch (e: any) {
      this.emit("diagnostic", e.message);
    } finally {
      this.refreshing = false;
    }
  }
  private allProjects(): Project[] {
    return [
      ...this.projects,
      ...this.vault.projects.filter(
        (p) =>
          !this.projects.some(
            (other) =>
              other.path &&
              path.resolve(other.path).toLowerCase() ===
                path.resolve(p.path).toLowerCase(),
          ),
      ),
    ];
  }
  async refreshLimits() {
    if (!this.codex.ready || this.readingLimits || this.stopping) return;
    this.readingLimits = true;
    try {
      const result = await this.codex.rpc("account/rateLimits/read", null);
      this.limits = {
        buckets: result.rateLimitsByLimitId
          ? Object.values(result.rateLimitsByLimitId)
          : result.rateLimits
            ? [result.rateLimits]
            : [],
        checkedAt: Date.now(),
      };
    } catch {
      this.limits = {
        ...this.limits,
        error:
          "Codex usage limits are unavailable. Last received values may be out of date.",
      };
    } finally {
      this.readingLimits = false;
      this.broadcast({ type: "limits", limits: this.limits });
    }
  }
  private setUsage(threadId: string, usage: TokenUsage) {
    if (
      !usage ||
      !Number.isFinite(usage.last?.totalTokens) ||
      !Number.isFinite(usage.total?.totalTokens)
    )
      return;
    this.usage.set(threadId, usage);
    const thread = this.threads.find((t) => t.id === threadId);
    if (thread) thread.usage = usage;
    this.broadcast({ type: "usage", threadId, usage });
  }
  private record(event: Omit<Activity, "id" | "time">) {
    const activity = {
      ...event,
      id: randomBytes(8).toString("hex"),
      time: Date.now(),
    };
    this.activity = [activity, ...this.activity].slice(0, 100);
    this.broadcast({ type: "activity", activity });
  }
  private setAgent(threadId: string, patch: Partial<Agent>) {
    const thread = this.threads.find((t) => t.id === threadId);
    const current = this.agents.get(threadId) || {
      id: threadId,
      threadId,
      name: thread?.agentNickname || "Agent",
      parentId: thread?.parentThreadId,
      action: "working",
      active: true,
      updated: Date.now(),
    };
    this.agents.set(threadId, { ...current, ...patch, updated: Date.now() });
    if (this.agents.size > 30) {
      const old = [...this.agents.values()]
        .filter((a) => !a.active)
        .sort((a, b) => a.updated - b.updated)[0];
      if (old) this.agents.delete(old.id);
    }
    this.broadcast({ type: "agents", agents: [...this.agents.values()] });
  }
  private onAgentEvent(message: any) {
    const { method, params: p } = message;
    if (!p) return;
    const tid = p.threadId || p.thread?.id;
    if (method === "thread/tokenUsage/updated")
      this.setUsage(tid, p.tokenUsage);
    if (method === "account/rateLimits/updated") {
      const bucket = p.rateLimits;
      if (bucket)
        this.limits = {
          buckets: [
            ...this.limits.buckets.filter((b) => b.limitId !== bucket.limitId),
            bucket,
          ],
          checkedAt: Date.now(),
        };
      this.broadcast({ type: "limits", limits: this.limits });
    }
    if (
      ["thread/archived", "thread/deleted", "thread/unarchived"].includes(
        method,
      )
    ) {
      this.liveThreads.delete(tid);
      this.liveTurns.delete(tid);
      this.loaded.delete(tid);
      this.agents.delete(tid);
      if (method === "thread/deleted") {
        this.owned.delete(tid);
        this.usage.delete(tid);
        void this.saveOwned();
      }
      this.broadcast({
        type: "threadChanged",
        threadId: tid,
        action: method.split("/")[1],
      });
      void this.refreshThreads();
    }
    if (tid && (method.startsWith("item/") || method.startsWith("turn/")))
      this.liveTurns.set(
        tid,
        applyConversationEvent(this.liveTurns.get(tid) || [], method, p).slice(
          -30,
        ),
      );
    if (method === "thread/started") {
      void this.refreshThreads();
    }
    if (method === "turn/started") {
      this.activeTurns.set(tid, p.turn.id);
      this.setAgent(tid, { action: "working", active: true });
    }
    if (method === "turn/completed") {
      this.activeTurns.delete(tid);
      this.setAgent(tid, {
        action: p.turn.status === "failed" ? "error" : "finished",
        active: false,
      });
      this.record({
        threadId: tid,
        agentId: tid,
        action: p.turn.status,
        detail:
          p.turn.error?.message ||
          (p.turn.status === "completed" ? "Work complete" : "Work stopped"),
      });
      void this.refreshThreads();
    }
    if (method === "item/started" || method === "item/completed") {
      const item = p.item;
      if (item?.type === "reasoning" || item?.type === "hookPrompt") return;
      if (method === "item/started" && item?.type !== "userMessage") {
        const described = describeAction(item);
        const target = this.vault.matchTarget(described.targetText);
        this.setAgent(tid, {
          action: described.action,
          target,
          detail: described.detail,
          active: true,
        });
        if (described.action !== "responding")
          this.record({
            threadId: tid,
            agentId: tid,
            action: described.action,
            target,
            detail: described.detail,
          });
      }
      if (item?.type === "collabAgentToolCall")
        for (const childId of item.receiverThreadIds || []) {
          const state = item.agentsStates?.[childId];
          this.setAgent(childId, {
            parentId: tid,
            name: state?.agentNickname || "Subagent",
            active: !["completed", "shutdown", "errored"].includes(
              state?.status,
            ),
            action: state?.status || "working",
          });
        }
      if (item?.type === "subAgentActivity")
        this.setAgent(item.agentThreadId, {
          parentId: tid,
          name: item.agentPath.split("/").pop(),
          action: typeof item.kind === "string" ? item.kind : "working",
          active: !["completed", "interrupted"].includes(item.kind),
        });
    }
    if (method.includes("reasoning") || method.startsWith("account/")) return;
    if (
      method.startsWith("item/") ||
      method.startsWith("turn/") ||
      method === "error" ||
      method === "thread/status/changed"
    )
      this.broadcast({ type: "agentEvent", method, params: p });
  }
  async handle(method: string, p: any): Promise<any> {
    if (method === "snapshot") return this.snapshot();
    if (method === "note.read") return this.vault.read(String(p.id));
    if (!this.codex.ready)
      throw new Error(this.codex.error || "Agent connection is starting.");
    if (method === "thread.list")
      return this.codex.rpc("thread/list", {
        limit: 100,
        cursor: p.cursor || null,
        sortKey: "updated_at",
        sourceKinds: threadSources,
        modelProviders: [],
        archived: Boolean(p.archived),
      });
    if (method === "thread.read") {
      let thread = this.liveThreads.get(p.id);
      let history: Turn[] = [];
      let nextCursor = null;
      try {
        ({ thread } = await this.codex.rpc("thread/read", { threadId: p.id }));
        const page = await this.codex.rpc("thread/turns/list", {
          threadId: p.id,
          limit: 15,
          itemsView: "full",
          sortDirection: "desc",
          cursor: p.cursor || null,
        });
        history = page.data.reverse();
        nextCursor = page.nextCursor;
      } catch (e) {
        if (!thread || p.cursor) throw e;
      }
      const turns = new Map(
        history.map((t) => [t.id, { ...t, items: visibleItems(t.items) }]),
      );
      if (!p.cursor)
        for (const turn of this.liveTurns.get(p.id) || [])
          turns.set(turn.id, turn);
      return {
        thread: {
          ...thread!,
          ...this.threads.find((t) => t.id === p.id),
          owned: this.owned.has(p.id),
          usage: this.usage.get(p.id),
        },
        turns: [...turns.values()].map((turn) =>
          this.owned.has(p.id) &&
          !this.loaded.has(p.id) &&
          turn.status === "inProgress"
            ? {
                ...turn,
                status: "interrupted",
                error: {
                  message:
                    "The host restarted before this turn completed. Send a message to continue.",
                },
              }
            : turn,
        ),
        nextCursor,
      };
    }
    if (method === "thread.create") {
      const project =
        this.allProjects().find((project) => project.id === p.projectId) ||
        this.vault.projects[0];
      if (!project?.path)
        throw new Error("Choose a workspace with a local folder.");
      const { thread } = await this.codex.rpc("thread/start", {
        cwd: project.path,
        ...(project.runtime ? { projectId: project.id } : {}),
        ...(p.model ? { model: p.model } : {}),
        historyMode: "paginated",
      });
      this.liveThreads.set(thread.id, thread);
      this.owned.add(thread.id);
      this.loaded.add(thread.id);
      await this.saveOwned();
      await this.refreshThreads();
      return { ...thread, owned: true };
    }
    if (
      ["thread.archive", "thread.unarchive", "thread.delete"].includes(method)
    ) {
      const id = String(p.id);
      const thread = this.threads.find((t) => t.id === id);
      if (!thread)
        throw new Error("Conversation no longer exists. Refresh the list.");
      if (
        this.activeTurns.has(id) ||
        this.agents.get(id)?.active ||
        thread.status.type === "active"
      )
        throw new Error(
          "Wait for this agent to finish or stop it before clearing the conversation.",
        );
      if (method === "thread.delete" && p.confirm !== id)
        throw new Error(
          "Confirm permanent deletion of this conversation and its subagents.",
        );
      const result = await this.codex.rpc(method.replace(".", "/"), {
        threadId: id,
      });
      this.liveThreads.delete(id);
      this.liveTurns.delete(id);
      this.loaded.delete(id);
      if (method === "thread.delete") {
        this.owned.delete(id);
        await this.saveOwned();
      }
      await this.refreshThreads();
      return result;
    }
    if (method === "thread.send" || method === "thread.steer") {
      if (
        typeof p.text !== "string" ||
        !p.text.trim() ||
        p.text.length > 100_000
      )
        throw new Error("Enter a message of up to 100,000 characters.");
      let id = String(p.id);
      if (this.threads.find((t) => t.id === id)?.archived)
        throw new Error("Restore this conversation before sending a message.");
      let text = p.text;
      if (p.noteId) {
        const note = this.vault.read(p.noteId);
        text += `\n\nAttached vault note: ${p.noteId}\n<note-content>\n${note.body}\n</note-content>`;
      }
      if (method === "thread.steer") {
        const turnId = this.activeTurns.get(id);
        if (!this.owned.has(id) || !turnId)
          throw new Error(
            "The turn has finished or belongs to Desktop. Your message has not been sent; send again to continue.",
          );
        if (p.expectedTurnId !== turnId)
          throw new Error(
            "The active turn changed. Review the conversation before sending again.",
          );
        await this.codex.rpc("turn/steer", {
          threadId: id,
          expectedTurnId: turnId,
          input: [{ type: "text", text }],
        });
        return { threadId: id, steered: true };
      }
      if (!this.owned.has(id)) {
        // An independent app-server must not take over a turn running in Desktop.
        const { thread } = await this.codex.rpc("thread/fork", {
          threadId: id,
          excludeTurns: true,
        });
        this.liveThreads.set(thread.id, thread);
        id = thread.id;
        this.owned.add(id);
        this.loaded.add(id);
        await this.saveOwned();
      } else if (!this.loaded.has(id)) {
        await this.codex.rpc("thread/resume", {
          threadId: id,
          excludeTurns: true,
        });
        this.loaded.add(id);
      }
      if (this.activeTurns.has(id))
        throw new Error(
          "This agent is already working. Stop the current turn before sending another message.",
        );
      const result = await this.codex.rpc("turn/start", {
        threadId: id,
        input: [{ type: "text", text }],
        ...(p.model ? { model: p.model } : {}),
        ...(p.effort ? { effort: p.effort } : {}),
      });
      this.activeTurns.set(id, result.turn.id);
      await this.refreshThreads();
      return {
        threadId: id,
        turn: { ...result.turn, items: visibleItems(result.turn.items || []) },
      };
    }
    if (method === "thread.interrupt") {
      const turnId = this.activeTurns.get(p.id);
      if (!turnId) throw new Error("No active AgentView turn to stop.");
      return this.codex.rpc("turn/interrupt", { threadId: p.id, turnId });
    }
    if (method === "approval.respond") {
      const approval = this.approvals.get(p.id);
      if (!approval) throw new Error("This request has already been answered.");
      let result: any;
      if (approval.method === "item/tool/requestUserInput")
        result = { answers: p.answers || {} };
      else if (
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
        ].includes(approval.method)
      )
        result = { decision: p.allow ? "accept" : "decline" };
      else if (approval.method === "item/permissions/requestApproval")
        result = {
          permissions: p.allow ? approval.params.permissions : {},
          scope: "turn",
        };
      else if (approval.method === "mcpServer/elicitation/request")
        result = { action: "cancel", content: null, _meta: null };
      else
        throw new Error(
          "This approval type requires the host agent interface.",
        );
      this.codex.respond(approval.id, result);
      this.approvals.delete(p.id);
      this.broadcast({
        type: "approvals",
        approvals: [...this.approvals.values()],
      });
      return {};
    }
    throw new Error("Unknown AgentView action.");
  }
  private async saveOwned() {
    await fs.writeFile(
      path.join(this.dataDir, "threads.json"),
      JSON.stringify([...this.owned]),
    );
  }
  snapshot(): Snapshot {
    return {
      graph: this.vault.graph,
      projects: this.allProjects(),
      limits: this.limits,
      sections: this.sections,
      threads: this.threads,
      models: this.models,
      agents: [...this.agents.values()],
      activity: this.activity,
      approvals: [...this.approvals.values()],
      host: {
        name: os.hostname(),
        vault: path.basename(this.settings.vaultPath),
        agentReady: this.codex.ready,
        agentError: this.codex.error,
        connectedAt: this.started,
      },
    };
  }
  status(): HostStatus {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter(
        (n) =>
          n &&
          n.family === "IPv4" &&
          !n.internal &&
          !n.address.startsWith("169.254."),
      )
      .map((n) => `wss://${n!.address}:${this.settings.port}`);
    return {
      running: Boolean(this.server?.listening),
      settings: this.settings,
      error: this.error,
      addresses,
      pairingCode: this.token
        ? encodeConnection({
            address: addresses[0] || `wss://127.0.0.1:${this.settings.port}`,
            token: this.token,
            fingerprint: this.fingerprint,
          })
        : "",
      clients: this.sockets.size,
      notes: this.vault.graph.nodes.length,
      agentReady: this.codex.ready,
      agentError: this.codex.error,
    };
  }
  localConnection(): Connection {
    return {
      address: `wss://127.0.0.1:${this.settings.port}`,
      token: this.token,
      fingerprint: this.fingerprint,
    };
  }
  private broadcast(event: AppEvent) {
    const text = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 8_000_000) {
        socket.close(4008, "Reconnect to refresh");
        continue;
      }
      socket.send(text);
    }
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.poll);
    clearInterval(this.limitsPoll);
    clearInterval(this.heartbeat);
    for (const socket of this.sockets) socket.close(1001, "Host stopped");
    this.sockets.clear();
    await this.vault.close();
    await this.observer?.close();
    this.codex.close();
    await new Promise<void>((resolve) => {
      if (!this.server?.listening) return resolve();
      this.server.close(() => resolve());
    });
  }
}
