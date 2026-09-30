import type { ChatItem, Turn } from "../shared/types";

// Bound display data before encryption. Original items remain in runtime storage.
export const HISTORY_BYTES = 256 * 1024;
const MESSAGE_CHARS = 24_000;
const PREVIEW_CHARS = 600;
export type ItemReference = {
  threadId: string;
  turnId: string;
  itemId: string;
  cursor?: string | null;
};
type Position = { cursor: string | null; before?: [string, string] };
export function historyPosition(cursor?: string): Position {
  if (!cursor?.startsWith("av1:")) return { cursor: cursor || null };
  try {
    if (cursor.length > 8192) throw new Error();
    const value = JSON.parse(
      Buffer.from(cursor.slice(4), "base64url").toString(),
    );
    if (value.cursor !== null && typeof value.cursor !== "string")
      throw new Error();
    if (
      !Array.isArray(value.before) ||
      value.before.length !== 2 ||
      value.before.some((v: unknown) => typeof v !== "string")
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("History position is invalid. Reopen the conversation.");
  }
}
export function displayItem(item: ChatItem, ref: ItemReference): ChatItem {
  ref = item.detail || ref;
  if (["userMessage", "agentMessage", "plan"].includes(item.type)) {
    const text =
      item.type === "userMessage"
        ? (item.content || [])
            .map((c) => (c.type === "text" ? c.text || "" : `[${c.type}]`))
            .join("\n")
        : item.text || "";
    const shortened = text.length > MESSAGE_CHARS;
    const attachments =
      item.type === "userMessage" &&
      item.content?.some((c) => c.type !== "text");
    if (
      !shortened &&
      !attachments &&
      Buffer.byteLength(JSON.stringify(item)) < 100_000
    )
      return item;
    return {
      id: item.id,
      type: item.type,
      clientId: item.clientId,
      ...(item.type === "userMessage"
        ? { content: [{ type: "text", text: text.slice(0, MESSAGE_CHARS) }] }
        : { text: text.slice(0, MESSAGE_CHARS) }),
      detail: ref,
    };
  }
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    tool: String(item.tool || item.query || item.type).slice(0, 160),
    command:
      typeof item.command === "string"
        ? item.command.slice(0, PREVIEW_CHARS)
        : undefined,
    aggregatedOutput:
      typeof item.aggregatedOutput === "string"
        ? item.aggregatedOutput.slice(0, PREVIEW_CHARS)
        : undefined,
    changes: item.changes
      ?.slice(0, 8)
      .map((c) => ({ path: c.path.slice(0, 300) })),
    detail: ref,
  };
}
export function displayHistory(
  threadId: string,
  turns: Turn[],
  position: Position,
  nextCursor: string | null,
) {
  const rows = turns.flatMap((turn) =>
    turn.items
      .filter((item) => !["reasoning", "hookPrompt"].includes(item.type))
      .map((item) => ({ turn, item })),
  );
  let end = rows.length;
  if (position.before) {
    end = rows.findIndex(
      (r) =>
        r.turn.id === position.before![0] && r.item.id === position.before![1],
    );
    if (end < 0)
      throw new Error(
        "History changed. Reopen the conversation to refresh its position.",
      );
  }
  const selected: { turn: Turn; item: ChatItem }[] = [];
  let bytes = 0;
  let start = end;
  while (start > 0) {
    const row = rows[start - 1];
    const item = displayItem(row.item, {
      threadId,
      turnId: row.turn.id,
      itemId: row.item.id,
      cursor: position.cursor,
    });
    const size = Buffer.byteLength(JSON.stringify(item)) + 128;
    if (selected.length && bytes + size > HISTORY_BYTES - 16_384) break;
    bytes += size;
    selected.unshift({ turn: row.turn, item });
    start--;
  }
  const output = new Map<string, Turn>();
  for (const { turn, item } of selected) {
    if (!output.has(turn.id))
      output.set(turn.id, {
        id: turn.id,
        status: turn.status,
        items: [],
        ...(turn.error
          ? { error: { message: turn.error.message.slice(0, 2000) } }
          : {}),
      });
    output.get(turn.id)!.items.push(item);
  }
  // Preserve empty turns and their lifecycle state for newly accepted messages.
  if (start === 0 && end === rows.length)
    for (const t of turns) {
      if (!t.items.some((i) => !["reasoning", "hookPrompt"].includes(i.type)))
        output.set(t.id, {
          id: t.id,
          status: t.status,
          items: [],
          ...(t.error
            ? { error: { message: t.error.message.slice(0, 2000) } }
            : {}),
        });
    }
  return {
    turns: turns.filter((t) => output.has(t.id)).map((t) => output.get(t.id)!),
    nextCursor:
      start > 0
        ? "av1:" +
          Buffer.from(
            JSON.stringify({
              cursor: position.cursor,
              before: [rows[start].turn.id, rows[start].item.id],
            }),
          ).toString("base64url")
        : nextCursor,
  };
}
export function itemText(item: ChatItem) {
  if (item.type === "agentMessage" || item.type === "plan")
    return item.text || "";
  if (
    item.type === "userMessage" &&
    item.content?.every((c) => c.type === "text")
  )
    return item.content.map((c) => c.text || "").join("\n");
  return JSON.stringify(item, null, 2);
}
