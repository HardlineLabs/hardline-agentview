import { execFile } from "node:child_process";
import type { Approval } from "../shared/types";

// Only requests whose complete answer is a permission decision are eligible.
// Questions, MCP forms/URL flows and unknown methods still need the user.
export function automaticApproval(request: Approval) {
  if (
    [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ].includes(request.method)
  ) {
    const decisions = request.params.availableDecisions;
    if (
      decisions !== undefined &&
      (!Array.isArray(decisions) || !decisions.includes("accept"))
    )
      return;
    return { decision: "accept" };
  }
  if (request.method === "item/permissions/requestApproval") {
    const permissions = request.params.permissions;
    if (
      !permissions ||
      typeof permissions !== "object" ||
      Array.isArray(permissions)
    )
      return;
    return { permissions, scope: "turn" };
  }
}

export type PermissionMode = "full" | "workspace" | "read-only";
export function permissionMode(value: unknown): PermissionMode {
  if (!["full", "workspace", "read-only"].includes(String(value)))
    throw new Error("Choose Full access, Workspace access, or Read only.");
  return value as PermissionMode;
}
export function threadPolicy(mode: PermissionMode) {
  return {
    // Full filesystem access must not disable the user's approval channel.
    approvalPolicy: "on-request",
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
    approvalPolicy: "on-request",
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
