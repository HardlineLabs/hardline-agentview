import { decodeConnection, encodeConnection } from "../shared/pairing";

type Value = string | number | null;
export interface Sql {
  exec<T = Record<string, Value>>(
    query: string,
    ...values: Value[]
  ): { toArray(): T[] };
}
type Entry = {
  code: string;
  invitation: string;
  token: string;
  expires: number;
  claim: string | null;
};
export class PairingRegistry {
  constructor(private sql: Sql) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS invitations (code TEXT PRIMARY KEY, invitation TEXT, token TEXT UNIQUE, expires INTEGER, claim TEXT)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER, expires INTEGER)",
    );
  }
  prune(now = Date.now()) {
    this.sql.exec("DELETE FROM invitations WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM limits WHERE expires <= ?", now);
  }
  private limit(key: string, maximum: number, duration: number, now: number) {
    const row = this.sql
      .exec<{ count: number }>("SELECT count FROM limits WHERE key = ?", key)
      .toArray()[0];
    if (row && row.count >= maximum) return false;
    this.sql.exec(
      "INSERT INTO limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
      key,
      now + duration,
    );
    return true;
  }
  handle(action: string, body: any, caller: string, now = Date.now()) {
    this.prune(now);
    const error = (status: number, message: string) => ({
      status,
      body: { error: message },
    });
    if (!["publish", "claim", "cancel"].includes(action))
      return error(404, "Unknown pairing action.");
    // Global ceilings also bound distributed guessing and the number of IP buckets.
    if (
      !this.limit(
        `global:${action}`,
        action === "cancel" ? 60 : 30,
        60_000,
        now,
      ) ||
      !this.limit(
        `${action}:${caller}`,
        action === "claim" ? 10 : 5,
        10 * 60_000,
        now,
      )
    )
      return error(
        429,
        "Too many pairing attempts. Wait a few minutes before trying again.",
      );
    if (action === "cancel") {
      if (typeof body.token === "string" && /^[a-f0-9]{64}$/.test(body.token))
        this.sql.exec("DELETE FROM invitations WHERE token = ?", body.token);
      return { status: 200, body: {} };
    }
    if (action === "claim") {
      if (
        !/^\d{6}$/.test(body.code) ||
        typeof body.claimId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.claimId)
      )
        return error(400, "Enter the six-digit code shown in Host.");
      const entry = this.sql
        .exec<Entry>("SELECT * FROM invitations WHERE code = ?", body.code)
        .toArray()[0];
      if (!entry || (entry.claim && entry.claim !== body.claimId))
        return error(
          404,
          "Code expired, already used or not found. Create a new code in Host.",
        );
      this.sql.exec(
        "UPDATE invitations SET claim = ? WHERE code = ?",
        body.claimId,
        body.code,
      );
      return {
        status: 200,
        body: { invitation: entry.invitation, expiresAt: entry.expires },
      };
    }
    try {
      const config = decodeConnection(body.invitation);
      if (
        config.kind !== "invite" ||
        !config.remoteAddress ||
        !/^[a-f0-9]{64}$/.test(body.token) ||
        !Number.isSafeInteger(body.expiresAt) ||
        body.expiresAt <= now ||
        body.expiresAt > now + 5 * 60_000
      )
        return error(400, "Create a fresh remote invitation in Host.");
      const remote = new URL(config.remoteAddress);
      if (
        !remote.hostname.includes(".") ||
        remote.hostname.endsWith(".local") ||
        remote.hostname.endsWith(".localhost") ||
        /^[\d.]+$/.test(remote.hostname) ||
        remote.hostname.includes(":")
      )
        return error(
          400,
          "Use a publicly reachable host name for remote pairing.",
        );
      const existing = this.sql
        .exec<Entry>("SELECT * FROM invitations WHERE token = ?", body.token)
        .toArray()[0];
      if (existing)
        return {
          status: 200,
          body: { code: existing.code, expiresAt: existing.expires },
        };
      const count = this.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM invitations")
        .toArray()[0].count;
      if (count >= 100)
        return error(503, "Pairing is busy. Try again in a few minutes.");
      // Rejection sampling keeps all one million codes equally likely, including leading zeroes.
      let code: string;
      do {
        let value: number;
        do {
          value = crypto.getRandomValues(new Uint32Array(1))[0];
        } while (value >= 4_294_000_000);
        code = (value % 1_000_000).toString().padStart(6, "0");
      } while (
        this.sql
          .exec("SELECT code FROM invitations WHERE code = ?", code)
          .toArray().length
      );
      // The directory needs only the public route, never the host's LAN address.
      const invitation = encodeConnection({
        ...config,
        address: config.remoteAddress,
        routePreference: "remote",
      });
      this.sql.exec(
        "INSERT INTO invitations VALUES (?, ?, ?, ?, NULL)",
        code,
        invitation,
        body.token,
        body.expiresAt,
      );
      return { status: 200, body: { code, expiresAt: body.expiresAt } };
    } catch {
      return error(400, "Invalid pairing invitation.");
    }
  }
}
