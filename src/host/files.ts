import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../shared/types";

export class WorkspaceFiles {
  constructor(
    private dataDir: string,
    private projects: () => Project[],
  ) {}
  private async resolve(projectId: string, relative = "") {
    const project = this.projects().find((p) => p.id === projectId);
    if (!project) throw new Error("Unknown workspace.");
    const root = await fs.realpath(project.path);
    const candidate = path.resolve(root, relative);
    const inside = (p: string) => {
      const r = path.relative(root, p);
      return (
        !r.startsWith(".." + path.sep) && r !== ".." && !path.isAbsolute(r)
      );
    };
    if (!inside(candidate))
      throw new Error("Choose a file inside this workspace.");
    const actual = await fs.realpath(candidate);
    if (!inside(actual))
      throw new Error("Links outside this workspace cannot be opened.");
    return actual;
  }
  async list(projectId: string, relative = "") {
    const folder = await this.resolve(projectId, relative);
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return {
      path: relative,
      entries: entries
        .filter(
          (e) =>
            !e.isSymbolicLink() && ![".git", "node_modules"].includes(e.name),
        )
        .slice(0, 1000)
        .map((e) => ({
          name: e.name,
          directory: e.isDirectory(),
          path: path.posix.join(relative.replaceAll("\\", "/"), e.name),
        }))
        .sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            a.name.localeCompare(b.name),
        ),
    };
  }
  async read(
    projectId: string,
    relative: string,
    offset = 0,
    length = 256 * 1024,
  ) {
    const file = await this.resolve(projectId, relative);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Choose a file.");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 512 * 1024
    )
      throw new Error("Invalid file range.");
    const handle = await fs.open(file, "r");
    try {
      const data = Buffer.alloc(
        Math.min(length, Math.max(0, stat.size - offset)),
      );
      const { bytesRead } = await handle.read(data, 0, data.length, offset);
      return {
        name: path.basename(file),
        size: stat.size,
        offset,
        data: data.subarray(0, bytesRead).toString("base64"),
        nextOffset: offset + bytesRead < stat.size ? offset + bytesRead : null,
      };
    } finally {
      await handle.close();
    }
  }
  async upload(name: string, data: string, mime: string) {
    if (
      typeof data !== "string" ||
      data.length > 8 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      throw new Error("Attachments must be at most 6 MB.");
    const bytes = Buffer.from(data, "base64");
    const cleanName = path
      .basename(String(name))
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 120)
      .replace(/[. ]+$/, "");
    const safeName =
      !cleanName ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(cleanName)
        ? "attachment"
        : cleanName;
    const id = randomUUID();
    const folder = path.join(this.dataDir, "attachments", id);
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, safeName);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return {
      id,
      name: safeName,
      mime: String(mime).slice(0, 100),
      size: bytes.length,
    };
  }
  async attachment(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid attachment.");
    const folder = path.join(this.dataDir, "attachments", id);
    const names = await fs.readdir(folder);
    if (names.length !== 1) throw new Error("Attachment is unavailable.");
    return path.join(folder, names[0]);
  }
}
