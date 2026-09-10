export type Note = {
  id: string;
  title: string;
  domain: string;
  kind: string;
  status: string;
  modified: number;
  size: number;
};
export type Graph = {
  nodes: Note[];
  links: { source: string; target: string }[];
  revision: number;
};
export type Agent = {
  id: string;
  name: string;
  parentId?: string;
  threadId: string;
  action: string;
  target?: string;
  detail?: string;
  updated: number;
  active: boolean;
};
export type Activity = {
  id: string;
  agentId?: string;
  threadId?: string;
  action: string;
  target?: string;
  detail: string;
  time: number;
};
export type Thread = {
  id: string;
  name?: string | null;
  preview: string;
  cwd: string;
  updatedAt: number;
  createdAt: number;
  projectId?: string;
  model?: string;
  reasoningEffort?: string;
  parentThreadId?: string;
  agentNickname?: string;
  source?: unknown;
  status: { type: string };
  owned?: boolean;
};
export type ChatItem = {
  id: string;
  type: string;
  text?: string;
  content?: { type: string; text?: string }[];
  command?: string;
  status?: string;
  aggregatedOutput?: string;
  changes?: { path: string; diff?: string }[];
  [key: string]: unknown;
};
export type Turn = {
  id: string;
  status: string;
  items: ChatItem[];
  error?: { message: string };
};
export type ChatPage = {
  thread: Thread;
  turns: Turn[];
  nextCursor: string | null;
};
export type Project = { id: string; name: string; path: string };
export type Model = {
  id: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
};
export type Approval = {
  id: string | number;
  method: string;
  params: Record<string, any>;
};
export type Snapshot = {
  graph: Graph;
  threads: Thread[];
  projects: Project[];
  agents: Agent[];
  activity: Activity[];
  approvals: Approval[];
  models: Model[];
  host: {
    name: string;
    vault: string;
    agentReady: boolean;
    agentError?: string;
    connectedAt: number;
  };
};
export type HostSettings = {
  vaultPath: string;
  codexPath: string;
  port: number;
  autoStart: boolean;
};
export type HostStatus = {
  running: boolean;
  error?: string;
  settings: HostSettings;
  addresses: string[];
  pairingCode: string;
  clients: number;
  notes: number;
  agentReady: boolean;
  agentError?: string;
};
export type Connection = {
  address: string;
  token: string;
  fingerprint: string;
};
export type AppEvent = { type: string; [key: string]: any };
export type DesktopBridge = {
  role: "host" | "client";
  invoke(method: string, params?: any): Promise<any>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  window(action: "minimize" | "maximize" | "close"): void;
};
declare global {
  interface Window {
    agentview?: DesktopBridge;
  }
}
