import { useEffect, useRef, useState } from "react";
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
import { ContextUsage } from "./Usage";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "./api";
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
function Item({ item }: { item: ChatItem }) {
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
    <details className="tool-item">
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
      <pre>
        {item.command || text}
        {item.aggregatedOutput ? "\n\n" + item.aggregatedOutput : ""}
        {item.changes?.map((c) => "\n" + (c.diff || c.path)).join("")}
      </pre>
    </details>
  );
}
function ApprovalCard({
  approval,
  onError,
}: {
  approval: Approval;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = approval.params.questions as
    | {
        id: string;
        question: string;
        options?: { label: string; description?: string }[];
      }[]
    | undefined;
  const respond = async (allow: boolean) => {
    setBusy(true);
    try {
      await invoke("approval.respond", {
        id: approval.id,
        allow,
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
    <div className="approval-card">
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
            approval.params.command ||
            "The agent needs permission to continue."}
        </p>
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
          <button disabled={busy} onClick={() => void respond(false)}>
            Decline
          </button>
        )}
        <button
          className="primary"
          disabled={
            busy || Boolean(questions?.some((q) => !answers[q.id]?.trim()))
          }
          onClick={() => void respond(true)}
        >
          {busy ? "Sending…" : questions ? "Send answer" : "Allow"}
        </button>
      </div>
    </div>
  );
}
type Props = {
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
  onSent: (id: string, turn: Turn) => void;
  onLoadMore: () => void;
  onError: (message: string) => void;
  onHide: () => void;
  onCleared: () => void;
};
export function Chat(props: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState<"archive" | "delete">();
  const [sentNotice, setSentNotice] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  const [projectId, setProjectId] = useState("vault");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = Boolean(
    props.thread?.owned &&
      props.page?.turns.some((t) => t.status === "inProgress"),
  );
  const currentModel = props.models.find((m) => m.id === model);
  useEffect(() => {
    setModel(
      props.thread?.model ||
        props.models.find((m) => m.isDefault)?.id ||
        props.models[0]?.id ||
        "",
    );
    setEffort(props.thread?.reasoningEffort || "high");
    setText("");
    setConfirmClear(undefined);
    setSentNotice("");
    follow.current = true;
  }, [props.thread?.id]);
  useEffect(() => {
    if (!model && props.models.length)
      setModel(props.models.find((m) => m.isDefault)?.id || props.models[0].id);
  }, [props.models, model]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [props.page, sending]);
  const send = async () => {
    if (
      !text.trim() ||
      sending ||
      !props.connected ||
      !props.ready ||
      props.thread?.archived
    )
      return;
    setSending(true);
    try {
      let id = props.thread?.id;
      if (!id) {
        const thread = await invoke("thread.create", { projectId, model });
        id = thread.id;
      }
      const result = await invoke(active ? "thread.steer" : "thread.send", {
        id,
        expectedTurnId: props.page?.turns
          .filter((t) => t.status === "inProgress")
          .at(-1)?.id,
        text,
        model,
        effort,
        noteId: props.attachment?.id,
      });
      setText("");
      props.onDetach();
      if (result.steered)
        setSentNotice("Steering message accepted by the active agent.");
      else props.onSent(result.threadId, result.turn);
      follow.current = true;
    } catch (e: any) {
      props.onError(e.message);
    } finally {
      setSending(false);
      input.current?.focus();
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
            {props.thread?.name ||
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
          <ContextUsage usage={props.thread.usage} />
        </>
      )}
      <div
        className="chat-scroll"
        ref={scroll}
        onScroll={() => {
          const e = scroll.current!;
          follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 90;
        }}
      >
        {props.loading ? (
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
              {[
                "Explore the company brain",
                "What should we work on next?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setText(s);
                    input.current?.focus();
                  }}
                >
                  {s}
                  <ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {props.page?.nextCursor && (
              <button className="load-more" onClick={props.onLoadMore}>
                <ArrowLeft size={12} /> Earlier messages
              </button>
            )}
            {props.page?.turns.map((turn) => (
              <div className="turn" key={turn.id}>
                {turn.items.map((item) => (
                  <Item item={item} key={item.id} />
                ))}
                {turn.error && (
                  <div className="inline-error">{turn.error.message}</div>
                )}
              </div>
            ))}
            {!props.page?.turns.length && (
              <p className="muted empty-history">
                The conversation is ready for your first message.
              </p>
            )}
          </>
        )}
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
          />
          <div className="composer-bottom">
            <div className="model-controls">
              <select
                aria-label="Model"
                disabled={active}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setEffort(
                    props.models.find((m) => m.id === e.target.value)
                      ?.defaultReasoningEffort || "high",
                  );
                }}
              >
                {props.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <select
                aria-label="Reasoning effort"
                disabled={active}
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
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
                  !text.trim() ||
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
          <span>
            ↵ send <b>·</b> shift ↵ newline
          </span>
        </div>
      </div>
    </aside>
  );
}
