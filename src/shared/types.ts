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
  path?: string;
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
  archived?: boolean;
  section?: { id: string; name: string } | null;
  usage?: TokenUsage;
};
export type TokenUsage = {
  total: { totalTokens: number };
  last: { totalTokens: number };
  modelContextWindow: number | null;
};
export type RateLimit = {
  limitId?: string | null;
  limitName?: string | null;
  primary?: {
    usedPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
  } | null;
  secondary?: RateLimit["primary"];
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string | null;
  } | null;
};
export type AccountLimits = {
  buckets: RateLimit[];
  checkedAt: number;
  error?: string;
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
export type Project = {
  id: string;
  name: string;
  path: string;
  runtime?: boolean;
};
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
  capabilities?: { apiVersion: number; hostVersion: string };
  preferences?: {
    defaultPermissions: "full" | "workspace" | "read-only";
    onboarding: string;
  };
  graph: Graph;
  threads: Thread[];
  projects: Project[];
  agents: Agent[];
  activity: Activity[];
  approvals: Approval[];
  models: Model[];
  limits?: AccountLimits;
  sections?: { id: string; name: string }[];
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
  remoteAddress?: string;
  cloudflaredPath?: string;
  tunnelConfig?: string;
};
export type HostStatus = {
  running: boolean;
  error?: string;
  settings: HostSettings;
  addresses: string[];
  pairingCode: string;
  remoteStatus?: string;
  devices?: PairedDevice[];
  clients: number;
  notes: number;
  agentReady: boolean;
  agentError?: string;
};
export type Connection = {
  version: 3;
  hostId: string;
  credentialId: string;
  secret: string;
  kind: "invite" | "device";
  address: string;
  fingerprint: string;
  remoteAddress?: string;
  routePreference?: "auto" | "local" | "remote";
};
export type PairedDevice = { id: string; name: string; createdAt: number };
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
