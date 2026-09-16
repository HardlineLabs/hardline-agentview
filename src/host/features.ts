import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { version } from "../../package.json";
import { WorkspaceFiles } from "./files";
import { loadState, saveState } from "./state";
import {
  administrator,
  permissionMode,
  type PermissionMode,
} from "./permissions";
import type { Codex } from "./codex";
import type { Project, AppEvent } from "../shared/types";
import { HostPush } from "./push";

export const runtimeReads: Record<string, string> = {
  "runtime.models": "model/list",
  "runtime.skills": "skills/list",
  "runtime.plugins": "plugin/list",
  "runtime.apps": "app/list",
  "runtime.mcp": "mcpServerStatus/list",
  "runtime.features": "experimentalFeature/list",
  "runtime.permissions": "permissionProfile/list",
  "runtime.requirements": "configRequirements/read",
  "runtime.projects": "project/list",
  "runtime.sections": "threadSection/list",
  "runtime.account": "account/read",
  "runtime.limits": "account/rateLimits/read",
};
export type Preferences = {
  defaultPermissions: PermissionMode;
  onboarding: string;
};
type Receipt = {
  state: "pending" | "accepted" | "failed" | "uncertain";
  signature: string;
  result?: any;
  error?: string;
  time: number;
};
export type Job = {
  id: string;
  threadId: string;
  text: string;
  params: any;
  state: "waiting" | "running" | "completed" | "failed" | "uncertain";
  error?: string;
  createdAt: number;
  turnId?: string;
};
type Notice = { id: string; threadId?: string; title: string; time: number };

export class HostFeatures {
  push: HostPush;
  preferences: Preferences = {
    defaultPermissions: "workspace",
    onboarding:
      "Onboard yourself to this workspace. Read its AGENTS.md and relevant project documentation, inspect the current repository state, and summarize what you need to know before starting work. Follow workspace routing instructions and read narrowly. Do not change source during onboarding.",
  };
  files: WorkspaceFiles;
  jobs: Job[] = [];
  notices: Notice[] = [];
  private receipts: Record<string, Receipt> = {};
  private pending = new Map<string, Promise<any>>();
  private draining = false;
  private sequence = 0;
  private events: AppEvent[] = [];
  readonly epoch = randomUUID();
  constructor(
    private root: string,
    private codex: Codex,
    projects: () => Project[],
    private execute: (method: string, params: any) => Promise<any>,
    private emit: (event: AppEvent) => void,
    private active: (id: string) => boolean,
    private reconnect: () => Promise<void>,
  ) {
    this.files = new WorkspaceFiles(root, projects);
    this.push = new HostPush(root);
  }
  async load() {
    await this.push.load();
    this.preferences = {
      ...this.preferences,
      ...(await loadState(path.join(this.root, "preferences.json"), {})),
    };
    permissionMode(this.preferences.defaultPermissions);
    this.receipts = await loadState(path.join(this.root, "requests.json"), {});
    for (const receipt of Object.values(this.receipts))
      if (receipt.state === "pending") receipt.state = "uncertain";
    this.jobs = await loadState(path.join(this.root, "queue.json"), []);
    this.notices = await loadState(
      path.join(this.root, "notifications.json"),
      [],
    );
  }
  record(event: AppEvent) {
    // Replay lightweight control events only; full chat content is read from the runtime.
    if (!["queue", "notice", "preferences"].includes(event.type)) return event;
    const sequenced = {
      ...event,
      sequence: ++this.sequence,
      epoch: this.epoch,
    };
    this.events.push(sequenced);
    this.events = this.events.slice(-200);
    return sequenced;
  }
  async notice(title: string, threadId?: string) {
    const notice = { id: randomUUID(), title, threadId, time: Date.now() };
    this.notices = [...this.notices, notice].slice(-100);
    await saveState(path.join(this.root, "notifications.json"), this.notices);
    this.emit({ type: "notice", notice });
    void this.push.send({ title, threadId }).catch(() => {});
  }
  private async saveQueue() {
    await saveState(path.join(this.root, "queue.json"), this.jobs);
    this.emit({ type: "queue", jobs: this.jobs });
  }
  async completed(threadId: string, turn: any) {
    const job = this.jobs.find(
      (j) =>
        j.state === "running" &&
        j.threadId === threadId &&
        (!j.turnId || j.turnId === turn.id),
    );
    if (job) {
      job.state = turn.status === "completed" ? "completed" : "failed";
      job.error = turn.error?.message;
      await this.saveQueue();
    }
    await this.notice(
      turn.status === "completed" ? "Agent finished" : "Agent needs attention",
      threadId,
    );
    void this.drain();
  }
  async reconcile() {
    for (const job of this.jobs.filter((j) => j.state === "running")) {
      if (this.active(job.threadId)) continue;
      try {
        const page = await this.execute("thread.read", { id: job.threadId });
        const turn = page.turns.find((t: any) => t.id === job.turnId);
        job.state = turn?.status === "completed" ? "completed" : "uncertain";
      } catch {
        job.state = "uncertain";
      }
    }
    await this.saveQueue();
    void this.drain();
  }
  async drain() {
    if (this.draining || !this.codex.ready) return;
    this.draining = true;
    try {
      for (const job of this.jobs.filter((j) => j.state === "waiting")) {
        if (this.active(job.threadId)) continue;
        job.state = "running";
        await this.saveQueue();
        try {
          const result = await this.execute("thread.send", {
            ...job.params,
            id: job.threadId,
            text: job.text,
            clientUserMessageId: job.id,
          });
          job.threadId = result.threadId;
          job.turnId = result.turn.id;
        } catch (e: any) {
          job.state = /did not answer|unavailable|stopped/i.test(e.message)
            ? "uncertain"
            : "failed";
          job.error = e.message;
        }
        await this.saveQueue();
      }
    } finally {
      this.draining = false;
    }
  }
  supports(method: string) {
    return (
      Boolean(runtimeReads[method]) ||
      [
        "api.capabilities",
        "host.diagnostics",
        "host.preferences",
        "host.preferences.update",
        "host.reconnect",
        "host.runtime.restart",
        "events.since",
        "notifications.list",
        "notifications.status",
        "notifications.subscribe",
        "notifications.unsubscribe",
        "queue.list",
        "queue.add",
        "queue.cancel",
        "request.execute",
        "request.status",
        "files.list",
        "files.read",
        "files.upload",
      ].includes(method)
    );
  }
  async handle(method: string, p: any, device = "local"): Promise<any> {
    if (method === "notifications.status") return this.push.status(device);
    if (method === "notifications.subscribe") {
      await this.push.subscribe(device, p.subscription);
      return this.push.status(device);
    }
    if (method === "notifications.unsubscribe") {
      await this.push.remove(device);
      return this.push.status(device);
    }
    if (runtimeReads[method]) {
      if (JSON.stringify(p).length > 16000)
        throw new Error("Request is too large.");
      return this.codex.rpc(runtimeReads[method], p);
    }
    if (method === "api.capabilities")
      return {
        apiVersion: 1,
        hostVersion: version,
        epoch: this.epoch,
        methods: [
          ...Object.keys(runtimeReads),
          "host.preferences",
          "host.preferences.update",
          "host.diagnostics",
          "host.reconnect",
          "host.runtime.restart",
          "thread.create",
          "thread.read",
          "thread.send",
          "thread.steer",
          "thread.rename",
          "thread.bulk",
          "thread.recovery",
          "thread.fork",
          "thread.compact",
          "thread.project",
          "thread.review",
          "thread.goal",
          "thread.interrupt",
          "thread.autoApprove",
          "files.list",
          "files.read",
          "files.upload",
          "queue.list",
          "queue.add",
          "queue.cancel",
          "request.execute",
          "request.status",
          "events.since",
          "notifications.list",
          "notifications.status",
          "notifications.subscribe",
          "notifications.unsubscribe",
        ],
        limits: {
          attachmentBytes: 6 * 1024 * 1024,
          attachmentsPerMessage: 8,
          bulkThreads: 100,
        },
        runtimeExtensions:
          "Availability is determined by the installed runtime; unsupported methods return an error.",
      };
    if (method === "host.preferences") return this.preferences;
    if (method === "host.preferences.update") {
      const next = { ...this.preferences };
      if (p.defaultPermissions !== undefined)
        next.defaultPermissions = permissionMode(p.defaultPermissions);
      if (p.onboarding !== undefined) {
        if (typeof p.onboarding !== "string" || p.onboarding.length > 20000)
          throw new Error(
            "Onboarding instructions must be under 20,000 characters.",
          );
        next.onboarding = p.onboarding;
      }
      await saveState(path.join(this.root, "preferences.json"), next);
      this.preferences = next;
      this.emit({ type: "preferences", preferences: next });
      return next;
    }
    if (method === "host.diagnostics") {
      const probes = await Promise.allSettled([
        this.codex.rpc("mcpServerStatus/list", {}),
        this.codex.rpc("experimentalFeature/list", {}),
      ]);
      return {
        hostVersion: version,
        runtime: this.codex.runtimeInfo,
        persistentRuntime: this.codex.persistent,
        hostAdministrator: await administrator(),
        runtimeAdministrator: this.codex.runtimeInfo.elevated ?? null,
        ready: this.codex.ready,
        error: this.codex.error,
        codexHome: this.codex.codexHome,
        defaultPermissions: this.preferences.defaultPermissions,
        integrations: probes.map((r, i) => ({
          kind: i ? "features" : "mcp",
          ...(r.status === "fulfilled"
            ? {
                result: i
                  ? r.value.data?.filter((f: any) =>
                      /browser|computer|plugin|shell|code_mode_host/.test(
                        f.name,
                      ),
                    )
                  : r.value.data?.map((s: any) => ({
                      name: s.name,
                      status: s.runtimeStatus,
                      tools: Object.keys(s.tools || {}),
                    })),
              }
            : { error: r.reason.message }),
        })),
        checkedAt: Date.now(),
      };
    }
    if (method === "host.runtime.restart") {
      if (!this.codex.persistent)
        throw new Error("This build has no independent execution process.");
      await this.codex.rpc("runtime/shutdown");
      this.codex.close();
      await new Promise((r) => setTimeout(r, 1200));
      await this.reconnect();
      return { ready: this.codex.ready };
    }
    if (method === "host.reconnect") {
      await this.reconnect();
      return { ready: this.codex.ready };
    }
    if (method === "events.since")
      return {
        epoch: this.epoch,
        sequence: this.sequence,
        reset:
          p.epoch !== this.epoch ||
          p.sequence < (this.events[0]?.sequence || 0) - 1,
        events: this.events.filter((e) => e.sequence > Number(p.sequence || 0)),
      };
    if (method === "notifications.list") return { notices: this.notices };
    if (method === "files.list") return this.files.list(p.projectId, p.path);
    if (method === "files.read")
      return this.files.read(p.projectId, p.path, p.offset, p.length);
    if (method === "files.upload")
      return this.files.upload(p.name, p.data, p.mime);
    if (method === "queue.list") return { jobs: this.jobs };
    if (method === "queue.add") {
      if (
        typeof p.text !== "string" ||
        !p.text.trim() ||
        p.text.length > 100000
      )
        throw new Error("Enter a message of up to 100,000 characters.");
      const page = await this.execute("thread.read", { id: p.id });
      if (!page.thread.owned)
        throw new Error(
          "Continue this Desktop conversation in AgentView before queueing follow-ups.",
        );
      if (
        this.jobs.filter((j) => ["waiting", "running"].includes(j.state))
          .length >= 100
      )
        throw new Error("The work queue is full.");
      const job: Job = {
        id: randomUUID(),
        threadId: p.id,
        text: p.text,
        params: {
          model: p.model,
          effort: p.effort,
          attachments: p.attachments,
        },
        state: "waiting",
        createdAt: Date.now(),
      };
      this.jobs.push(job);
      this.jobs = this.jobs.slice(-200);
      await this.saveQueue();
      void this.drain();
      return job;
    }
    if (method === "queue.cancel") {
      const job = this.jobs.find((j) => j.id === p.id);
      if (!job || job.state !== "waiting")
        throw new Error("Only waiting tasks can be removed from the queue.");
      this.jobs = this.jobs.filter((j) => j !== job);
      await this.saveQueue();
      return {};
    }
    const requestKey = device + ":" + p.requestId;
    if (method === "request.status")
      return this.receipts[requestKey] || { state: "missing" };
    if (method === "request.execute") {
      if (
        !/^[a-zA-Z0-9-]{16,80}$/.test(p.requestId) ||
        ![
          "thread.send",
          "thread.steer",
          "thread.create",
          "thread.rename",
          "thread.bulk",
          "files.upload",
          "queue.add",
        ].includes(p.method)
      )
        throw new Error("Invalid durable request.");
      const signature = createHash("sha256")
        .update(JSON.stringify([p.method, p.params]))
        .digest("hex");
      const existing = this.receipts[requestKey];
      if (existing) {
        if (existing.signature !== signature)
          throw new Error(
            "Request identifier already belongs to another action.",
          );
        if (existing.state === "accepted") return existing.result;
        if (this.pending.has(requestKey)) return this.pending.get(requestKey);
        throw new Error(
          existing.error ||
            "The earlier request outcome is uncertain. Inspect the conversation before sending again.",
        );
      }
      this.receipts[requestKey] = {
        state: "pending",
        signature,
        time: Date.now(),
      };
      await saveState(path.join(this.root, "requests.json"), this.receipts);
      const action = (async () => {
        try {
          const result = await this.execute(p.method, {
            ...p.params,
            clientUserMessageId: p.requestId,
          });
          this.receipts[requestKey] = {
            state: "accepted",
            signature,
            result,
            time: Date.now(),
          };
          return result;
        } catch (e: any) {
          this.receipts[requestKey] = {
            state: /did not answer|unavailable|stopped/i.test(e.message)
              ? "uncertain"
              : "failed",
            signature,
            error: e.message,
            time: Date.now(),
          };
          throw e;
        } finally {
          const old = Object.entries(this.receipts)
            .filter(([, r]) => r.state !== "pending")
            .sort((a, b) => b[1].time - a[1].time)
            .slice(1000);
          for (const [key] of old) delete this.receipts[key];
          await saveState(path.join(this.root, "requests.json"), this.receipts);
          this.pending.delete(requestKey);
        }
      })();
      this.pending.set(requestKey, action);
      return action;
    }
    throw new Error("Unsupported host capability.");
  }
}
