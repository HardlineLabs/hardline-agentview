import { promises as fs } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import matter from "gray-matter";
import type { Graph, Note, Project } from "../shared/types";

const excluded = new Set([
  "node_modules",
  "tools",
  "note templates",
  "templates",
]);
const slash = (s: string) => s.replaceAll("\\", "/");
export function linkTargets(text: string): { target: string; wiki: boolean }[] {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
  return [
    ...[...prose.matchAll(/!?\[\[([^\]]+)\]\]/g)].map((m) => ({
      target: m[1].split("|")[0].split("#")[0],
      wiki: true,
    })),
    ...[
      ...prose.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g),
    ].map((m) => ({
      target: m[1].replace(/^<|>$/g, "").split("#")[0],
      wiki: false,
    })),
  ].filter((x) => x.target && !/^[a-z][\w+.-]*:/i.test(x.target));
}
export function resolveLink(
  source: string,
  target: string,
  wiki: boolean,
  ids: string[],
): string | undefined {
  try {
    target = decodeURIComponent(target);
  } catch {
    return;
  }
  const withExt = /\.md$/i.test(target) ? target : `${target}.md`;
  const relative = slash(
    path.posix.normalize(path.posix.join(path.posix.dirname(source), withExt)),
  );
  const lookup = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const candidates = wiki ? [withExt, relative] : [relative];
  for (const candidate of candidates)
    if (lookup.has(candidate.toLowerCase()))
      return lookup.get(candidate.toLowerCase());
  if (wiki && !target.includes("/")) {
    const matches = ids.filter(
      (id) => path.posix.basename(id).toLowerCase() === withExt.toLowerCase(),
    );
    if (matches.length === 1) return matches[0];
  }
}
export class Vault extends EventEmitter {
  graph: Graph = { nodes: [], links: [], revision: 0 };
  projects: Project[] = [];
  private bodies = new Map<string, string>();
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private scanning = false;
  private rescan = false;
  constructor(public root: string) {
    super();
  }
  async start() {
    this.root = await fs.realpath(this.root);
    await this.scan();
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (p) =>
        slash(path.relative(this.root, p))
          .split("/")
          .some((s) => s.startsWith(".") || excluded.has(s.toLowerCase())),
      awaitWriteFinish: { stabilityThreshold: 160, pollInterval: 70 },
    });
    this.watcher.on("all", (event, file) => {
      if (!file.endsWith(".md") && path.basename(file) !== "workspace.json")
        return;
      this.emit("change", {
        action:
          event === "add"
            ? "created"
            : event === "unlink"
              ? "removed"
              : "updated",
        target: slash(path.relative(this.root, file)),
      });
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => void this.scan().catch((e) => this.emit("fault", e.message)),
        220,
      );
    });
    this.watcher.on("error", (e) => this.emit("fault", String(e)));
  }
  async scan() {
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    this.scanning = true;
    try {
      const nodes: Note[] = [];
      const bodies = new Map<string, string>();
      const walk = async (dir: string) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (
            entry.name.startsWith(".") ||
            excluded.has(entry.name.toLowerCase()) ||
            entry.isSymbolicLink()
          )
            continue;
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(file);
            continue;
          }
          if (!entry.name.toLowerCase().endsWith(".md")) continue;
          try {
            const stat = await fs.stat(file);
            if (stat.size > 2_000_000) continue;
            const text = await fs.readFile(file, "utf8");
            let content = text;
            let data: Record<string, any> = {};
            try {
              ({ content, data } = matter(text));
            } catch {
              /* Incomplete frontmatter remains readable. */
            }
            const id = slash(path.relative(this.root, file));
            bodies.set(id, text);
            nodes.push({
              id,
              title: String(
                data.title ||
                  content.match(/^#\s+(.+)$/m)?.[1] ||
                  entry.name.slice(0, -3),
              ),
              domain: String(data.domain || "knowledge"),
              kind: String(data.type || "note"),
              status: String(data.status || "current"),
              modified: stat.mtimeMs,
              size: stat.size,
            });
          } catch (e: any) {
            if (e.code !== "ENOENT") throw e;
          }
        }
      };
      await walk(this.root);
      const ids = nodes.map((n) => n.id);
      const links: Graph["links"] = [];
      const seen = new Set<string>();
      for (const [source, text] of bodies)
        for (const link of linkTargets(text)) {
          const target = resolveLink(source, link.target, link.wiki, ids);
          if (!target || target === source) continue;
          const key = [source, target].sort().join("\0");
          if (seen.has(key)) continue;
          seen.add(key);
          links.push({ source, target });
        }
      this.bodies = bodies;
      this.graph = { nodes, links, revision: this.graph.revision + 1 };
      this.projects = [{ id: "vault", name: "Company brain", path: this.root }];
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(this.root, "workspace.json"), "utf8"),
        );
        for (const [id, product] of Object.entries(manifest.products || {}) as [
          string,
          any,
        ][]) {
          this.projects.push({
            id,
            name: path.basename(product.onboarding || id, ".md"),
            path: path.resolve(this.root, product.path),
          });
        }
      } catch {
        /* Any Markdown vault works; a company manifest is optional. */
      }
      this.emit("graph", this.graph);
    } finally {
      this.scanning = false;
      if (this.rescan) {
        this.rescan = false;
        await this.scan();
      }
    }
  }
  read(id: string) {
    const body = this.bodies.get(id);
    if (body === undefined)
      throw new Error("This note is no longer in the vault.");
    return { id, body };
  }
  matchTarget(text: string): string | undefined {
    const normalized = slash(text).toLowerCase();
    const byPath = this.graph.nodes.find((n) =>
      normalized.includes(n.id.toLowerCase()),
    );
    if (byPath) return byPath.id;
    const byName = this.graph.nodes.filter((n) =>
      normalized.includes(path.posix.basename(n.id).toLowerCase()),
    );
    if (byName.length === 1) return byName[0].id;
  }
  async close() {
    clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
