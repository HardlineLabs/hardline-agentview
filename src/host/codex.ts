import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { version } from "../../package.json";
import net from "node:net";
import { randomBytes } from "node:crypto";

export async function findCodex(configured?: string): Promise<string> {
  if (configured) {
    await fs.access(configured);
    return configured;
  }
  const root = path.join(os.homedir(), "AppData/Local/OpenAI/Codex/bin");
  try {
    const versions = await fs.readdir(root);
    const found = await Promise.all(
      versions.map(async (v) => {
        const p = path.join(root, v, "codex.exe");
        try {
          return { p, time: (await fs.stat(p)).mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const latest = found.filter(Boolean).sort((a, b) => b!.time - a!.time)[0];
    if (latest) return latest.p;
  } catch {
    /* Fall through to PATH. */
  }
  return process.platform === "win32" ? "codex.exe" : "codex";
}

export class Codex extends EventEmitter {
  private socket?: net.Socket;
  persistent = false;
  runtimeInfo: any = {};
  private process?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private counter = 0;
  ready = false;
  error = "";
  codexHome = "";
  async start(executable: string, dataDir?: string) {
    if (dataDir && typeof __dirname !== "undefined") {
      const worker = path.join(
        __dirname.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked"),
        "runtime.cjs",
      );
      if (
        await fs.access(worker).then(
          () => true,
          () => false,
        )
      ) {
        await this.connectWorker(executable, dataDir, worker);
        return;
      }
    }
    const environment = { ...process.env };
    // A separately owned runtime must not inherit the launching agent's identity.
    delete environment.CODEX_THREAD_ID;
    delete environment.CODEX_SESSION_ID;
    delete environment.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    this.process = spawn(executable, ["app-server", "--stdio"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: environment,
    });
    this.process.on("error", (e) => this.fail(e.message));
    this.process.on("exit", () =>
      this.fail("Agent connection stopped. Restart the connection from Host."),
    );
    this.process.stderr.on("data", () => {});
    createInterface({ input: this.process.stdout }).on("line", (line) =>
      this.receive(line),
    );
    const init = await this.rpc("initialize", {
      clientInfo: {
        name: "hardline_agentview",
        title: "Hardline AgentView",
        version,
      },
      capabilities: { experimentalApi: true },
    });
    this.codexHome = init.codexHome;
    this.runtimeInfo = init;
    this.write({ method: "initialized", params: {} });
    const account = await this.rpc("account/read", {});
    if (!account.account && account.requiresOpenaiAuth)
      throw new Error("Sign in to Codex on this host, then reconnect.");
    this.ready = true;
    this.error = "";
    this.emit("status");
  }
  private receive(line: string) {
    try {
      const message = JSON.parse(line);
      if (message.method) {
        if (message.method === "runtime/status") {
          this.ready = message.params.ready;
          this.error = message.params.error;
          this.emit("status");
          return;
        }
        this.emit(message.id != null ? "request" : "notification", message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    } catch {
      /* Non-protocol stdout cannot be interpreted as an agent action. */
    }
  }
  private async connectWorker(
    executable: string,
    dataDir: string,
    worker: string,
  ) {
    const infoPath = path.join(dataDir, "runtime-endpoint.json");
    let info: { pipe: string; token: string };
    try {
      info = JSON.parse(await fs.readFile(infoPath, "utf8"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      info = {
        pipe:
          process.platform === "win32"
            ? "\\\\.\\pipe\\agentview-" + randomBytes(20).toString("hex")
            : path.join(dataDir, "runtime.sock"),
        token: randomBytes(32).toString("hex"),
      };
      await fs.writeFile(infoPath, JSON.stringify(info), {
        mode: 0o600,
        flag: "wx",
      });
    }
    const connect = () =>
      new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect(info.pipe);
        socket.once("connect", () => {
          socket.off("error", reject);
          resolve(socket);
        });
        socket.once("error", reject);
      });
    try {
      this.socket = await connect();
    } catch {
      const child = spawn(process.execPath, [worker, dataDir, executable], {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      child.unref();
      let lastError: unknown;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((r) => setTimeout(r, 250));
        try {
          this.socket = await connect();
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!this.socket) throw lastError;
    }
    this.persistent = true;
    createInterface({ input: this.socket }).on("line", (line) =>
      this.receive(line),
    );
    this.socket.on("error", (e) => this.fail(e.message));
    this.socket.on("close", () =>
      this.fail(
        "Runtime connection stopped. Reconnect from Workspace settings.",
      ),
    );
    const state = await this.rpc("runtime/attach", { token: info.token });
    this.codexHome = state.codexHome;
    this.runtimeInfo = state;
    this.ready = state.ready !== false;
    this.error = state.error || "";
    this.emit("status");
  }
  private fail(message: string) {
    this.ready = false;
    this.error = message;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
    this.emit("status");
  }
  private write(message: unknown) {
    if (this.socket) {
      this.socket.write(JSON.stringify(message) + "\n");
      return;
    }
    if (!this.process || this.process.killed || !this.process.stdin.writable)
      throw new Error("Agent connection is unavailable.");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  rpc(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Agent did not answer ${method}. Try again.`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  respond(id: string | number, result: unknown) {
    this.write({ id, result });
  }
  close() {
    this.ready = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
      return;
    }
    this.process?.stdin.end();
    const p = this.process;
    setTimeout(() => {
      if (p && p.exitCode === null) p.kill();
    }, 1500).unref();
  }
}
