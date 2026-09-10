import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export class HostTunnel extends EventEmitter {
  status = "Not configured";
  private process?: ChildProcess;
  private restart?: NodeJS.Timeout;
  private stopped = false;
  start(executable: string, config: string) {
    if (!config || !executable || this.stopped) return;
    this.status = "Connecting";
    this.emit("status");
    const child = spawn(
      executable,
      ["tunnel", "--config", config, "--metrics", "127.0.0.1:0", "run"],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    this.process = child;
    let buffer = "";
    child.stderr?.on("data", (bytes) => {
      buffer = (buffer + bytes.toString()).slice(-8000);
      if (buffer.includes("Registered tunnel connection")) {
        this.status = "Connected";
        this.emit("status");
        buffer = "";
      }
    });
    child.on("error", () => {
      this.status =
        "Tunnel could not start. Check its executable and configuration.";
      this.emit("status");
    });
    child.on("exit", () => {
      if (this.stopped) return;
      this.status = "Reconnecting";
      this.emit("status");
      this.restart = setTimeout(() => this.start(executable, config), 10_000);
    });
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.restart);
    this.process?.kill();
  }
}
