import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export class HostTunnel extends EventEmitter {
  status = "Not configured";
  private process?: ChildProcess;
  private restart?: NodeJS.Timeout;
  private stopped = false;
  async ready(timeout = 25_000) {
    if (this.status === "Connected") return;
    if (this.status === "Not configured") return; // Externally managed endpoints remain supported.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.off("status", check);
        error ? reject(error) : resolve();
      };
      const check = () => {
        if (this.status === "Connected") finish();
        else if (this.status.startsWith("Tunnel could not start"))
          finish(new Error(this.status));
        else if (this.stopped)
          finish(
            new Error(
              "Host stopped while connecting. Open Host and try pairing again.",
            ),
          );
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "The tunnel is still offline. Check this PC's internet connection and Remote access, then try Pair device again.",
            ),
          ),
        timeout,
      );
      this.on("status", check);
      check();
    });
  }
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
    this.emit("status");
  }
}
