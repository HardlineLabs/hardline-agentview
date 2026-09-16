import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserTranscript, BrowserToolState } from "../browser/Transcript";
import {
  ArrowUp,
  Square,
  Plus,
  X,
  Sparkles,
  ChevronDown,
  FileText,
  Terminal,
  Check,
  AlertCircle,
  GitBranch,
  Copy,
  LoaderCircle,
  MessageSquare,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { ChoicePicker } from "../browser/ChoicePicker";
import { useBrowserComposer } from "../browser/composer";
import { ContextUsage } from "./Usage";
import { ElicitationFields } from "./ElicitationFields";
import {
  elicitationContent,
  type ElicitationSchema,
} from "../shared/elicitation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke, browser } from "./api";
import {
  browserDrafts,
  browserAttachments,
  saveDrafts,
  type Attachment,
} from "../browser/bridge";
import type {
  Approval,
  ChatItem,
  ChatPage,
  Model,
  Note,
  Project,
  Thread,
  Turn,
} from "../shared/types";

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href?.startsWith("https://") ? href : undefined}
            target="_blank"
            rel="noreferrer"
          >
            {children}
          </a>
        ),
        img: ({ alt }) => (
          <span className="attachment-placeholder">
            {alt || "Image attachment"}
          </span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
function Item({ item, lazy = false }: { item: ChatItem; lazy?: boolean }) {
  const expanded = useContext(BrowserToolState);
  const [open, setOpen] = useState(() => Boolean(expanded?.has(item.id)));
  if (item.type === "userMessage") {
    const text =
      item.content
        ?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
        .join("\n") || "";
    return (
      <div className="user-message">
        <div>{text.split("\n\nAttached vault note:")[0]}</div>
        {text.includes("Attached vault note:") && (
          <small>
            <FileText size={12} /> Vault note attached
          </small>
        )}
      </div>
    );
  }
  if (item.type === "agentMessage" || item.type === "plan")
    return (
      <div className="agent-message">
        <div className="message-byline">
          <Sparkles size={12} />
          <span>{item.type === "plan" ? "Plan" : "Agent"}</span>
          <button
            title="Copy message"
            onClick={() =>
              void invoke("clipboard.write", { text: item.text || "" })
            }
          >
            <Copy size={12} />
          </button>
        </div>
        <div className="markdown">
          <Markdown text={item.text || ""} />
        </div>
      </div>
    );
  const text =
    (item.type === "commandExecution"
      ? "Run a command on the host"
      : undefined) ||
    (item.type === "fileChange"
      ? item.changes?.map((c) => c.path.split(/[\\/]/).pop()).join(", ")
      : String(item.tool || item.query || item.type));
  return (
    <details
      className="tool-item"
      open={lazy ? open : undefined}
      onToggle={
        lazy
          ? (event) => {
              const next = event.currentTarget.open;
              if (next) expanded?.add(item.id);
              else expanded?.delete(item.id);
              setOpen(next);
            }
          : undefined
      }
    >
      <summary>
        {item.type === "fileChange" ? (
          <FileText size={13} />
        ) : (
          <Terminal size={13} />
        )}
        <span>{text}</span>
        {item.status === "inProgress" ? (
          <LoaderCircle size={12} className="spin" />
        ) : item.status === "failed" ? (
          <AlertCircle size={12} />
        ) : (
          <Check size={12} />
        )}
      </summary>
      {(!lazy || open) && (
        <pre>
          {item.command || text}
          {item.aggregatedOutput ? "\n\n" + item.aggregatedOutput : ""}
          {item.changes?.map((c) => "\n" + (c.diff || c.path)).join("")}
        </pre>
      )}
    </details>
  );
}
const BrowserItem = memo(Item);
const emptyTurns: Turn[] = [];
function ApprovalCard({
  approval,
  onError,
}: {
  approval: Approval;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const elicitation = approval.method === "mcpServer/elicitation/request";
  const schema: ElicitationSchema | undefined =
    elicitation && approval.params.mode === "form"
      ? approval.params.requestedSchema
      : undefined;
  const [content, setContent] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      Object.entries(schema?.properties || {})
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default]),
    ),
  );
  const form = useRef<HTMLFormElement>(null);
  const questions = approval.params.questions as
    | {
        id: string;
        question: string;
        options?: { label: string; description?: string }[];
      }[]
    | undefined;
  const respond = async (allow: boolean) => {
    if (allow && !form.current?.reportValidity()) return;
    setBusy(true);
    try {
      await invoke("approval.respond", {
        id: approval.id,
        allow,
        ...(allow && schema
          ? { content: elicitationContent(schema, content) }
          : {}),
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, answer]) => [
            id,
            { answers: [answer] },
          ]),
        ),
      });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      ref={form}
      className="approval-card"
      onSubmit={(e) => {
        e.preventDefault();
        void respond(true);
      }}
    >
      <div className="eyebrow">
        <AlertCircle size={13} /> Your attention
      </div>
      {questions ? (
        questions.map((q) => (
          <label key={q.id}>
            {q.question}
            {q.options && (
              <div className="answer-options">
                {q.options.map((o) => (
                  <button
                    type="button"
                    className={answers[q.id] === o.label ? "selected" : ""}
                    key={o.label}
                    onClick={() =>
                      setAnswers((a) => ({ ...a, [q.id]: o.label }))
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            <input
              placeholder="Your answer"
              value={answers[q.id] || ""}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
              }
            />
          </label>
        ))
      ) : (
        <p>
          {approval.params.reason ||
            approval.params.message ||
            approval.params.command ||
            "The agent needs permission to continue."}
        </p>
      )}
      {schema && (
        <ElicitationFields
          schema={schema}
          values={content}
          onChange={(name, value) =>
            setContent((c) => ({ ...c, [name]: value }))
          }
        />
      )}
      {elicitation &&
        approval.params.mode === "url" &&
        /^https?:\/\//i.test(approval.params.url) && (
          <a href={approval.params.url} target="_blank" rel="noreferrer">
            Open permission request
          </a>
        )}
      {!questions &&
        (approval.params.command ||
          approval.params.permissions ||
          approval.params.changes) && (
          <details className="tool-item" open>
            <summary>Requested action</summary>
            <pre>
              {approval.params.command ||
                JSON.stringify(
                  approval.params.permissions || approval.params.changes,
                  null,
                  2,
                )}
            </pre>
          </details>
        )}
      <div className="approval-actions">
        {!questions && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond(false)}
          >
            Decline
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            busy || Boolean(questions?.some((q) => !answers[q.id]?.trim()))
          }
        >
          {busy ? "Sending…" : questions ? "Send answer" : "Allow"}
        </button>
      </div>
    </form>
  );
}
type Props = {
  autoApproveSupported?: boolean;
  autoApproveEnabled?: boolean;
  fullAccess?: boolean;
  approvalActivity?: { id: string; detail: string; time: number }[];
  expanded?: boolean;
  onboarding?: string;
  thread?: Thread;
  page?: ChatPage;
  loading: boolean;
  connected: boolean;
  ready: boolean;
  models: Model[];
  projects: Project[];
  approvals: Approval[];
  attachment?: Note;
  onDetach: () => void;
  onNew: () => void;
  onSent: (thread: Thread, turn: Turn) => void;
  onLoadMore: () => void;
  onError: (message: string) => void;
  onHide: () => void;
  onCleared: () => void;
};
export function Chat(props: Props) {
  const currentChat = useRef(props.thread?.id || "new");
  currentChat.current = props.thread?.id || "new";
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [rename, setRename] = useState<string>();
  const [renamed, setRenamed] = useState<string>();
  const [recovery, setRecovery] = useState<any>();
  const [queueMode, setQueueMode] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const persist = () => {
    if (browser) void saveDrafts().catch((e) => props.onError(e.message));
  };
  const [text, setText] = useState("");
  const drafts = useRef(browser ? browserDrafts : new Map<string, string>());
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState<"archive" | "delete">();
  const [sentNotice, setSentNotice] = useState("");
  const [steering, setSteering] = useState<
    {
      id: string;
      threadId: string;
      text: string;
      state: "sending" | "waiting" | "uncertain";
    }[]
  >([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  const choices = useRef(new Map<string, { model: string; effort: string }>());
  const [projectId, setProjectId] = useState("vault");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = Boolean(
    props.thread?.owned &&
    props.page?.turns.some((t) => t.status === "inProgress"),
  );
  const currentModel = props.models.find((m) => m.id === model);
  const received = useMemo(() => {
    const ids = new Set<string>();
    for (const turn of props.page?.turns || [])
      for (const item of turn.items) {
        if (item.type !== "userMessage") continue;
        ids.add(item.id);
        if (item.clientId) ids.add(item.clientId);
      }
    return ids;
  }, [props.page?.turns]);
  useEffect(() => {
    setSteering((messages) =>
      messages.some((m) => received.has(m.id))
        ? messages.filter((m) => !received.has(m.id))
        : messages,
    );
  }, [received]);
  useEffect(() => {
    const saved = choices.current.get(props.thread?.id || "new");
    setModel(
      saved?.model ||
        props.thread?.model ||
        props.models.find((m) => m.isDefault)?.id ||
        props.models[0]?.id ||
        "",
    );
    setEffort(saved?.effort || props.thread?.reasoningEffort || "high");
  }, [props.thread?.id, props.thread?.model, props.thread?.reasoningEffort]);
  useEffect(() => {
    setText(drafts.current.get(props.thread?.id || "new") || "");
    setAttachments(
      browser ? browserAttachments.get(props.thread?.id || "new") || [] : [],
    );
    setRename(undefined);
    setRenamed(undefined);
    setRecovery(undefined);
    setQueueMode(false);
    setConfirmClear(undefined);
    setSentNotice("");
    follow.current = true;
  }, [props.thread?.id]);
  const chooseEffort = (value: string) => {
    choices.current.set(props.thread?.id || "new", { model, effort: value });
    setEffort(value);
  };
  const chooseModel = (value: string) => {
    const nextEffort =
      props.models.find((m) => m.id === value)?.defaultReasoningEffort ||
      "high";
    choices.current.set(props.thread?.id || "new", {
      model: value,
      effort: nextEffort,
    });
    setModel(value);
    setEffort(nextEffort);
  };
  useEffect(() => {
    if (!model && props.models.length)
      setModel(props.models.find((m) => m.isDefault)?.id || props.models[0].id);
  }, [props.models, model]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [props.page, sending, steering]);
  useEffect(() => {
    if (!browser || !scroll.current) return;
    const panel = scroll.current;
    const observer = new ResizeObserver(() => {
      // Keep the latest message above the keyboard, unless reading history.
      if (follow.current && panel.clientHeight)
        panel.scrollTop = panel.scrollHeight;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const animateSend = useBrowserComposer(
    input,
    follow,
    browser,
    text,
    props.thread?.id,
  );
  const send = async (onboardingText?: string) => {
    const outgoingText = onboardingText ?? text;
    if (
      (!outgoingText.trim() && !attachments.length) ||
      sending ||
      uploading ||
      !props.connected ||
      !props.ready ||
      props.thread?.archived
    )
      return;
    setSending(true);
    const draftId = props.thread?.id || "new";
    const messageId = crypto.randomUUID();
    const isSteering = active && !queueMode;
    if (isSteering) {
      follow.current = true;
      setSteering((messages) => [
        ...messages,
        {
          id: messageId,
          threadId: draftId,
          text: [outgoingText, ...attachments.map((a) => `[${a.name}]`)].join(
            "\n",
          ),
          state: "sending",
        },
      ]);
    }
    try {
      let created: Thread | undefined;
      let id = props.thread?.id;
      if (!id) {
        const thread = await invoke("thread.create", { projectId, model });
        created = thread;
        id = thread.id;
      }
      const result = await invoke(
        active && queueMode
          ? "queue.add"
          : active
            ? "thread.steer"
            : "thread.send",
        {
          id,
          clientUserMessageId: messageId,
          expectedTurnId: props.page?.turns
            .filter((t) => t.status === "inProgress")
            .at(-1)?.id,
          text: outgoingText,
          ...(props.expanded
            ? { attachments: attachments.map(({ id }) => ({ id })) }
            : {}),
          model,
          effort,
          noteId: props.attachment?.id,
        },
      );
      if (isSteering)
        setSteering((messages) =>
          messages.map((m) =>
            m.id === messageId ? { ...m, state: "waiting" } : m,
          ),
        );
      drafts.current.delete(draftId);
      browserAttachments.delete(draftId);
      persist();
      if (currentChat.current !== draftId) return;
      if (!onboardingText) animateSend(isSteering);
      setAttachments([]);
      setText("");
      props.onDetach();
      if (active && queueMode) setSentNotice("Follow-up queued on the host.");
      else if (!result.steered) {
        choices.current.set(result.threadId, { model, effort });
        props.onSent(
          {
            ...(result.thread || created || props.thread),
            id: result.threadId,
            model,
            reasoningEffort: effort,
            owned: true,
          },
          result.turn,
        );
      }
      follow.current = true;
    } catch (e: any) {
      if (isSteering)
        setSteering((messages) =>
          /disconnect|did not answer|unavailable|stopped|uncertain/i.test(
            e.message,
          )
            ? messages.map((m) =>
                m.id === messageId ? { ...m, state: "uncertain" } : m,
              )
            : messages.filter((m) => m.id !== messageId),
        );
      props.onError(e.message);
    } finally {
      setSending(false);
      if (!browser) input.current?.focus();
      else if (
        currentChat.current === draftId &&
        input.current
          ?.closest(".composer-area")
          ?.contains(document.activeElement)
      )
        input.current.focus({ preventScroll: true });
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const key = props.thread?.id || "new";
    try {
      const next = [...attachments];
      for (const original of [...files]) {
        if (next.length >= 8)
          throw new Error("Attach up to eight files per message.");
        let file: Blob = original;
        let name = original.name;
        if (original.type.startsWith("image/")) {
          const url = URL.createObjectURL(original);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const scale = Math.min(
              1,
              2048 / Math.max(image.width, image.height),
            );
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            canvas
              .getContext("2d")!
              .drawImage(image, 0, 0, canvas.width, canvas.height);
            file = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (b) =>
                  b
                    ? resolve(b)
                    : reject(new Error("Image could not be prepared.")),
                "image/jpeg",
                0.9,
              ),
            );
            name = original.name.replace(/\.[^.]+$/, "") + ".jpg";
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        if (file.size > 6 * 1024 * 1024)
          throw new Error(
            "Attachments must be at most 6 MB. Choose a smaller file.",
          );
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("File could not be read."));
          reader.readAsDataURL(file);
        });
        const uploaded = await invoke("files.upload", {
          name,
          mime: file.type,
          data: dataUrl.split(",")[1],
        });
        next.push({
          ...uploaded,
          preview: file.type.startsWith("image/") ? dataUrl : undefined,
        });
        browserAttachments.set(key, [...next]);
        if (currentChat.current === key) setAttachments([...next]);
        persist();
      }
    } catch (e: any) {
      props.onError(e.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const clear = async (action: "archive" | "unarchive" | "delete") => {
    setClearing(true);
    try {
      await invoke(`thread.${action}`, {
        id: props.thread!.id,
        confirm: action === "delete" ? props.thread!.id : undefined,
      });
      setConfirmClear(undefined);
      props.onCleared();
    } catch (e: any) {
      props.onError(e.message);
    } finally {
      setClearing(false);
    }
  };
  return (
    <aside className="chat-panel">
      <header className="chat-heading">
        <div className="chat-icon">
          <MessageSquare size={16} />
        </div>
        <div>
          <span className="eyebrow">Conversation</span>
          <h3>
            {renamed ||
              props.thread?.name ||
              (props.thread
                ? props.thread.preview.slice(0, 42)
                : "A fresh perspective")}
          </h3>
        </div>
        <button
          className="icon-button"
          title="New conversation"
          onClick={props.onNew}
        >
          <Plus size={17} />
        </button>
        <button
          className="icon-button chat-hide"
          title="Hide conversation"
          onClick={props.onHide}
        >
          <ChevronDown size={17} />
        </button>
      </header>
      {props.thread && (
        <>
          <div className="chat-management">
            {props.autoApproveSupported && (
              <button
                type="button"
                className="auto-approve-toggle"
                title={
                  !props.thread.owned
                    ? "Continue in AgentView to enable auto-approval."
                    : !props.fullAccess
                      ? "Requires Full access in Workspace settings."
                      : "Automatically allow commands, file changes and permissions in this chat. Questions still come to you."
                }
                aria-pressed={Boolean(props.autoApproveEnabled)}
                disabled={
                  !props.connected ||
                  approvalBusy ||
                  (!props.autoApproveEnabled &&
                    (!props.fullAccess || !props.thread.owned))
                }
                onClick={async () => {
                  setApprovalBusy(true);
                  try {
                    await invoke("thread.autoApprove", {
                      id: props.thread!.id,
                      enabled: !props.autoApproveEnabled,
                    });
                  } catch (e: any) {
                    props.onError(e.message);
                  } finally {
                    setApprovalBusy(false);
                  }
                }}
              >
                {approvalBusy
                  ? "Saving…"
                  : props.autoApproveEnabled
                    ? props.fullAccess
                      ? "Auto-approve on"
                      : "Auto-approve paused"
                    : "Auto-approve off"}
              </button>
            )}
            {props.expanded && (
              <>
                <button
                  onClick={() =>
                    setRename(
                      props.thread?.name ||
                        props.thread?.preview.slice(0, 100) ||
                        "",
                    )
                  }
                >
                  Rename
                </button>
                <button
                  onClick={() =>
                    void invoke("thread.recovery", { id: props.thread!.id })
                      .then(setRecovery)
                      .catch((e) => props.onError(e.message))
                  }
                >
                  Recovery
                </button>
              </>
            )}
            <button
              disabled={!props.connected || clearing || active}
              onClick={() =>
                props.thread?.archived
                  ? void clear("unarchive")
                  : setConfirmClear("archive")
              }
            >
              {props.thread.archived ? (
                <ArchiveRestore size={13} />
              ) : (
                <Archive size={13} />
              )}
              {props.thread.archived ? "Restore" : "Archive"}
            </button>
            <button
              disabled={!props.connected || clearing || active}
              onClick={() => setConfirmClear("delete")}
            >
              <Trash2 size={13} /> Delete
            </button>
            {props.thread.section && <small>{props.thread.section.name}</small>}
          </div>
          {rename !== undefined && (
            <form
              className="rename-chat"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const result = await invoke("thread.rename", {
                    id: props.thread!.id,
                    name: rename,
                  });
                  setRenamed(result.name);
                  setRename(undefined);
                } catch (e: any) {
                  props.onError(e.message);
                }
              }}
            >
              <input
                aria-label="Conversation name"
                maxLength={200}
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
              <button type="button" onClick={() => setRename(undefined)}>
                Cancel
              </button>
              <button disabled={!rename.trim()}>Save name</button>
            </form>
          )}
          {recovery && (
            <div className="recovery-card">
              <strong>
                {recovery.persisted
                  ? "Saved in the host runtime"
                  : "Persistence not confirmed"}
              </strong>
              <code>{recovery.id}</code>
              <p>{recovery.note}</p>
              <button
                onClick={() =>
                  void invoke("clipboard.write", {
                    text: recovery.resumeCommand,
                  })
                }
              >
                Copy resume command
              </button>
              <button onClick={() => setRecovery(undefined)}>Close</button>
            </div>
          )}
          {confirmClear && (
            <div
              className="clear-confirm"
              role="alertdialog"
              aria-label="Confirm conversation action"
            >
              <p>
                {confirmClear === "delete"
                  ? "Permanently delete this chat and its subagent chats from Codex on the host? This cannot be undone."
                  : "Archive this chat and its subagent chats in Codex on the host? You can restore archived chats later."}
              </p>
              <button
                disabled={clearing}
                onClick={() => setConfirmClear(undefined)}
              >
                Cancel
              </button>
              <button
                disabled={clearing}
                onClick={() => void clear(confirmClear)}
              >
                {clearing
                  ? "Working…"
                  : confirmClear === "delete"
                    ? "Delete permanently"
                    : "Archive conversation"}
              </button>
            </div>
          )}
          <ContextUsage usage={props.thread.usage} compact={browser} />
        </>
      )}
      <div
        className="chat-scroll"
        ref={scroll}
        onScrollCapture={
          browser
            ? () => {
                // Record bottom-follow intent before virtual rows measure new heights.
                const e = scroll.current!;
                follow.current =
                  e.scrollHeight - e.scrollTop - e.clientHeight < 90;
              }
            : undefined
        }
        onScroll={
          browser
            ? undefined
            : () => {
                const e = scroll.current!;
                follow.current =
                  e.scrollHeight - e.scrollTop - e.clientHeight < 90;
              }
        }
      >
        {Boolean(props.approvalActivity?.length) && (
          <details className="auto-approve-history">
            <summary>
              Recent auto-approvals ({props.approvalActivity!.length})
            </summary>
            <ul>
              {props.approvalActivity!.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  {entry.detail} ·{" "}
                  {new Date(entry.time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </li>
              ))}
            </ul>
          </details>
        )}
        {props.loading && (!browser || !props.page) ? (
          <div className="chat-loading">
            <LoaderCircle className="spin" size={18} /> Opening conversation
          </div>
        ) : !props.thread ? (
          <div className="chat-welcome">
            <div className="welcome-spark">
              <Sparkles size={26} />
            </div>
            <h2>
              Space to think.
              <br />
              Room to build.
            </h2>
            <p>
              Start a conversation. Your agent works on the host, while you
              watch ideas take shape.
            </p>
            <label className="workspace-select">
              <span>Working in</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {props.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="starter-prompts">
              {["Explore this workspace", "What should we work on next?"].map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setText(s);
                      drafts.current.set(props.thread?.id || "new", s);
                      input.current?.focus();
                    }}
                  >
                    {s}
                    <ArrowUp size={13} />
                  </button>
                ),
              )}
            </div>
          </div>
        ) : (
          <>
            {props.page?.nextCursor && (
              <button className="load-more" onClick={props.onLoadMore}>
                <ArrowLeft size={12} /> Earlier messages
              </button>
            )}
            {browser ? (
              <BrowserTranscript
                key={props.thread.id}
                turns={props.page?.turns || emptyTurns}
                scroll={scroll}
                follow={follow}
                Item={BrowserItem}
              />
            ) : (
              props.page?.turns.map((turn) => (
                <div className="turn" key={turn.id}>
                  {turn.items.map((item) => (
                    <Item item={item} key={item.id} />
                  ))}
                  {turn.error && (
                    <div className="inline-error">{turn.error.message}</div>
                  )}
                </div>
              ))
            )}
            {!props.page?.turns.length && !props.page?.historyPending && (
              <p className="muted empty-history">
                The conversation is ready for your first message.
              </p>
            )}
          </>
        )}
        {steering
          .filter((m) => m.threadId === props.thread?.id && !received.has(m.id))
          .map((message) => (
            <div
              key={message.id}
              className="user-message steering-pending"
              role="status"
            >
              <div>{message.text}</div>
              <small>
                {message.state === "sending"
                  ? "Sending…"
                  : message.state === "waiting"
                    ? "Waiting for agent"
                    : "Delivery unconfirmed — check before resending"}
              </small>
            </div>
          ))}
        {(active || sending) && (
          <div className="working-indicator">
            <i />
            <i />
            <i />
            <span>{sending ? "Sending to your host" : "Agent is working"}</span>
          </div>
        )}
        {props.approvals
          .filter(
            (a) => !a.params.threadId || a.params.threadId === props.thread?.id,
          )
          .map((a) => (
            <ApprovalCard approval={a} onError={props.onError} key={a.id} />
          ))}
      </div>
      <div className="composer-area">
        {props.page?.historyPending && (
          <div className="conversation-updating" role="status">
            <LoaderCircle className="spin" size={12} /> Loading saved history…
          </div>
        )}
        {browser && props.page && (props.loading || !props.connected) && (
          <div className="conversation-updating" role="status">
            <LoaderCircle className="spin" size={12} />
            {props.connected
              ? "Updating..."
              : "Reconnecting - showing last update"}
          </div>
        )}
        {props.expanded &&
          props.onboarding?.trim() &&
          !props.loading &&
          (!props.thread ||
            (props.page &&
              !props.page.nextCursor &&
              !props.page.turns.length)) &&
          !active && (
            <button
              className="onboard-agent"
              disabled={
                sending || !props.connected || !props.ready || uploading
              }
              onClick={() => void send(props.onboarding)}
            >
              Onboard agent
            </button>
          )}
        {sentNotice && (
          <div className="branch-hint" role="status">
            {sentNotice}
          </div>
        )}
        {props.thread?.archived && (
          <div className="branch-hint">
            Archived conversation · Restore to continue
          </div>
        )}
        {props.thread && !props.thread.owned && (
          <div className="branch-hint">
            <GitBranch size={12} /> Continues in a new AgentView branch
          </div>
        )}
        <div className="composer">
          <div
            className={`composer-draft${browser && active && !queueMode ? " composer-steering" : ""}`}
          >
            {props.expanded && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  aria-label="Attach files or images"
                  onChange={(e) => void upload(e.target.files)}
                />
                <div className="message-attachments">
                  {attachments.map((a) => (
                    <div key={a.id}>
                      {a.preview && <img src={a.preview} alt={a.name} />}
                      <span>{a.name}</span>
                      <button
                        aria-label={`Remove ${a.name}`}
                        onClick={() => {
                          const next = attachments.filter(
                            (item) => item.id !== a.id,
                          );
                          setAttachments(next);
                          browserAttachments.set(
                            props.thread?.id || "new",
                            next,
                          );
                          persist();
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {props.attachment && (
              <div className="attached-note">
                <FileText size={12} />
                <span>{props.attachment.title}</span>
                <button onClick={props.onDetach} title="Remove attachment">
                  <X size={12} />
                </button>
              </div>
            )}
            <textarea
              ref={input}
              aria-label="Message your agent"
              placeholder={
                props.connected
                  ? active
                    ? "Steer the agent while it works…"
                    : "Give your ideas somewhere to go…"
                  : "Reconnect to continue…"
              }
              value={text}
              disabled={props.thread?.archived}
              readOnly={browser && sending}
              onChange={(e) => {
                setText(e.target.value);
                drafts.current.set(props.thread?.id || "new", e.target.value);
                persist();
              }}
              onKeyDown={(e) => {
                if (
                  !window.matchMedia("(pointer: coarse)").matches &&
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={browser ? 1 : 3}
            />
          </div>
          <div className="composer-bottom">
            {props.expanded && (
              <button
                className="attach-file"
                title="Attach files or images"
                disabled={uploading || sending || !props.connected}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? "Preparing…" : <Plus size={18} />}
              </button>
            )}
            <div className="model-controls">
              {browser ? (
                <>
                  <ChoicePicker
                    label="Model"
                    value={model}
                    disabled={active || sending}
                    options={props.models.map((m) => ({
                      value: m.id,
                      label: m.displayName,
                    }))}
                    onChange={chooseModel}
                  />
                  <ChoicePicker
                    label="Reasoning effort"
                    value={effort}
                    disabled={active || sending}
                    options={(
                      currentModel?.supportedReasoningEfforts || [
                        { reasoningEffort: "high" },
                      ]
                    ).map((e) => ({
                      value: e.reasoningEffort,
                      label: e.reasoningEffort,
                    }))}
                    onChange={chooseEffort}
                  />
                </>
              ) : (
                <>
                  <select
                    aria-label="Model"
                    disabled={active || sending}
                    value={model}
                    onChange={(e) => chooseModel(e.target.value)}
                  >
                    {props.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Reasoning effort"
                    disabled={active || sending}
                    value={effort}
                    onChange={(e) => chooseEffort(e.target.value)}
                  >
                    {(
                      currentModel?.supportedReasoningEfforts || [
                        { reasoningEffort: "high" },
                      ]
                    ).map((e) => (
                      <option key={e.reasoningEffort} value={e.reasoningEffort}>
                        {e.reasoningEffort}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            {active && (
              <button
                className="send-button stop"
                title="Stop agent"
                onClick={() =>
                  void invoke("thread.interrupt", {
                    id: props.thread?.id,
                  }).catch((e) => props.onError(e.message))
                }
              >
                <Square size={14} fill="currentColor" />
              </button>
            )}
            {
              <button
                className="send-button"
                title={active ? "Steer agent" : "Send message"}
                disabled={
                  (!text.trim() && !attachments.length) ||
                  uploading ||
                  sending ||
                  !props.connected ||
                  !props.ready ||
                  props.thread?.archived
                }
                onClick={() => void send()}
              >
                {sending ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowUp size={18} />
                )}
              </button>
            }
          </div>
        </div>
        {props.expanded && active && (
          <label className="queue-choice">
            <input
              type="checkbox"
              checked={queueMode}
              onChange={(e) => setQueueMode(e.target.checked)}
            />{" "}
            Queue after current work
          </label>
        )}
        <div className="composer-foot">
          <span>
            <span
              className={`status-dot ${props.connected && props.ready ? "" : "offline"}`}
            />
            {props.connected && props.ready
              ? "Runs on your host"
              : props.connected
                ? "Agent unavailable"
                : "Host disconnected"}
          </span>
          <span className="keyboard-hint">
            ↵ send <b>·</b> shift ↵ newline
          </span>
          <span className="touch-hint">Tap the arrow to send</span>
        </div>
      </div>
    </aside>
  );
}
