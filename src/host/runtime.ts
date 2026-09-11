// Stable execution owner. The tray/transport process can be replaced independently.
import net from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Codex } from "./codex";
import { administrator } from "./permissions";
import { version } from "../../package.json";

async function main() {
  const [, , dataDir, executable] = process.argv;
  const info = JSON.parse(
    await fs.readFile(path.join(dataDir, "runtime-endpoint.json"), "utf8"),
  );
  const codex = new Codex();
  const peers = new Set<net.Socket>();
  const approvals = new Map<string | number, any>();
  const turns = new Map<string, string>();
  const completed = new Set<string>();
  let inFlight = 0;
  let shuttingDown = false;
  let activeClients = 0;
  const elevated = await administrator();
  const send = (socket: net.Socket, message: any) => {
    if (socket.writableLength > 16 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    if (!socket.destroyed) socket.write(JSON.stringify(message) + "\n");
  };
  const broadcast = (message: any) => {
    for (const peer of peers) send(peer, message);
  };
  codex.on("request", (request) => {
    approvals.set(request.id, request);
    broadcast(request);
  });
  codex.on("status", () => {
    if (!codex.ready) {
      turns.clear();
      approvals.clear();
    }
    broadcast({
      method: "runtime/status",
      params: { ready: codex.ready, error: codex.error },
    });
  });
  codex.on("notification", (event) => {
    if (event.method === "turn/started")
      turns.set(event.params.threadId, event.params.turn.id);
    if (event.method === "turn/completed") {
      turns.delete(event.params.threadId);
      completed.add(event.params.turn.id);
      if (completed.size > 200)
        completed.delete(completed.values().next().value!);
    }
    broadcast(event);
  });
  let starting: Promise<void>;
  const server = net.createServer((socket) => {
    if (activeClients >= 8) {
      socket.destroy();
      return;
    }
    activeClients++;
    socket.setEncoding("utf8");
    let attached = false;
    const deadline = setTimeout(() => socket.destroy(), 5000);
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString();
      if (buffered.length > 16 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        void handle(line);
      }
    });
    async function handle(line: string) {
      let message: any;
      try {
        message = JSON.parse(line);
        if (!attached) {
          if (
            message.method !== "runtime/attach" ||
            message.params?.token !== info.token
          ) {
            socket.destroy();
            return;
          }
          clearTimeout(deadline);
          await starting;
          if (socket.destroyed) return;
          attached = true;
          peers.add(socket);
          send(socket, {
            id: message.id,
            result: {
              ...codex.runtimeInfo,
              codexHome: codex.codexHome,
              persistent: true,
              ready: codex.ready,
              error: codex.error,
              elevated,
              workerVersion: version,
              pid: process.pid,
            },
          });
          for (const request of approvals.values()) send(socket, request);
          return;
        }
        if (!message.method) {
          if (approvals.has(message.id)) {
            approvals.delete(message.id);
            codex.respond(message.id, message.result);
          }
          return;
        }
        let result: any;
        if (shuttingDown)
          throw new Error("Execution runtime is shutting down.");
        if (message.method === "runtime/state")
          result = {
            turns: [...turns],
            approvals: [...approvals.values()],
            elevated,
            workerVersion: version,
          };
        else if (message.method === "runtime/shutdown") {
          if (turns.size || approvals.size || inFlight)
            throw new Error(
              "Finish or stop active work before restarting the execution runtime.",
            );
          shuttingDown = true;
          send(socket, { id: message.id, result: {} });
          codex.close();
          setTimeout(() => process.exit(0), 500);
          return;
        } else {
          const startsWork = [
            "turn/start",
            "review/start",
            "thread/goal/set",
            "thread/resume",
          ].includes(message.method);
          if (startsWork) inFlight++;
          try {
            result = await codex.rpc(message.method, message.params);
            if (
              message.method === "turn/start" &&
              result.turn?.status === "inProgress" &&
              !completed.has(result.turn.id)
            )
              turns.set(message.params.threadId, result.turn.id);
          } finally {
            if (startsWork) inFlight--;
          }
        }
        send(socket, { id: message.id, result });
      } catch (error: any) {
        send(socket, { id: message?.id, error: { message: error.message } });
      }
    }
    socket.on("error", () => {});
    socket.on("close", () => {
      activeClients--;
      clearTimeout(deadline);
      peers.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(info.pipe, resolve);
  });
  starting = codex.start(executable);
  await starting;
}
main().catch(() => process.exit(1));
