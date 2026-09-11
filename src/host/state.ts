import { promises as fs } from "node:fs";
import path from "node:path";
// Serialize writes to each owner file, then atomically replace it.
const writes = new Map<string, Promise<void>>();
export function saveState(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const next = (writes.get(file) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = file + ".next";
      await fs.writeFile(temporary, text, { mode: 0o600 });
      await fs.rename(temporary, file);
    });
  writes.set(file, next);
  void next
    .finally(() => {
      if (writes.get(file) === next) writes.delete(file);
    })
    .catch(() => {});
  return next;
}
export async function loadState<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return fallback;
  }
}
