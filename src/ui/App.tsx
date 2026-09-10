import { useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Expand,
  FileText,
  Folder,
  Layers,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  Network,
  Plus,
  Radio,
  Search,
  Server,
  Settings2,
  Waves,
  X,
  Power,
  PanelRightClose,
  PanelRightOpen,
  Menu,
  ArrowLeft,
  ShieldCheck,
  QrCode,
} from "lucide-react";
import { BrainGraph, type GraphControls } from "./Graph";
import { UsageLimits } from "./Usage";
import { Chat, Markdown } from "./Chat";
import {
  ago,
  bridge,
  mobile,
  colors,
  domainLabel,
  invoke,
  role,
  subscribe,
} from "./api";
import QRCode from "qrcode";
import { applyConversationEvent } from "../shared/conversation";
import type {
  AppEvent,
  ChatPage,
  Graph,
  HostSettings,
  HostStatus,
  Note,
  Snapshot,
} from "../shared/types";

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 5 33 13v14L20 35 7 27V13L20 5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m7 13 13 8 13-8M20 21v14M20 5v16L7 27m13-6 13 6"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity=".6"
      />
      <circle cx="20" cy="21" r="4" fill="currentColor" />
      <circle cx="20" cy="5" r="2" fill="currentColor" />
      <circle cx="7" cy="27" r="2" fill="currentColor" />
      <circle cx="33" cy="13" r="2" fill="currentColor" />
    </svg>
  );
}
function WindowBar() {
  if (mobile) return null;
  return (
    <div className="window-bar">
      <div className="window-caption">
        <Mark size={15} />
        <span>Hardline {role === "host" ? "AgentView Host" : "AgentView"}</span>
      </div>
      <div className="window-controls">
        <button
          aria-label="Minimize"
          onClick={() => bridge?.window("minimize")}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label="Maximize"
          onClick={() => bridge?.window("maximize")}
        >
          <Maximize2 size={11} />
        </button>
        <button aria-label="Close" onClick={() => bridge?.window("close")}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
function HostApp() {
  const [status, setStatus] = useState<HostStatus>();
  const [form, setForm] = useState<HostSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [deviceName, setDeviceName] = useState("My device");
  const [invitation, setInvitation] = useState<{
    code: string;
    expiresAt: number;
    qr: string;
  }>();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const invite = async () => {
    try {
      const result = await invoke("host.invite", { name: deviceName });
      setInvitation({
        ...result,
        qr: await QRCode.toDataURL(result.code, {
          scale: 6,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      });
    } catch (e: any) {
      setError(e.message);
    }
  };
  const [networkReady, setNetworkReady] = useState(false);
  const [networkBusy, setNetworkBusy] = useState(false);
  useEffect(() => {
    void invoke("host.networkStatus")
      .then(setNetworkReady)
      .catch(() => {});
  }, [status?.settings.port]);
  useEffect(() => {
    void invoke("host.status").then((s) => {
      setStatus(s);
      setForm(s.settings);
    });
    return subscribe((e) => {
      if (e.type === "hostStatus") setStatus(e.status);
    });
  }, []);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke("host.save", form));
      setInvitation(undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (field: "vaultPath" | "codexPath") => {
    const value = await invoke(
      field === "vaultPath" ? "host.folder" : "host.codex",
    );
    if (value) setForm((s) => ({ ...s!, [field]: value }));
  };
  return (
    <div className="host-app">
      <WindowBar />
      <main className="host-content">
        <div className="host-brand">
          <Mark size={38} />
          <div>
            <h1>AgentView Host</h1>
            <p>Your workspace, always within reach.</p>
          </div>
        </div>
        <div className={`host-state ${status?.running ? "online" : ""}`}>
          <span className={`status-dot ${status?.running ? "" : "offline"}`} />
          <div>
            <strong>
              {status?.running
                ? "Your host is online"
                : busy
                  ? "Starting your host…"
                  : "Host is offline"}
            </strong>
            <p>
              {status?.running
                ? `${status.notes} notes · ${status.clients} connected ${status.clients === 1 ? "client" : "clients"}`
                : "Choose your vault and start the connection."}
            </p>
          </div>
          <Server size={24} />
        </div>
        {(error || status?.error) && (
          <div className="inline-error">{error || status?.error}</div>
        )}
        {form && (
          <>
            <div className="host-section">
              <label>
                Obsidian vault
                <div className="input-row">
                  <input
                    value={form.vaultPath}
                    onChange={(e) =>
                      setForm({ ...form, vaultPath: e.target.value })
                    }
                  />
                  <button
                    title="Choose vault folder"
                    onClick={() => void pick("vaultPath")}
                  >
                    <Folder size={17} />
                  </button>
                </div>
              </label>
              <div className="host-fields">
                <label>
                  Port
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) =>
                      setForm({ ...form, port: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.autoStart}
                    onChange={(e) =>
                      setForm({ ...form, autoStart: e.target.checked })
                    }
                  />{" "}
                  Start when I sign in
                </label>
              </div>
              <label className="remote-field">
                Remote endpoint
                <input
                  placeholder="wss://agentview.your-domain.com"
                  value={form.remoteAddress || ""}
                  onChange={(e) =>
                    setForm({ ...form, remoteAddress: e.target.value })
                  }
                />
                <small>
                  Use your host’s secure tunnel address. Local connections stay
                  direct.
                  {status?.remoteStatus &&
                  status.remoteStatus !== "Not configured"
                    ? ` Tunnel: ${status.remoteStatus}.`
                    : ""}
                </small>
              </label>
              <details className="host-advanced">
                <summary>
                  Agent runtime{" "}
                  <span
                    className={`status-dot ${status?.agentReady ? "" : "offline"}`}
                  />
                  {status?.agentReady ? "Connected" : "Not connected"}
                </summary>
                <p>
                  {status?.agentError ||
                    "Uses the existing Codex installation and sign-in on this PC."}
                </p>
                <div className="input-row">
                  <input
                    placeholder="Automatically find Codex"
                    value={form.codexPath}
                    onChange={(e) =>
                      setForm({ ...form, codexPath: e.target.value })
                    }
                  />
                  <button
                    title="Choose Codex executable"
                    onClick={() => void pick("codexPath")}
                  >
                    <Folder size={16} />
                  </button>
                </div>
              </details>
              <button
                className="primary host-save"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Power size={15} />
                )}{" "}
                {busy
                  ? "Applying settings…"
                  : status?.running
                    ? "Save & restart host"
                    : "Start host"}
              </button>
            </div>
          </>
        )}
        <div className="host-section connection-section">
          <div className="section-heading">
            <h3>Pair a device</h3>
            <span className="pill">
              <ShieldCheck size={12} /> Encrypted
            </span>
          </div>
          <p>
            Each paired device has full access to this workspace. Give each
            phone or computer its own invitation. Scan on Android or paste into
            AgentView.
          </p>
          <div className="input-row">
            <input
              aria-label="Device name"
              placeholder="Device name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            />
            <button
              className="secondary"
              disabled={!status?.running}
              onClick={() => void invite()}
            >
              <Plus size={15} /> Pair device
            </button>
          </div>
          {invitation && (
            <div className="pairing-invitation">
              {clock < invitation.expiresAt ? (
                <>
                  <img
                    src={invitation.qr}
                    alt="One-time device pairing QR code"
                  />
                  <p>
                    Expires in{" "}
                    {Math.ceil((invitation.expiresAt - clock) / 1000)} seconds ·
                    One use
                  </p>
                </>
              ) : (
                <p>Invitation expired. Create a fresh one to pair.</p>
              )}
            </div>
          )}
          <button
            className="copy-key"
            disabled={!invitation || clock >= invitation.expiresAt}
            onClick={() => {
              void invoke("clipboard.write", { text: invitation?.code });
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
            {copied ? "Invitation copied" : "Copy invitation"}
            <ArrowUpRight size={16} />
          </button>
          <div className="host-addresses">
            {status?.addresses.map((a) => (
              <code key={a}>{a.replace("wss://", "")}</code>
            ))}
          </div>
          <div className="network-setup">
            <button
              className="secondary"
              disabled={networkBusy || networkReady || !status?.running}
              onClick={async () => {
                setNetworkBusy(true);
                setError("");
                try {
                  setNetworkReady(await invoke("host.networkAllow"));
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setNetworkBusy(false);
                }
              }}
            >
              {networkReady ? (
                <Check size={14} />
              ) : networkBusy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Radio size={14} />
              )}{" "}
              {networkReady
                ? "LAN access enabled"
                : networkBusy
                  ? "Waiting for Windows approval…"
                  : "Allow LAN connections"}
            </button>
            <p>
              Allows this host port from your local network.
              <br />
              Windows may ask for administrator approval.
            </p>
          </div>
        </div>
        <div className="host-section">
          <div className="section-heading">
            <h3>Paired devices</h3>
            <span className="pill">{status?.devices?.length || 0}</span>
          </div>
          {!status?.devices?.length && (
            <p>Your paired phones and computers will appear here.</p>
          )}
          {status?.devices?.map((device) => (
            <div className="paired-device" key={device.id}>
              <ShieldCheck size={17} />
              <div>
                <strong>{device.name}</strong>
                <small>
                  Paired {new Date(device.createdAt).toLocaleDateString()}
                </small>
              </div>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    setStatus(await invoke("host.revoke", { id: device.id }));
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                Remove access
              </button>
            </div>
          ))}
        </div>
        <p className="host-footer">
          Closing this window keeps your host running in the tray.
          <br />
          The laptop must stay awake and signed in.
        </p>
      </main>
    </div>
  );
}
const emptyGraph: Graph = { nodes: [], links: [], revision: 0 };
function Connect({
  state,
  message,
  onConnect,
}: {
  state: string;
  message: string;
  onConnect: (code: string, address: string) => void;
}) {
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [scanError, setScanError] = useState("");
  const connecting = state === "connecting" || state === "reconnecting";
  return (
    <div className="connect-page">
      <div className="connect-art">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit orbit-three" />
        <div className="connect-emblem">
          <Mark size={76} />
        </div>
        <span className="satellite s-one" />
        <span className="satellite s-two" />
        <span className="satellite s-three" />
        <span className="satellite s-four" />
      </div>
      <div className="connect-copy">
        <span className="eyebrow">HARDLINE LABS / AGENTVIEW</span>
        <h1>
          A little closer
          <br />
          to your <em>next idea.</em>
        </h1>
        <p>
          Your conversations. Your living brain.
          <br />
          One calm place to bring it all together.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConnect(code, address);
          }}
        >
          {mobile && (
            <button
              type="button"
              className="scan-pairing secondary"
              disabled={connecting}
              onClick={async () => {
                setScanError("");
                try {
                  const result = await invoke("connection.scan");
                  setCode(result.value);
                  onConnect(result.value, "");
                } catch (e: any) {
                  setScanError(e.message);
                }
              }}
            >
              <QrCode size={20} /> Scan pairing invitation
            </button>
          )}
          <label>Pairing invitation</label>
          <textarea
            aria-label="Connection key"
            placeholder="Paste from AgentView Host"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={2}
          />
          <details>
            <summary>Use a different host address</summary>
            <input
              aria-label="Host address"
              placeholder="192.168.1.10:43120"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </details>
          <button className="primary" disabled={!code.trim() || connecting}>
            {connecting ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ArrowRight size={16} />
            )}{" "}
            {connecting ? "Finding your workspace…" : "Connect to workspace"}
          </button>
        </form>
        {(message || scanError) && (
          <div className="inline-error">{message || scanError}</div>
        )}
        <div className="connect-foot">
          <span className="status-dot" /> Files stay on your host. Ideas travel
          with you.
        </div>
      </div>
    </div>
  );
}
function ClientApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState("disconnected");
  const [route, setRoute] = useState("local");
  const [phoneView, setPhoneView] = useState<"chat" | "brain">("chat");
  const [drawer, setDrawer] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [selectedThread, setSelectedThread] = useState<string>();
  const [page, setPage] = useState<ChatPage>();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Note>();
  const [body, setBody] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [attachment, setAttachment] = useState<Note>();
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<string>();
  const [motion, setMotion] = useState(
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [labels, setLabels] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [filter, setFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const [toast, setToast] = useState("");
  const graph = useRef<GraphControls>(null);
  const threadRef = useRef(selectedThread);
  threadRef.current = selectedThread;
  const readGeneration = useRef(0);
  const noteGeneration = useRef(0);
  const notify = (message: string) => setToast(message);
  const readThread = async (id: string, more = false) => {
    const generation = ++readGeneration.current;
    if (!more) {
      setSelectedThread(id);
      setPage(undefined);
      setLoading(true);
    }
    setChatOpen(true);
    setPhoneView("chat");
    setDrawer(false);
    try {
      const result: ChatPage = await invoke("thread.read", {
        id,
        cursor: more ? page?.nextCursor : null,
      });
      if (generation !== readGeneration.current) return;
      setPage((old) =>
        more && old
          ? {
              ...result,
              turns: [
                ...result.turns.filter(
                  (t) => !old.turns.some((o) => o.id === t.id),
                ),
                ...old.turns,
              ],
            }
          : result,
      );
    } catch (e: any) {
      if (generation === readGeneration.current) notify(e.message);
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  };
  useEffect(() => {
    const onEvent = (event: AppEvent) => {
      if (event.type === "connection") {
        setConnection(event.state);
        if (event.route) setRoute(event.route);
        setConnectionError(event.message || "");
      }
      if (event.type === "snapshot") {
        setSnapshot(event.snapshot);
        if (threadRef.current) void readThread(threadRef.current);
      }
      if (event.type === "graph")
        setSnapshot((s) =>
          s ? { ...s, graph: event.graph, projects: event.projects } : s,
        );
      if (event.type === "threads")
        setSnapshot((s) =>
          s
            ? {
                ...s,
                threads: event.threads,
                projects: event.projects || s.projects,
                sections: event.sections || s.sections,
              }
            : s,
        );
      if (event.type === "limits")
        setSnapshot((s) => (s ? { ...s, limits: event.limits } : s));
      if (event.type === "usage") {
        setSnapshot((s) =>
          s
            ? {
                ...s,
                threads: s.threads.map((t) =>
                  t.id === event.threadId ? { ...t, usage: event.usage } : t,
                ),
              }
            : s,
        );
        setPage((old) =>
          old && old.thread.id === event.threadId
            ? { ...old, thread: { ...old.thread, usage: event.usage } }
            : old,
        );
      }
      if (
        event.type === "threadChanged" &&
        event.threadId === threadRef.current
      ) {
        ++readGeneration.current;
        setSelectedThread(undefined);
        setPage(undefined);
        setLoading(false);
      }
      if (event.type === "agents")
        setSnapshot((s) => (s ? { ...s, agents: event.agents } : s));
      if (event.type === "activity")
        setSnapshot((s) =>
          s
            ? { ...s, activity: [event.activity, ...s.activity].slice(0, 100) }
            : s,
        );
      if (event.type === "approvals")
        setSnapshot((s) => (s ? { ...s, approvals: event.approvals } : s));
      if (event.type === "agentStatus")
        setSnapshot((s) =>
          s
            ? {
                ...s,
                host: {
                  ...s.host,
                  agentReady: event.ready,
                  agentError: event.error,
                },
              }
            : s,
        );
      if (event.type === "agentEvent") {
        const { method, params: p } = event;
        if (p.threadId !== threadRef.current) return;
        if (method === "error") {
          notify(
            p.error?.message || p.message || "The agent encountered an error.",
          );
          return;
        }
        setPage((old) =>
          old
            ? { ...old, turns: applyConversationEvent(old.turns, method, p) }
            : old,
        );
        if (method === "turn/completed")
          void invoke("thread.read", { id: p.threadId })
            .then((result) => {
              if (threadRef.current === p.threadId) setPage(result);
            })
            .catch((e) => notify(e.message));
      }
    };
    const unsubscribe = subscribe(onEvent);
    void invoke("connection.load")
      .then((result) => {
        if (result.snapshot) {
          setSnapshot(result.snapshot);
          setConnection("connected");
          setRoute(result.route || "local");
        }
      })
      .catch((e) => setConnectionError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setQuery("");
        setSettingsOpen(false);
        setSelected(undefined);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const selectNote = async (note: Note) => {
    const generation = ++noteGeneration.current;
    setSelected(note);
    setPhoneView("brain");
    setDrawer(false);
    setBody("");
    setNoteLoading(true);
    try {
      const result = await invoke("note.read", { id: note.id });
      if (generation === noteGeneration.current)
        setBody(result.body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""));
    } catch (e: any) {
      notify(e.message);
    } finally {
      if (generation === noteGeneration.current) setNoteLoading(false);
    }
  };
  const newChat = () => {
    ++readGeneration.current;
    setSelectedThread(undefined);
    setPage(undefined);
    setLoading(false);
    setChatOpen(true);
    setPhoneView("chat");
    setDrawer(false);
  };
  useEffect(() => {
    const back = () => {
      if (palette) setPalette(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (drawer) setDrawer(false);
      else if (selected) setSelected(undefined);
      else if (activityOpen) setActivityOpen(false);
      else setPhoneView("chat");
    };
    window.addEventListener("agentview:back", back);
    return () => window.removeEventListener("agentview:back", back);
  }, [palette, settingsOpen, drawer, selected, activityOpen]);
  const connected = connection === "connected";
  const g = snapshot?.graph || emptyGraph;
  const currentThread =
    page?.thread || snapshot?.threads.find((t) => t.id === selectedThread);
  const domains = [...new Set(g.nodes.map((n) => n.domain))];
  const threads = (snapshot?.threads || []).filter(
    (t) =>
      Boolean(t.archived) === archived &&
      (!projectFilter || t.projectId === projectFilter) &&
      (!sectionFilter || t.section?.id === sectionFilter) &&
      `${t.name || ""} ${t.preview} ${t.cwd}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const sections = [
    ...new Map(
      [
        ...(snapshot?.sections || []),
        ...(snapshot?.threads || []).flatMap((t) =>
          t.section ? [t.section] : [],
        ),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  const activeAgents = snapshot?.agents.filter((a) => a.active) || [];
  const connect = (code: string, address: string) => {
    setConnectionError("");
    void invoke("connection.connect", { code, address }).catch((e) => {
      setConnection("error");
      setConnectionError(e.message);
    });
  };
  return (
    <div
      className={`client-app phone-${phoneView} ${drawer ? "drawer-open" : ""} ${mobile ? "native-mobile" : ""}`}
    >
      <WindowBar />
      {!snapshot ? (
        <Connect
          state={connection}
          message={connectionError}
          onConnect={connect}
        />
      ) : (
        <>
          <header className="app-header">
            <button
              className="mobile-menu icon-button"
              aria-label={
                phoneView === "brain"
                  ? "Back to conversation"
                  : "Open conversations"
              }
              onClick={() =>
                phoneView === "brain" ? setPhoneView("chat") : setDrawer(true)
              }
            >
              {phoneView === "brain" ? (
                <ArrowLeft size={21} />
              ) : (
                <Menu size={21} />
              )}
            </button>
            <div className="brand">
              <div className="brand-mark">
                <Mark size={27} />
              </div>
              <div>
                <strong>
                  AgentView<span> / </span>
                </strong>
                <small>HARDLINE LABS</small>
              </div>
            </div>
            <div className="header-workspace">
              <span className="status-dot" />
              <span>{snapshot.host.vault}</span>
              <ChevronDown size={12} />
            </div>
            <div className="header-actions">
              <button
                className="search-trigger"
                onClick={() => setPalette(true)}
              >
                <Search size={14} />
                <span>Find anything</span>
                <kbd>Ctrl K</kbd>
              </button>
              <span className={`connection-pill ${connected ? "" : "lost"}`}>
                <Radio size={12} />
                {connected
                  ? route === "remote"
                    ? "Remote"
                    : "Local"
                  : connection === "reconnecting"
                    ? "Reconnecting"
                    : "Disconnected"}
              </span>
              <button
                className="avatar"
                title="Connection settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 size={17} />
              </button>
            </div>
          </header>
          <button
            className="mobile-live"
            onClick={() => {
              setPhoneView(phoneView === "brain" ? "chat" : "brain");
              setActivityOpen(false);
            }}
          >
            <span className={`status-dot ${connected ? "" : "offline"}`} />
            <span>
              {phoneView === "brain"
                ? "Back to conversation"
                : activeAgents.length
                  ? `${activeAgents[0].name} · ${activeAgents[0].detail || activeAgents[0].action}`
                  : "Your workspace, connected"}
            </span>
            <Network size={14} />
            <small>{phoneView === "brain" ? "Chat" : "Open brain"}</small>
            <ChevronRight size={14} />
          </button>
          {drawer && (
            <button
              className="drawer-scrim"
              aria-label="Close conversations"
              onClick={() => setDrawer(false)}
            />
          )}
          <div className={`workspace ${chatOpen ? "" : "chat-collapsed"}`}>
            <aside className="sidebar">
              <div className="drawer-title">
                <div>
                  <span className="eyebrow">YOUR WORKSPACE</span>
                  <h2>Conversations</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close conversations"
                  onClick={() => setDrawer(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <button className="new-chat" onClick={newChat}>
                <Plus size={16} /> New conversation <span>↗</span>
              </button>
              <button
                className="nav-item active"
                onClick={() => {
                  setDomain(undefined);
                  setQuery("");
                  setPhoneView("brain");
                  setDrawer(false);
                }}
              >
                <Network size={16} />
                <span>Living brain</span>
                <span className="nav-count">{g.nodes.length}</span>
              </button>
              <button
                className={`nav-item ${activityOpen ? "active-secondary" : ""}`}
                onClick={() => {
                  setActivityOpen(!activityOpen);
                  setPhoneView("brain");
                  setDrawer(false);
                }}
              >
                <ActivityIcon size={16} />
                <span>Activity</span>
                {activeAgents.length > 0 && (
                  <span className="live-count">{activeAgents.length}</span>
                )}
              </button>
              <div className="sidebar-heading">
                WORKSPACES <Layers size={12} />
              </div>
              <div className="project-list">
                {snapshot.projects.map((p) => (
                  <button
                    className="project"
                    key={p.id}
                    onClick={() => {
                      const match = domains.find(
                        (d) => p.id === d || p.id.startsWith(d),
                      );
                      setDomain(match);
                      setFilter("");
                      setProjectFilter(p.id);
                    }}
                  >
                    <Folder size={14} />
                    <span>{p.name}</span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
              <div className="sidebar-heading conversations-heading">
                CONVERSATIONS{" "}
                <button
                  title="Search conversations"
                  onClick={() => {
                    setPalette(true);
                  }}
                >
                  <Search size={12} />
                </button>
              </div>
              <div className="conversation-filters">
                <input
                  aria-label="Search conversations"
                  placeholder="Search chats…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <select
                  aria-label="Filter by project"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                >
                  <option value="">All projects</option>
                  {snapshot.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!!sections.length && (
                  <select
                    aria-label="Filter by category"
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value)}
                  >
                    <option value="">All categories</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="archive-tabs">
                  <button
                    className={!archived ? "selected" : ""}
                    onClick={() => setArchived(false)}
                  >
                    Chats
                  </button>
                  <button
                    className={archived ? "selected" : ""}
                    onClick={() => setArchived(true)}
                  >
                    Archived
                  </button>
                  <small>{threads.length}</small>
                </div>
              </div>
              <div className="thread-list">
                {threads.map((t) => (
                  <button
                    className={`thread ${selectedThread === t.id ? "selected" : ""}`}
                    key={t.id}
                    onClick={() => void readThread(t.id)}
                  >
                    <MessageSquare size={13} />
                    <div>
                      <span>
                        {t.name ||
                          t.preview.slice(0, 48) ||
                          "Untitled conversation"}
                      </span>
                      <small>
                        {t.owned ? "AgentView" : "Desktop"} ·{" "}
                        {ago(t.updatedAt * 1000)}
                        {t.projectId && (
                          <>
                            {" "}
                            ·{" "}
                            {snapshot.projects.find((p) => p.id === t.projectId)
                              ?.name || "Project"}
                          </>
                        )}
                        {t.section && <> · {t.section.name}</>}
                      </small>
                    </div>
                    {t.status.type === "active" && (
                      <span className="status-dot" />
                    )}
                  </button>
                ))}
                {!threads.length && (
                  <p className="sidebar-empty">
                    Conversations appear here
                    <br />
                    as your workspace grows.
                  </p>
                )}
              </div>
              <div className="sidebar-bottom">
                <UsageLimits limits={snapshot.limits} connected={connected} />
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setDrawer(false);
                  }}
                >
                  <Settings2 size={15} /> Workspace settings
                </button>
                <div className="host-mini">
                  <span
                    className={`status-dot ${connected ? "" : "offline"}`}
                  />
                  <div>
                    <span>{snapshot.host.name}</span>
                    <small>
                      {connected
                        ? "Your remote workspace"
                        : "Waiting for your host"}
                    </small>
                  </div>
                  <Server size={14} />
                </div>
              </div>
            </aside>
            <main className="brain-panel">
              <div className="brain-top">
                <div>
                  <div className="eyebrow">
                    <span className="mini-star">✦</span> A CONNECTED WORKSPACE
                  </div>
                  <h1>
                    Your living brain<span>.</span>
                  </h1>
                  <p>A little structure. A lot of possibility.</p>
                </div>
                <div className="brain-top-actions">
                  <button
                    className="icon-button"
                    title="Live activity"
                    onClick={() => setActivityOpen(!activityOpen)}
                  >
                    <ActivityIcon size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Graph settings"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title={chatOpen ? "Hide conversation" : "Show conversation"}
                    onClick={() => setChatOpen(!chatOpen)}
                  >
                    {chatOpen ? (
                      <PanelRightClose size={17} />
                    ) : (
                      <PanelRightOpen size={17} />
                    )}
                  </button>
                </div>
              </div>
              <div className="graph-meta">
                <span>
                  <i />
                  {g.nodes.length} notes
                </span>
                <span>{g.links.length} connections</span>
                <span className="meta-live">
                  <span
                    className={`status-dot ${connected ? "" : "offline"}`}
                  />
                  {connected ? "Live" : "Last seen"}
                </span>
              </div>
              <BrainGraph
                ref={graph}
                graph={g}
                agents={snapshot.agents}
                selected={selected?.id}
                query={query}
                domain={domain}
                motion={motion}
                labels={labels}
                onSelect={(n) => void selectNote(n)}
                onAgent={(id) => void readThread(id)}
              />
              <div className="graph-domains">
                <button
                  className={!domain ? "chosen" : ""}
                  onClick={() => setDomain(undefined)}
                >
                  All notes
                </button>
                {domains.map((d) => (
                  <button
                    key={d}
                    className={domain === d ? "chosen" : ""}
                    onClick={() => setDomain(domain === d ? undefined : d)}
                  >
                    <i style={{ background: colors[d] || colors.knowledge }} />
                    {domainLabel(d)}
                  </button>
                ))}
              </div>
              <div className="graph-bottom">
                <div className="graph-moment">
                  <div
                    className={`moment-orb ${activeAgents.length ? "busy" : ""}`}
                  />
                  <div>
                    <strong>
                      {activeAgents.length
                        ? `${activeAgents.length} ${activeAgents.length === 1 ? "agent is" : "agents are"} at work`
                        : "Room for your next idea"}
                    </strong>
                    <span>
                      {activeAgents.length
                        ? activeAgents[0].detail || activeAgents[0].action
                        : "Drag a thought. Follow a connection."}
                    </span>
                  </div>
                </div>
                <div className="graph-controls">
                  <button
                    title="Zoom out"
                    onClick={() => graph.current?.zoom(0.8)}
                  >
                    <Minus size={15} />
                  </button>
                  <button
                    title="Fit graph"
                    onClick={() => graph.current?.fit()}
                  >
                    <Expand size={15} />
                  </button>
                  <button
                    title="Zoom in"
                    onClick={() => graph.current?.zoom(1.25)}
                  >
                    <Plus size={15} />
                  </button>
                  <span />
                  <button
                    className={motion ? "enabled" : ""}
                    title={motion ? "Reduce motion" : "Enable gentle motion"}
                    onClick={() => setMotion(!motion)}
                  >
                    <Waves size={15} />
                  </button>
                </div>
              </div>
              {selected && (
                <div className="note-inspector">
                  <header>
                    <div>
                      <span
                        className="eyebrow"
                        style={{ color: colors[selected.domain] }}
                      >
                        {domainLabel(selected.domain)}
                      </span>
                      <h3>{selected.title}</h3>
                    </div>
                    <button
                      className="icon-button"
                      title="Close note"
                      onClick={() => setSelected(undefined)}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <div className="note-details">
                    <span>
                      <FileText size={12} />
                      {selected.kind}
                    </span>
                    <span>{ago(selected.modified)}</span>
                  </div>
                  <div className="note-body markdown">
                    {noteLoading ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Markdown text={body} />
                    )}
                  </div>
                  <button
                    className="attach-button"
                    onClick={() => {
                      setAttachment(selected);
                      setChatOpen(true);
                      setPhoneView("chat");
                      setDrawer(false);
                      setSelected(undefined);
                    }}
                  >
                    <Plus size={14} /> Bring into conversation
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
              {activityOpen && (
                <div className="activity-drawer">
                  <header>
                    <div>
                      <ActivityIcon size={14} /> Live activity
                    </div>
                    <button
                      className="icon-button"
                      title="Close activity"
                      onClick={() => setActivityOpen(false)}
                    >
                      <X size={15} />
                    </button>
                  </header>
                  {snapshot.activity.length ? (
                    snapshot.activity.slice(0, 20).map((a) => (
                      <button
                        className="activity-row"
                        key={a.id}
                        onClick={() => {
                          const note = g.nodes.find((n) => n.id === a.target);
                          if (note) void selectNote(note);
                          else if (a.threadId) void readThread(a.threadId);
                        }}
                      >
                        <span className="activity-dot" />
                        <div>
                          <strong>{a.action}</strong>
                          <p>{a.detail}</p>
                          <small>{ago(a.time)}</small>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="activity-empty">
                      <Waves size={25} />
                      <p>A quiet moment.</p>
                      <span>
                        Agent actions and vault changes
                        <br />
                        will appear here as they happen.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </main>
            {(chatOpen || mobile) && (
              <Chat
                onCleared={newChat}
                thread={currentThread}
                page={page}
                loading={loading}
                connected={connected}
                ready={snapshot.host.agentReady}
                models={snapshot.models}
                projects={snapshot.projects}
                approvals={snapshot.approvals}
                attachment={attachment}
                onDetach={() => setAttachment(undefined)}
                onNew={newChat}
                onSent={(id, turn) => {
                  setSelectedThread(id);
                  setPage((p) =>
                    p?.thread.id === id
                      ? {
                          ...p,
                          turns: p.turns.some((t) => t.id === turn.id)
                            ? p.turns
                            : [...p.turns, turn],
                        }
                      : p,
                  );
                  void readThread(id);
                }}
                onLoadMore={() =>
                  selectedThread && void readThread(selectedThread, true)
                }
                onError={notify}
                onHide={() => setChatOpen(false)}
              />
            )}
          </div>
          <footer className="app-footer">
            <span>
              <Mark size={12} /> Made for the way you think.
            </span>
            <span>
              {snapshot.host.agentReady
                ? "Agent connected"
                : snapshot.host.agentError || "Agent unavailable"}
              <i />
              All work stays on host
            </span>
          </footer>
        </>
      )}
      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <div
            className="settings-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                <h2>Workspace settings</h2>
              </div>
              <button
                className="icon-button"
                title="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <label className="setting-row">
              <div>
                <strong>Gentle motion</strong>
                <p>Let the brain breathe and agents orbit.</p>
              </div>
              <input
                type="checkbox"
                checked={motion}
                onChange={(e) => setMotion(e.target.checked)}
              />
            </label>
            <label className="setting-row">
              <div>
                <strong>Note labels</strong>
                <p>Show titles around the network.</p>
              </div>
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />
            </label>
            <div className="setting-row">
              <div>
                <strong>Host connection</strong>
                <p>
                  {snapshot?.host.name || "Not connected"} · {connection}
                </p>
              </div>
              <Server size={18} />
            </div>
            <p className="settings-help">
              Local connections go directly to your paired host. Remote sessions
              use its secure endpoint. Remove this device from Host to revoke
              access.
            </p>
            <button
              className="secondary full-width"
              onClick={() => {
                void invoke("connection.disconnect");
                setSnapshot(undefined);
                setSettingsOpen(false);
              }}
            >
              Disconnect & change host
            </button>
          </div>
        </div>
      )}
      {palette && (
        <div
          className="modal-backdrop palette-backdrop"
          onMouseDown={() => setPalette(false)}
        >
          <div
            className="command-palette"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette-input">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Find a note or conversation…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setPalette(false)}>esc</button>
            </div>
            <div className="palette-results">
              <div className="eyebrow">NOTES</div>
              {g.nodes
                .filter((n) =>
                  n.title.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 9)
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      void selectNote(n);
                      setPalette(false);
                      setQuery("");
                    }}
                  >
                    <FileText size={14} style={{ color: colors[n.domain] }} />
                    <span>{n.title}</span>
                    <small>{domainLabel(n.domain)}</small>
                  </button>
                ))}
              <div className="eyebrow">CONVERSATIONS</div>
              {snapshot?.threads
                .filter((t) =>
                  (t.name || t.preview)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .slice(0, 6)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      void readThread(t.id);
                      setPalette(false);
                      setQuery("");
                    }}
                  >
                    <MessageSquare size={14} />
                    <span>{t.name || t.preview.slice(0, 60)}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="alert">
          <span>{toast}</span>
          <button title="Dismiss" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export function App() {
  return role === "host" ? <HostApp /> : <ClientApp />;
}
