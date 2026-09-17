import type { AppEvent } from "../shared/types";

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  preview?: string;
};
type Outgoing = {
  method: string;
  threadId?: string;
  state: string;
  result?: any;
  error?: string;
};
export type ClientState = {
  hostId: string;
  selectedThread?: string;
  drafts: [string, string][];
  attachments: [string, Attachment[]][];
  outbox: [string, Outgoing][];
};
export const drafts = new Map<string, string>();
export const attachments = new Map<string, Attachment[]>();
export const outbox = new Map<string, Outgoing>();
let hostId: string | undefined;
let selectedThread: string | undefined;
let persist: (state: ClientState) => Promise<void> = async () => {};
let saving = Promise.resolve();
let generation = 0;
const activeRequests = new Set<string>();

export function restoreClientState(id: string, state?: ClientState) {
  generation++;
  drafts.clear();
  attachments.clear();
  outbox.clear();
  hostId = id;
  selectedThread = undefined;
  if (state?.hostId === id) {
    for (const [key, value] of state.drafts || []) drafts.set(key, value);
    for (const [key, value] of state.attachments || [])
      attachments.set(key, value);
    for (const [key, value] of state.outbox || []) outbox.set(key, value);
    selectedThread = state.selectedThread;
  }
  return selectedThread;
}
export function setClientPersistence(save: typeof persist) {
  persist = save;
}
export function saveDrafts(selected?: string) {
  if (selected !== undefined) selectedThread = selected;
  if (!hostId) return Promise.resolve();
  const state: ClientState = {
    hostId,
    selectedThread,
    drafts: [...drafts],
    attachments: [...attachments],
    outbox: [...outbox].map(([id, value]) => [id, { ...value }]),
  };
  saving = saving.catch(() => {}).then(() => persist(state));
  return saving;
}
export async function clearClientState() {
  restoreClientState("");
  await saving.catch(() => {});
}
type Request = (method: string, params?: any) => Promise<any>;
export async function recoverRequests(
  request: Request,
  emit: (event: AppEvent) => void,
) {
  const current = generation;
  for (const [requestId, outgoing] of outbox) {
    if (activeRequests.has(requestId)) continue;
    if (!["pending", "uncertain"].includes(outgoing.state)) continue;
    try {
      const receipt = await request("request.status", { requestId });
      if (generation !== current) return;
      outgoing.state =
        receipt.state === "missing" ? "uncertain" : receipt.state;
      outgoing.result = receipt.result;
      outgoing.error = receipt.error;
      if (receipt.state === "accepted")
        emit({
          type: "requestRecovered",
          requestId,
          method: outgoing.method,
          result: receipt.result,
        });
    } catch {
      /* Reconcile again when the host is reachable. */
    }
  }
  await saveDrafts().catch(() => {});
}
export async function requestWithReceipt(
  request: Request,
  method: string,
  params: any,
  supported: boolean,
) {
  if (
    !supported ||
    ![
      "thread.create",
      "thread.send",
      "thread.steer",
      "thread.rename",
      "thread.bulk",
      "queue.add",
    ].includes(method)
  )
    return request(method, params);
  const requestId = params.clientUserMessageId || crypto.randomUUID();
  const outgoing: Outgoing = { method, threadId: params.id, state: "pending" };
  const current = generation;
  outbox.set(requestId, outgoing);
  if (outbox.size > 50) outbox.delete(outbox.keys().next().value!);
  await saveDrafts();
  if (generation !== current)
    throw new Error("Workspace changed before the action was sent.");
  activeRequests.add(requestId);
  try {
    const result = await request("request.execute", {
      requestId,
      method,
      params,
    });
    outgoing.state = "accepted";
    outgoing.result = result;
    return result;
  } catch (error: any) {
    outgoing.state = "uncertain";
    outgoing.error = error.message;
    throw error;
  } finally {
    activeRequests.delete(requestId);
    if (generation === current) await saveDrafts().catch(() => {});
  }
}
