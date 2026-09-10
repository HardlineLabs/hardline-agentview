import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import type { Thread, TokenUsage } from "../shared/types";

export function observeUsage(record: any): TokenUsage | undefined {
  if (record.type !== "event_msg" || record.payload?.type !== "token_count")
    return;
  const info = record.payload.info;
  if (
    !Number.isFinite(info?.last_token_usage?.total_tokens) ||
    !Number.isFinite(info?.total_token_usage?.total_tokens)
  )
    return;
  return {
    total: { totalTokens: info.total_token_usage.total_tokens },
    last: { totalTokens: info.last_token_usage.total_tokens },
    modelContextWindow: Number.isFinite(info.model_context_window)
      ? info.model_context_window
      : null,
  };
}

export type ObservedAction = {
  threadId: string;
  action: string;
  targetText: string;
  active: boolean;
  parentId?: string;
  name?: string;
};

/** Only tool calls and lifecycle records are interpreted; reasoning and outputs are ignored. */
export function observeRecord(
  record: any,
): Omit<ObservedAction, "threadId"> | undefined {
  const p = record.payload;
  if (!p) return;
  if (record.type === "event_msg") {
    if (["task_complete", "turn_aborted"].includes(p.type))
      return { action: "finished", targetText: "", active: false };
    if (p.type === "task_started")
      return { action: "working", targetText: "", active: true };
  }
  if (
    record.type !== "response_item" ||
    !["custom_tool_call", "function_call"].includes(p.type)
  )
    return;
  const input = String(p.input || p.arguments || "").slice(0, 64_000);
  const tool = String(p.name || "");
  const text = `${tool} ${input}`;
  let action = "working";
  if (/apply_patch|\bSet-Content\b|\bAdd-Content\b|\bwriteFile\b/.test(text))
    action = "editing";
  else if (
    /\bGet-Content\b|\breadFile\b|\bread_file\b|\bview_image\b/.test(text)
  )
    action = "reading";
  else if (/search_query|\brg\b|\bgrep\b|\bsearch\b/.test(text))
    action = "searching";
  else if (/spawn_agent|collaboration|send_message_to_agent/.test(text))
    action = "coordinating";
  else if (/exec_command|shell|terminal/.test(text)) action = "running";
  return { action, targetText: input, active: true };
}

export class SessionObserver extends EventEmitter {
  private watcher = chokidar.watch([], { ignoreInitial: true });
  private sessions = new Map<
    string,
    {
      thread: Thread;
      offset: number;
      partial: string;
      busy: boolean;
      again: boolean;
    }
  >();
  private stopped = false;
  constructor(private codexHome: string) {
    super();
    this.watcher.on("change", (file) => void this.read(file));
    this.watcher.on("error", (error) => this.emit("diagnostic", String(error)));
  }
  async track(threads: Thread[]) {
    const roots = ["sessions", "archived_sessions"].map((dir) =>
      (path.resolve(this.codexHome, dir) + path.sep).toLowerCase(),
    );
    const retained = new Set(
      threads.filter((t) => t.path).map((t) => path.resolve(t.path!)),
    );
    for (const file of this.sessions.keys()) {
      if (!retained.has(file)) {
        this.sessions.delete(file);
        await this.watcher.unwatch(file);
      }
    }
    for (const thread of threads) {
      if (!thread.path) continue;
      const file = path.resolve(thread.path);
      if (
        !roots.some((root) => file.toLowerCase().startsWith(root)) ||
        path.extname(file) !== ".jsonl"
      )
        continue;
      if (this.sessions.has(file)) {
        this.sessions.get(file)!.thread = thread;
        continue;
      }
      this.sessions.set(file, {
        thread,
        offset: -1,
        partial: "",
        busy: false,
        again: false,
      });
      this.watcher.add(file);
      await this.read(file);
    }
  }
  private async read(file: string) {
    const session = this.sessions.get(file);
    if (!session || this.stopped) return;
    if (session.busy) {
      session.again = true;
      return;
    }
    session.busy = true;
    try {
      const handle = await fs.open(file, "r");
      try {
        const size = (await handle.stat()).size;
        const initial = session.offset < 0;
        if (initial || size < session.offset) {
          session.offset = Math.max(0, size - 262_144);
          session.partial = "";
        }
        const begin = session.offset;
        const length = Math.min(size - begin, 1_048_576);
        if (length <= 0) return;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, begin);
        session.offset += bytesRead;
        let text =
          session.partial + buffer.subarray(0, bytesRead).toString("utf8");
        if (initial && begin > 0) text = text.slice(text.indexOf("\n") + 1);
        const lines = text.split("\n");
        session.partial = lines.pop()!.slice(-131_072);
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            const usage = observeUsage(record);
            if (usage)
              this.emit("usage", { threadId: session.thread.id, usage });
            if (session.thread.archived) continue;
            if (initial && Date.now() - Date.parse(record.timestamp) > 45_000)
              continue;
            const event = observeRecord(record);
            if (event)
              this.emit("activity", {
                ...event,
                threadId: session.thread.id,
                parentId: session.thread.parentThreadId,
                name:
                  session.thread.agentNickname ||
                  (session.thread.name || "Agent").slice(0, 18),
              } satisfies ObservedAction);
          } catch {
            /* A partially written record is not an observable action. */
          }
        }
        if (session.offset < size) session.again = true;
      } finally {
        await handle.close();
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") this.emit("diagnostic", e.message);
    } finally {
      session.busy = false;
      if (session.again && !this.stopped) {
        session.again = false;
        void this.read(file);
      }
    }
  }
  async close() {
    this.stopped = true;
    await this.watcher.close();
  }
}
