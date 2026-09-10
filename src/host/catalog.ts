import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project, Thread } from "../shared/types";

export const threadSources = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];

export async function listAll<T>(
  rpc: (method: string, params: any) => Promise<any>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await rpc(method, { ...params, limit: 100, cursor });
    items.push(...(page.data || []));
    cursor = page.nextCursor || null;
    if (cursor && seen.has(cursor))
      throw new Error(`Repeated cursor from ${method}.`);
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

/** Read only the legacy project assignments still used by Desktop during migration. */
export async function desktopAssignments(
  codexHome: string,
): Promise<Record<string, string>> {
  if (!codexHome) return {};
  try {
    const state = JSON.parse(
      await fs.readFile(
        path.join(codexHome, ".codex-global-state.json"),
        "utf8",
      ),
    );
    const ids =
      state["app-server-project-id-by-legacy-project-id-by-host"]?.[
        `local:${codexHome}`
      ] || {};
    return Object.fromEntries(
      Object.entries(state["thread-project-assignments"] || {})
        .filter(([, value]: [string, any]) => value?.projectKind === "local")
        .map(([id, value]: [string, any]) => [
          id,
          ids[value.projectId] || value.projectId,
        ]),
    );
  } catch {
    return {};
  }
}

export function assignProjects(
  threads: Thread[],
  projects: Project[],
  legacy: Record<string, string>,
) {
  const normalized = (value: string) => path.resolve(value).toLowerCase();
  return threads.map((thread) => ({
    ...thread,
    projectId:
      thread.projectId ||
      legacy[thread.id] ||
      projects.find(
        (project) =>
          project.path && normalized(project.path) === normalized(thread.cwd),
      )?.id,
  }));
}
