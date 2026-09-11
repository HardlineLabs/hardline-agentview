import { promises as fs } from "node:fs";
import path from "node:path";
import type { HostSettings } from "../shared/types";
import { remoteAddress } from "../shared/pairing";

export async function loadHostSettings(
  file: string,
  defaults: HostSettings,
): Promise<HostSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") return defaults;
    throw error;
  }
  const saved = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    typeof saved.vaultPath !== "string" ||
    !Number.isInteger(saved.port) ||
    saved.port < 1024 ||
    saved.port > 65535
  )
    throw new Error(
      "Saved Host settings are invalid. Restore settings.json or choose your vault and save settings again.",
    );
  return {
    ...defaults,
    ...saved,
    remoteAddress: remoteAddress(saved.remoteAddress || ""),
  };
}

// Recover only this Host's existing managed tunnel; never provision a new route.
export async function recoverHostTunnel(
  settings: HostSettings,
  directory: string,
  executableCandidates = [
    ...[process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
      .filter((root): root is string => Boolean(root))
      .map((root) => path.join(root, "cloudflared", "cloudflared.exe")),
    ...(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((root) => path.join(root, "cloudflared.exe")),
  ],
): Promise<HostSettings> {
  if (
    !settings.remoteAddress ||
    (settings.cloudflaredPath && settings.tunnelConfig)
  )
    return settings;
  const configPath =
    settings.tunnelConfig || path.join(directory, "tunnel.yml");
  let config;
  try {
    // configure-remote.ps1 writes JSON (valid YAML), including quoted Windows paths.
    config = JSON.parse(
      (await fs.readFile(configPath, "utf8")).replace(/^\uFEFF/, ""),
    );
  } catch (error: any) {
    if (error.code === "ENOENT" && !settings.tunnelConfig) return settings;
    throw new Error(
      "The saved tunnel setup could not be read. Check Remote access before pairing.",
    );
  }
  const ingress = (Array.isArray(config?.ingress) ? config.ingress : []).find(
    (entry: any) =>
      entry.hostname === new URL(settings.remoteAddress!).hostname,
  );
  if (
    !ingress ||
    ingress.service !== `https://127.0.0.1:${settings.port}` ||
    typeof ingress.originRequest?.caPool !== "string" ||
    path.relative(
      path.resolve(directory, "host-cert.pem"),
      path.resolve(ingress.originRequest.caPool),
    ) !== "" ||
    ingress.originRequest?.originServerName !== "localhost"
  )
    throw new Error(
      "The saved tunnel does not match this Host's endpoint, port or certificate. Check Remote access before pairing.",
    );
  const candidates = settings.cloudflaredPath
    ? [settings.cloudflaredPath]
    : executableCandidates;
  for (const executable of candidates) {
    if (
      await fs.stat(executable).then(
        (stat) => stat.isFile(),
        () => false,
      )
    )
      return {
        ...settings,
        cloudflaredPath: executable,
        tunnelConfig: configPath,
      };
  }
  throw new Error(
    "The saved tunnel needs cloudflared, but its executable could not be found.",
  );
}
