import type { AppEvent } from "../shared/types";
import { browserBridge } from "../browser/bridge";
export const browser = import.meta.env.MODE === "pwa";
export const bridge =
  window.agentview || (browser ? browserBridge() : undefined);
if (bridge && !window.agentview) window.agentview = bridge;
export const invoke = (method: string, params?: any): Promise<any> =>
  bridge
    ? bridge.invoke(method, params).catch((error: Error) => {
        throw new Error(
          error.message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          ),
        );
      })
    : Promise.reject(new Error("Open AgentView from the desktop application."));
export const subscribe = (callback: (event: AppEvent) => void) =>
  bridge?.onEvent(callback) || (() => {});
export const role = bridge?.role || "client";
export const colors: Record<string, string> = {
  company: "#a5b9fa",
  operations: "#80d6bd",
  relay: "#e6bc78",
  aegis: "#be9bfa",
  website: "#80b9dc",
  "discord-bot": "#e4a1b9",
  agentview: "#79e2d0",
  knowledge: "#adb8c6",
};
export const domainLabel = (domain: string) =>
  ({
    company: "Company",
    operations: "Operations",
    relay: "Relay",
    aegis: "Aegis",
    website: "Website",
    "discord-bot": "Discord",
    agentview: "AgentView",
    knowledge: "Knowledge",
  })[domain] || domain;
export function ago(time: number) {
  const s = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return s < 60
    ? "just now"
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : s < 86400
        ? `${Math.floor(s / 3600)}h ago`
        : `${Math.floor(s / 86400)}d ago`;
}
