import { promises as fs } from "node:fs";
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
