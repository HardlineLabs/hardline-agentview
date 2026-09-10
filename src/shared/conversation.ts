import type { Turn } from "./types";

/** Fold ordered app-server events into a visible conversation, even before history is flushed. */
export function applyConversationEvent(
  current: Turn[],
  method: string,
  p: any,
): Turn[] {
  let turns = [...current];
  if (method === "turn/started") {
    if (!turns.some((t) => t.id === p.turn.id))
      turns.push({ ...p.turn, items: p.turn.items || [] });
  }
  if (method === "turn/completed")
    return turns.map((t) =>
      t.id === p.turn.id
        ? { ...t, status: p.turn.status, error: p.turn.error }
        : t,
    );
  if (!p.turnId) return turns;
  if (method === "item/started" || method === "item/completed") {
    if (["reasoning", "hookPrompt"].includes(p.item.type)) return turns;
    if (!turns.some((t) => t.id === p.turnId))
      turns.push({ id: p.turnId, status: "inProgress", items: [] });
    turns = turns.map((t) =>
      t.id === p.turnId
        ? {
            ...t,
            items: t.items.some((i) => i.id === p.item.id)
              ? t.items.map((i) => (i.id === p.item.id ? p.item : i))
              : [...t.items, p.item],
          }
        : t,
    );
  }
  if (method === "item/agentMessage/delta") {
    if (!turns.some((t) => t.id === p.turnId))
      turns.push({ id: p.turnId, status: "inProgress", items: [] });
    turns = turns.map((t) =>
      t.id === p.turnId
        ? {
            ...t,
            items: t.items.some((i) => i.id === p.itemId)
              ? t.items.map((i) =>
                  i.id === p.itemId
                    ? { ...i, text: (i.text || "") + p.delta }
                    : i,
                )
              : [
                  ...t.items,
                  { id: p.itemId, type: "agentMessage", text: p.delta },
                ],
          }
        : t,
    );
  }
  if (method === "item/commandExecution/outputDelta")
    turns = turns.map((t) =>
      t.id === p.turnId
        ? {
            ...t,
            items: t.items.map((i) =>
              i.id === p.itemId
                ? {
                    ...i,
                    aggregatedOutput: (
                      (i.aggregatedOutput || "") + p.delta
                    ).slice(-200_000),
                  }
                : i,
            ),
          }
        : t,
    );
  return turns;
}
