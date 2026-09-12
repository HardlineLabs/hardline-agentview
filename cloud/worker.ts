import { PairingRegistry, type Sql } from "../src/pairing/registry";

interface State {
  storage: { sql: Sql; setAlarm(time: number): Promise<void> };
}
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PAIRING: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}
export class PairingDirectory {
  private registry: PairingRegistry;
  constructor(private state: State) {
    this.registry = new PairingRegistry(state.storage.sql);
  }
  async fetch(request: Request) {
    const body = (await request.json()) as {
      action: string;
      body: unknown;
      caller: string;
    };
    const result = this.registry.handle(body.action, body.body, body.caller);
    // Cleanup also runs when nobody returns after an invitation expires.
    await this.state.storage.setAlarm(Date.now() + 60_000);
    return Response.json(result.body, {
      status: result.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(result.status === 429 ? { "Retry-After": "600" } : {}),
      },
    });
  }
  async alarm() {
    this.registry.prune();
    const remaining = this.state.storage.sql
      .exec("SELECT key FROM limits LIMIT 1")
      .toArray().length;
    if (remaining) await this.state.storage.setAlarm(Date.now() + 60_000);
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/pair/")) {
      // Keep old Host pairing POSTs in place; they deliberately reject redirects.
      if (url.hostname === "app.hardline-labs.com") {
        url.hostname = "agentviewapp.hardline-labs.com";
        return Response.redirect(url.href, 307);
      }
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return new Response("Origin not allowed", { status: 403 });
    if (
      !(request.headers.get("Content-Type") || "").startsWith(
        "application/json",
      )
    )
      return new Response("JSON required", { status: 415 });
    const reader = request.body?.getReader();
    let text = "";
    if (reader) {
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if ((size += value.length) > 12_000) {
          await reader.cancel();
          return new Response("Request too large", { status: 413 });
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
      if (!body || typeof body !== "object") throw new Error();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return new Response("Client address unavailable", { status: 400 });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${Math.floor(Date.now() / 86400_000)}:${ip}`),
    );
    const caller = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return env.PAIRING.get(env.PAIRING.idFromName("directory-v1")).fetch(
      new Request("https://directory/", {
        method: "POST",
        body: JSON.stringify({
          action: url.pathname.slice("/api/pair/".length),
          body,
          caller,
        }),
      }),
    );
  },
};
