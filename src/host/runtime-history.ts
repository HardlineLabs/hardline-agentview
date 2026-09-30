import type { ChatItem, Turn } from "../shared/types";
import {
  displayItem,
  HISTORY_BYTES,
  itemText,
  type ItemReference,
} from "./history";

type Rpc = (method: string, params: any) => Promise<any>;
const cursorPrefix = "av2:";
const encode = (cursor: string) =>
  cursorPrefix + Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decode(cursor: string | null): string | null {
  if (!cursor) return null;
  try {
    if (!cursor.startsWith(cursorPrefix) || cursor.length > 8192)
      throw new Error();
    const value = JSON.parse(
      Buffer.from(cursor.slice(cursorPrefix.length), "base64url").toString(),
    );
    if (typeof value !== "string") throw new Error();
    return value;
  } catch {
    throw new Error("History position is invalid. Reopen the conversation.");
  }
}

// Runs beside app-server, before any original output can enter the worker pipe.
// Item count is only the runtime read granularity; the display page ends by bytes.
export async function readRuntimeHistory(
  rpc: Rpc,
  threadId: string,
  cursor: string | null,
) {
  let position = decode(cursor);
  const turns = new Map<string, Turn>();
  const metadata = new Map<string, Turn>();
  let metadataCursor: string | null = null;
  let metadataFinished = false;
  let bytes = 0;
  let newest: Turn | undefined;
  const seen = new Set<string>();
  async function turnInfo(id?: string) {
    while (!metadataFinished && (!id || !metadata.has(id))) {
      const page = await rpc("thread/turns/list", {
        threadId,
        cursor: metadataCursor,
        limit: 100,
        itemsView: "notLoaded",
        sortDirection: "desc",
      });
      for (const turn of page.data) metadata.set(turn.id, turn);
      newest ||= page.data[0];
      if (page.nextCursor && page.nextCursor === metadataCursor)
        throw new Error("Runtime repeated a history cursor.");
      metadataCursor = page.nextCursor || null;
      metadataFinished = !metadataCursor;
      if (!id) break;
    }
    return id ? metadata.get(id) : newest;
  }
  await turnInfo();
  let nextCursor: string | null = null;
  while (true) {
    const page = await rpc("thread/items/list", {
      threadId,
      cursor: position,
      limit: 1,
      sortDirection: "desc",
    });
    if (!Array.isArray(page.data) || page.data.length > 1)
      throw new Error("Runtime returned invalid item history.");
    const entry = page.data[0];
    if (entry && typeof page.backwardsCursor !== "string")
      throw new Error("Runtime does not support stable item detail cursors.");
    if (entry && !["reasoning", "hookPrompt"].includes(entry.item.type)) {
      const ref = {
        threadId,
        turnId: entry.turnId,
        itemId: entry.item.id,
        cursor: encode(page.backwardsCursor),
      };
      const item = displayItem(entry.item, ref);
      const size = Buffer.byteLength(JSON.stringify(item)) + 256;
      if (bytes && bytes + size > HISTORY_BYTES - 16_384) {
        nextCursor = position ? encode(position) : null;
        break;
      }
      const info = await turnInfo(entry.turnId);
      if (!info) throw new Error("History changed. Reopen the conversation.");
      if (!turns.has(entry.turnId))
        turns.set(entry.turnId, {
          id: entry.turnId,
          status: info.status,
          items: [],
          ...(info.error
            ? { error: { message: info.error.message.slice(0, 2000) } }
            : {}),
        });
      turns.get(entry.turnId)!.items.unshift(item);
      bytes += size;
    }
    if (!page.nextCursor) break;
    if (seen.has(page.nextCursor) || page.nextCursor === position)
      throw new Error("Runtime repeated a history cursor.");
    seen.add(page.nextCursor);
    position = page.nextCursor;
  }
  // A just-started turn can have no persisted items yet.
  if (!cursor && newest && !turns.has(newest.id))
    turns.set(newest.id, { id: newest.id, status: newest.status, items: [] });
  const data = [...turns.values()];
  // Map insertion follows newest-first items; empty newest turn must stay first.
  if (!cursor && newest)
    data.sort((a, b) =>
      a.id === newest!.id ? -1 : b.id === newest!.id ? 1 : 0,
    );
  const result = { data, nextCursor };
  if (Buffer.byteLength(JSON.stringify(result)) > HISTORY_BYTES)
    throw new Error("History page exceeded its byte limit.");
  return result;
}

export async function readRuntimeDetail(
  rpc: Rpc,
  ref: ItemReference,
  offset: number,
) {
  const page = await rpc("thread/items/list", {
    threadId: ref.threadId,
    cursor: decode(ref.cursor || null),
    limit: 1,
    sortDirection: "asc",
  });
  const entry = page.data?.[0];
  if (entry?.turnId !== ref.turnId || entry?.item.id !== ref.itemId)
    throw new Error(
      "History changed. Reopen the conversation to load this detail.",
    );
  const text = itemText(entry.item as ChatItem);
  const end = Math.min(text.length, offset + 32_000);
  return {
    text: text.slice(offset, end),
    nextOffset: end < text.length ? end : null,
    totalCharacters: text.length,
  };
}
