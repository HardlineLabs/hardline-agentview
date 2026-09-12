import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export async function buildHostLauncher() {
  const directory = path.resolve("dist/launcher");
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, "AgentView Host.exe");
  const compiler = path.join(
    process.env.SystemRoot || "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  await promisify(execFile)(
    compiler,
    [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/platform:anycpu",
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Runtime.Serialization.dll",
      `/win32icon:${path.resolve("assets/icon.ico")}`,
      `/out:${executable}`,
      path.resolve("src/launcher/HostLauncher.cs"),
    ],
    { windowsHide: true },
  );
  return executable;
}
