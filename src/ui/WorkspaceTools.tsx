import { useEffect, useState } from "react";
import { browser, invoke, subscribe } from "./api";
import type { Project, Thread } from "../shared/types";
import { outbox } from "./client-state";

export function WorkspaceTools({
  projects,
  onError,
  onThread,
}: {
  projects: Project[];
  onError: (s: string) => void;
  onThread: (id: string) => void;
}) {
  const [tab, setTab] = useState("Host");
  const [preferences, setPreferences] = useState<any>();
  const [diagnostics, setDiagnostics] = useState<any>();
  const [jobs, setJobs] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [project, setProject] = useState(projects[0]?.id || "");
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<any[]>([]);
  const [preview, setPreview] = useState<{
    name: string;
    url?: string;
    text?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [runtimeRestart, setRuntimeRestart] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const prefs = await invoke("host.preferences");
    setPreferences(prefs);
    const [queue, notifications] = await Promise.all([
      invoke("queue.list"),
      invoke("notifications.list"),
    ]);
    setJobs(queue.jobs);
    setNotices(notifications.notices);
  };
  useEffect(() => {
    void refresh().catch((e) => onError(e.message));
    return subscribe((e) => {
      if (e.type === "queue") setJobs(e.jobs);
      if (e.type === "notice") setNotices((n) => [...n, e.notice].slice(-100));
      if (e.type === "preferences") setPreferences(e.preferences);
    });
  }, []);
  useEffect(() => {
    if (tab === "Files" && project)
      void invoke("files.list", { projectId: project, path: folder })
        .then((r) => setEntries(r.entries))
        .catch((e) => onError(e.message));
  }, [tab, project, folder]);
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const file = async (entry: any, download: boolean) => {
    if (entry.directory) {
      setFolder(entry.path);
      return;
    }
    await run(async () => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let offset: number | null = 0;
      let size = 0;
      do {
        const result: any = await invoke("files.read", {
          projectId: project,
          path: entry.path,
          offset,
        });
        size = result.size;
        if (size > (download ? 128 : 8) * 1024 * 1024)
          throw new Error(
            download
              ? "Download files up to 128 MB from the phone."
              : "This file is too large to preview. Use Download.",
          );
        chunks.push(Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0)));
        offset = result.nextOffset;
      } while (offset !== null);
      const image = /\.(png|jpe?g|gif|webp)$/i.test(entry.name);
      const blob = new Blob(chunks, {
        type: image
          ? "image/" +
            (/\.jpe?g$/i.test(entry.name)
              ? "jpeg"
              : entry.name.split(".").pop())
          : "application/octet-stream",
      });
      if (download) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else if (image)
        setPreview({ name: entry.name, url: URL.createObjectURL(blob) });
      else
        setPreview({
          name: entry.name,
          text: (await blob.text()).slice(0, 100000),
        });
    });
  };
  return (
    <section className="workspace-tools">
      <nav aria-label="Workspace tools">
        {["Host", "Onboarding", "Files", "Queue", "Inbox"].map((name) => (
          <button
            key={name}
            className={tab === name ? "selected" : ""}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {tab === "Host" && (
        <>
          <label>
            Default agent permissions
            <select
              aria-label="Default agent permissions"
              value={preferences?.defaultPermissions || "workspace"}
              disabled={!preferences || busy}
              onChange={(e) =>
                void run(async () => {
                  setPreferences(
                    await invoke("host.preferences.update", {
                      defaultPermissions: e.target.value,
                    }),
                  );
                  setMessage(
                    "Default saved. Applies to new turns, including resumed chats.",
                  );
                })
              }
            >
              <option value="full">Full access</option>
              <option value="workspace">Workspace access</option>
              <option value="read-only">Read only</option>
            </select>
          </label>
          <p>
            Full access allows files and commands outside the workspace, with
            network access. Actions flagged by the runtime can still request
            approval. Windows administrator rights and computer-use app
            permissions are separate.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setDiagnostics(await invoke("host.diagnostics")),
              )
            }
          >
            Check host capabilities
          </button>
          {diagnostics && (
            <div className="diagnostic-details">
              <dl>
                <dt>Host version</dt>
                <dd>{diagnostics.hostVersion}</dd>
                <dt>Agent connection</dt>
                <dd>
                  {diagnostics.ready
                    ? "Ready"
                    : diagnostics.error || "Unavailable"}
                </dd>
                <dt>Execution survives host restart</dt>
                <dd>{diagnostics.persistentRuntime ? "Yes" : "No"}</dd>
                <dt>Host administrator</dt>
                <dd>{diagnostics.hostAdministrator ? "Yes" : "No"}</dd>
                <dt>Agent administrator</dt>
                <dd>
                  {diagnostics.runtimeAdministrator === null
                    ? "Not verified"
                    : diagnostics.runtimeAdministrator
                      ? "Yes"
                      : "No"}
                </dd>
                <dt>Default permissions</dt>
                <dd>{diagnostics.defaultPermissions}</dd>
              </dl>
              <details>
                <summary>Runtime and tools</summary>
                <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
              </details>
            </div>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await invoke("host.reconnect");
                setMessage(
                  r.ready
                    ? "Agent reconnected."
                    : "Agent remains unavailable. Check diagnostics.",
                );
              })
            }
          >
            Reconnect agent
          </button>
          <button disabled={busy} onClick={() => setRuntimeRestart(true)}>
            Restart execution runtime
          </button>
          {runtimeRestart && (
            <div role="alertdialog" aria-label="Restart execution runtime">
              <p>
                Restart the agent process to pick up runtime or tool updates.
                Finish or stop active work first.
              </p>
              <button onClick={() => setRuntimeRestart(false)}>Cancel</button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await invoke("host.runtime.restart");
                    setRuntimeRestart(false);
                    setMessage("Execution runtime restarted.");
                  })
                }
              >
                Restart runtime
              </button>
            </div>
          )}
        </>
      )}
      {tab === "Onboarding" && preferences && (
        <>
          <label>
            Default onboarding instruction
            <textarea
              aria-label="Default onboarding instruction"
              rows={9}
              value={preferences.onboarding}
              onChange={(e) =>
                setPreferences({ ...preferences, onboarding: e.target.value })
              }
            />
          </label>
          <p>
            “Onboard agent” sends this instruction in a new, empty conversation
            using its selected workspace and model.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await invoke("host.preferences.update", {
                  onboarding: preferences.onboarding,
                });
                setMessage("Onboarding instruction saved.");
              })
            }
          >
            Save onboarding
          </button>
        </>
      )}
      {tab === "Files" && (
        <>
          <label>
            Workspace
            <select
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setFolder("");
                setPreview(undefined);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="file-location">
            <button
              disabled={!folder}
              onClick={() =>
                setFolder(folder.split("/").slice(0, -1).join("/"))
              }
            >
              Up
            </button>
            <span>{folder || "Workspace root"}</span>
          </div>
          {entries.map((entry) => (
            <div className="file-entry" key={entry.path}>
              <button disabled={busy} onClick={() => void file(entry, false)}>
                {entry.directory ? "▸ " : ""}
                {entry.name}
              </button>
              {!entry.directory && (
                <button
                  disabled={busy}
                  aria-label={`Download ${entry.name}`}
                  onClick={() => void file(entry, true)}
                >
                  ↓
                </button>
              )}
            </div>
          ))}
          {preview && (
            <div className="file-preview">
              <strong>{preview.name}</strong>
              <button onClick={() => setPreview(undefined)}>
                Close preview
              </button>
              {preview.url ? (
                <img src={preview.url} alt={preview.name} />
              ) : (
                <pre>{preview.text}</pre>
              )}
            </div>
          )}
        </>
      )}
      {tab === "Queue" && (
        <>
          <p>
            Follow-ups queued from a conversation run after its current work
            finishes. Uncertain tasks are never automatically repeated.
          </p>
          {!jobs.length && <p>No queued work.</p>}
          {[...jobs].reverse().map((job) => (
            <article key={job.id}>
              <button onClick={() => onThread(job.threadId)}>
                {job.text.slice(0, 100)}
              </button>
              <small>
                {job.state}
                {job.error ? " · " + job.error : ""}
              </small>
              {job.state === "waiting" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await invoke("queue.cancel", { id: job.id });
                      await refresh();
                    })
                  }
                >
                  Remove
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {tab === "Inbox" && (
        <>
          <p>
            Get a notification when work finishes or needs your input.{" "}
            {browser
              ? "On iPhone, enable this from the installed Home Screen app."
              : "Keep AgentView open to receive Windows notifications."}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!browser) {
                  await invoke("notifications.desktop", { enabled: true });
                  setMessage(
                    "Windows notifications enabled while AgentView is open.",
                  );
                  return;
                }
                if (!("Notification" in window) || !("PushManager" in window))
                  throw new Error(
                    "Install AgentView on your Home Screen to enable iPhone notifications.",
                  );
                if ((await Notification.requestPermission()) !== "granted")
                  throw new Error(
                    "Notifications were not enabled. You can still use this inbox.",
                  );
                const registration =
                  await navigator.serviceWorker.getRegistration();
                if (!registration?.active)
                  throw new Error(
                    "Wait for installation to finish, then enable notifications.",
                  );
                const status = await invoke("notifications.status");
                const key = Uint8Array.from(
                  atob(
                    status.publicKey.replaceAll("-", "+").replaceAll("_", "/"),
                  ),
                  (c) => c.charCodeAt(0),
                );
                const subscription =
                  (await registration.pushManager.getSubscription()) ||
                  (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: key,
                  }));
                await invoke("notifications.subscribe", {
                  subscription: subscription.toJSON(),
                });
                setMessage("Notifications enabled on this device.");
              })
            }
          >
            Enable notifications
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!browser) {
                  await invoke("notifications.desktop", { enabled: false });
                  setMessage("Windows notifications disabled.");
                  return;
                }
                await invoke("notifications.unsubscribe");
                const reg = await navigator.serviceWorker.getRegistration();
                await (await reg?.pushManager.getSubscription())?.unsubscribe();
                setMessage("Notifications disabled on this device.");
              })
            }
          >
            Disable notifications
          </button>
          {[...notices].reverse().map((notice) => (
            <article key={notice.id}>
              <button
                onClick={() => notice.threadId && onThread(notice.threadId)}
              >
                {notice.title}
              </button>
              <small>{new Date(notice.time).toLocaleString()}</small>
            </article>
          ))}
          <details>
            <summary>Recent outgoing actions</summary>
            {[...outbox].reverse().map(([id, request]) => (
              <article key={id}>
                <strong>
                  {request.method} · {request.state}
                </strong>
                {(request.threadId ||
                  request.result?.id ||
                  request.result?.threadId) && (
                  <button
                    onClick={() =>
                      onThread(
                        request.result?.threadId ||
                          request.result?.id ||
                          request.threadId!,
                      )
                    }
                  >
                    Inspect conversation
                  </button>
                )}
                <small>{request.error}</small>
              </article>
            ))}
          </details>
        </>
      )}
      {busy && <p role="status">Working…</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function BulkChats({
  threads,
  onError,
  onDone,
}: {
  threads: Thread[];
  onError: (s: string) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="bulk-chats">
      <button
        onClick={() => {
          setOpen(!open);
          setAction(undefined);
        }}
      >
        Select conversations
      </button>
      {open && (
        <>
          <div>
            <button
              onClick={() =>
                setSelected(
                  threads
                    .filter((t) => t.status.type !== "active")
                    .slice(0, 100)
                    .map((t) => t.id),
                )
              }
            >
              Select visible
            </button>
            <button onClick={() => setSelected([])}>Clear</button>
          </div>
          <div className="bulk-list">
            {threads.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  disabled={busy || t.status.type === "active"}
                  checked={selected.includes(t.id)}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked
                        ? [...s, t.id].slice(0, 100)
                        : s.filter((id) => id !== t.id),
                    )
                  }
                />
                <span>{t.name || t.preview || "Untitled conversation"}</span>
              </label>
            ))}
          </div>
          <div>
            {["archive", "unarchive", "delete"].map((a) => (
              <button
                disabled={!selected.length || busy}
                key={a}
                onClick={() => setAction(a)}
              >
                {a === "unarchive"
                  ? "Restore"
                  : a === "archive"
                    ? "Archive"
                    : "Delete"}{" "}
                ({selected.length})
              </button>
            ))}
          </div>
          {action && (
            <div role="alertdialog" aria-label="Confirm bulk action">
              <p>
                {action === "delete"
                  ? "Permanently delete"
                  : action === "archive"
                    ? "Archive"
                    : "Restore"}{" "}
                {selected.length} conversations and their subagent chats
                {action === "delete" ? "? This cannot be undone." : "?"}
              </p>
              <button disabled={busy} onClick={() => setAction(undefined)}>
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await invoke("thread.bulk", {
                      ids: selected,
                      action,
                      confirm: action === "delete" ? selected : undefined,
                    });
                    const failed = r.results.filter((x: any) => !x.ok);
                    setSelected(failed.map((x: any) => x.id));
                    if (failed.length)
                      onError(failed.map((x: any) => x.error).join("; "));
                    else {
                      setOpen(false);
                      onDone();
                    }
                    setAction(undefined);
                  } catch (e: any) {
                    onError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Working…" : "Confirm"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
