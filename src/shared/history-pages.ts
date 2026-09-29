import type { Turn } from "./types";
export function prependHistory(older: Turn[], current: Turn[]): Turn[] {
  const merged = new Map(older.map((t) => [t.id, t]));
  for (const turn of current) {
    const previous = merged.get(turn.id);
    const items = new Map(previous?.items.map((i) => [i.id, i]) || []);
    for (const item of turn.items) items.set(item.id, item);
    merged.set(turn.id, { ...previous, ...turn, items: [...items.values()] });
  }
  return [...merged.values()];
}
