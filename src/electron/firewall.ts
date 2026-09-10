import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const encoded = (script: string) =>
  Buffer.from(script, "utf16le").toString("base64");
const ruleName = "Hardline-AgentView-LAN";
function portNumber(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid host port.");
  return port;
}

export async function networkAccessEnabled(port: number): Promise<boolean> {
  const script = `$r = Get-NetFirewallRule -Name '${ruleName}' -ErrorAction SilentlyContinue; if ($r -and $r.Enabled -eq 'True' -and ($r | Get-NetFirewallPortFilter).LocalPort -eq '${portNumber(port)}') { Write-Output 'enabled' }`;
  try {
    const result = await execute(
      powershell,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
      { windowsHide: true, timeout: 15_000 },
    );
    return result.stdout.trim() === "enabled";
  } catch {
    return false;
  }
}

/** Invoked only by the operator's Allow LAN connections button; UAC stays human-controlled. */
export async function enableNetworkAccess(port: number) {
  const options = `-Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort ${portNumber(port)} -RemoteAddress LocalSubnet`;
  const script = `$ErrorActionPreference = 'Stop'; try { if (Get-NetFirewallRule -Name '${ruleName}' -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name '${ruleName}' ${options} | Out-Null } else { New-NetFirewallRule -Name '${ruleName}' -DisplayName 'Hardline AgentView (local network)' ${options} | Out-Null }; exit 0 } catch { exit 1 }`;
  const launch = `$ErrorActionPreference = 'Stop'; try { $p = Start-Process -FilePath '${powershell.replaceAll("'", "''")}' -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded(script)}' -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } catch { exit 1 }`;
  try {
    await execute(
      powershell,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(launch)],
      { windowsHide: true, timeout: 120_000 },
    );
  } catch {
    throw new Error(
      "Windows did not grant network access. Click Allow LAN connections to try again.",
    );
  }
  if (!(await networkAccessEnabled(port)))
    throw new Error(
      "Windows could not verify the network rule. Try again from Host.",
    );
}
