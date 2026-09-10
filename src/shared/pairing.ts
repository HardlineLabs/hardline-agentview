import type { Connection } from "./types";

export function remoteAddress(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a secure wss:// endpoint without credentials or query parameters.",
    );
  return url.toString();
}

export function encodeConnection(config: Connection): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  return (
    "agentview://" +
    btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")
  );
}

export function decodeConnection(code: string): Connection {
  try {
    if (code.length > 8192) throw new Error();
    const raw = atob(
      code
        .trim()
        .replace(/^agentview:\/\//, "")
        .replaceAll("-", "+")
        .replaceAll("_", "/"),
    );
    const c = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(raw, (b) => b.charCodeAt(0))),
    );
    if (c.version !== 3) throw new Error();
    remoteAddress(c.address);
    if (
      !c.address ||
      !/^[a-f0-9]{64}$/i.test(c.secret) ||
      !/^[a-f0-9-]{36}$/i.test(c.hostId) ||
      !/^[a-f0-9-]{36}$/i.test(c.credentialId) ||
      !/^[a-f0-9:]{64,95}$/i.test(c.fingerprint)
    )
      throw new Error();
    if (c.remoteAddress) remoteAddress(c.remoteAddress);
    if (c.kind !== "invite" && c.kind !== "device") throw new Error();
    return c;
  } catch {
    throw new Error(
      "Use a new pairing invitation from AgentView Host 0.3 or later.",
    );
  }
}
