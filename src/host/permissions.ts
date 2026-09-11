import { execFile } from "node:child_process";
export type PermissionMode = "full" | "workspace" | "read-only";
export function permissionMode(value: unknown): PermissionMode {
  if (!["full", "workspace", "read-only"].includes(String(value)))
    throw new Error("Choose Full access, Workspace access, or Read only.");
  return value as PermissionMode;
}
export function threadPolicy(mode: PermissionMode) {
  return {
    approvalPolicy: mode === "full" ? "never" : "on-request",
    sandbox:
      mode === "full"
        ? "danger-full-access"
        : mode === "workspace"
          ? "workspace-write"
          : "read-only",
  };
}
export function turnPolicy(mode: PermissionMode, cwd: string) {
  return {
    approvalPolicy: mode === "full" ? "never" : "on-request",
    sandboxPolicy:
      mode === "full"
        ? { type: "dangerFullAccess" }
        : mode === "workspace"
          ? {
              type: "workspaceWrite",
              writableRoots: [cwd],
              networkAccess: true,
            }
          : { type: "readOnly" },
  };
}
export function administrator(): Promise<boolean> {
  if (process.platform !== "win32")
    return Promise.resolve(process.getuid?.() === 0);
  return new Promise((resolve) =>
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => resolve(!error && stdout.trim() === "True"),
    ),
  );
}
