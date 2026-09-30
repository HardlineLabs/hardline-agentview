import { promises as fs } from "node:fs";
import path from "node:path";
import type { Project, Thread } from "../shared/types";

const normalizedPath = (value: string) => path.resolve(value).toLowerCase();

export function mergeProjects(
  manifestProjects: Project[],
  runtimeProjects: Project[],
): Project[] {
  const matchedRuntimeIds = new Set<string>();
  const canonical = manifestProjects.map((project) => {
    const runtime = runtimeProjects.find(
      (candidate) =>
        candidate.path &&
        project.path &&
        normalizedPath(candidate.path) === normalizedPath(project.path),
    );
    if (!runtime) return project;
    matchedRuntimeIds.add(runtime.id);
    return { ...project, runtime: true, runtimeId: runtime.id };
  });
  return [
    ...canonical,
    ...runtimeProjects
      .filter((project) => !matchedRuntimeIds.has(project.id))
      .map((project) => ({
        ...project,
        runtime: true,
        runtimeId: project.id,
      })),
  ];
}

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
  return threads.map((thread) => {
    const assigned = thread.projectId || legacy[thread.id];
    const canonical = assigned
      ? projects.find(
          (project) =>
            project.runtimeId === assigned ||
            (project.runtime && project.id === assigned),
        )
      : undefined;
    return {
      ...thread,
      projectId:
        canonical?.id ||
        assigned ||
        projects.find(
          (project) =>
            project.path &&
            normalizedPath(project.path) === normalizedPath(thread.cwd),
        )?.id,
    };
  });
}
