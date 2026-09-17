import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { saveState } from "../host/state";

// Only ciphertext is written, including the atomic replacement file.
export class PrivateState {
  constructor(private directory: string) {}
  async load<T>(
    name: "drafts" | "pairing" | "notifications",
  ): Promise<T | undefined> {
    try {
      const encoded = JSON.parse(
        await fs.readFile(path.join(this.directory, `${name}.bin`), "utf8"),
      );
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(encoded, "base64")),
      );
    } catch (error: any) {
      if (error.code !== "ENOENT")
        throw new Error(`Could not read protected ${name}: ${error.message}`);
    }
  }
  async save(name: "drafts" | "pairing" | "notifications", value: unknown) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows secure storage is unavailable.");
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 16 * 1024 * 1024)
      throw new Error(
        "Saved client state exceeds 16 MB. Remove unused attachment drafts.",
      );
    await saveState(
      path.join(this.directory, `${name}.bin`),
      safeStorage.encryptString(text).toString("base64"),
    );
  }
}
