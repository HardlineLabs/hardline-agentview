import type { Turn } from "../src/shared/types";

// Model the native item-history API using synthetic turns only.
export function fixtureItemPage(turns: Turn[], params: any) {
  const entries = turns.flatMap((turn) =>
    turn.items.map((item) => ({ turnId: turn.id, item })),
  );
  if (params.sortDirection === "asc") {
    const start = params.cursor ? Number(params.cursor) : 0;
    const end = Math.min(entries.length, start + params.limit);
    return {
      data: entries.slice(start, end),
      nextCursor: end < entries.length ? String(end) : null,
      backwardsCursor: end ? String(end) : null,
    };
  }
  const end = params.cursor ? Number(params.cursor) : entries.length;
  const start = Math.max(0, end - params.limit);
  return {
    data: entries.slice(start, end).reverse(),
    nextCursor: start ? String(start) : null,
    backwardsCursor: String(start),
  };
}
