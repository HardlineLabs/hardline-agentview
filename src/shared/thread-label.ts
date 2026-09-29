import type { Thread } from "./types";
export function threadLabel(
  thread?: Pick<Thread, "name" | "preview">,
  limit = 64,
) {
  const text = (
    thread?.name?.trim() ||
    thread?.preview?.split(/\r?\n/)[0]?.trim() ||
    "Untitled conversation"
  ).replace(/\s+/g, " ");
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}
export function defaultThreadName(text: string, id: string) {
  const seed = /onboard to hardline/i.test(text)
    ? "Workspace onboarding"
    : text.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  return `${(seed || "New conversation").slice(0, 56)} · ${id.replaceAll("-", "").slice(-6)}`;
}
