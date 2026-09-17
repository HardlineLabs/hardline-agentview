import type { Activity, Agent } from "../shared/types";

const TARGET_WINDOW_MS = 90_000;
const MAX_TARGETS = 6;

export function activeTargets(
  agent: Agent,
  activity: Activity[],
  knownTargets: ReadonlySet<string>,
  now = Date.now(),
) {
  const targets: string[] = [];
  const add = (target?: string) => {
    if (
      target &&
      knownTargets.has(target) &&
      !targets.includes(target) &&
      targets.length < MAX_TARGETS
    )
      targets.push(target);
  };

  add(agent.target);
  if (!agent.active) return targets;
  for (const event of activity) {
    if (now - event.time > TARGET_WINDOW_MS) break;
    if (event.agentId !== agent.id && event.threadId !== agent.threadId) continue;
    add(event.target);
  }
  return targets;
}
