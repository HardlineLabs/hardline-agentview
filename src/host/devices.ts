import { randomUUID, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Connection, PairedDevice } from "../shared/types";

type Credential = PairedDevice & { secret: string; expiresAt?: number };
export class Devices {
  hostId = randomUUID();
  private credentials: Credential[] = [];
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async load() {
    try {
      const stored = JSON.parse(
        await fs.readFile(path.join(this.directory, "devices.json"), "utf8"),
      );
      this.hostId = stored.hostId;
      this.credentials = stored.credentials;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      await this.save();
    }
  }
  private save() {
    const data = JSON.stringify(
      { hostId: this.hostId, credentials: this.credentials },
      null,
      2,
    );
    const write = this.writes.then(async () => {
      const target = path.join(this.directory, "devices.json");
      await fs.writeFile(target + ".tmp", data, { mode: 0o600 });
      await fs.rename(target + ".tmp", target);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  list(): PairedDevice[] {
    return this.credentials
      .filter((c) => !c.expiresAt)
      .map(({ secret: _secret, ...c }) => c);
  }
  lookup(id: string) {
    return this.credentials.find(
      (c) => c.id === id && (!c.expiresAt || c.expiresAt > Date.now()),
    );
  }
  async invite(name: string) {
    this.credentials = this.credentials.filter((c) => !c.expiresAt);
    if (this.credentials.length >= 100)
      throw new Error("Remove an unused device before pairing another.");
    const c: Credential = {
      id: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      name: name.trim().slice(0, 60) || "New device",
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.credentials.push(c);
    await this.save();
    return c;
  }
  async authorize(
    id: string,
  ): Promise<{ device: Credential; paired: boolean }> {
    const c = this.lookup(id);
    if (!c)
      throw new Error("Device access was removed or the invitation expired.");
    if (!c.expiresAt) return { device: c, paired: false };
    // Consume synchronously so concurrent handshakes cannot redeem the same invitation.
    this.credentials = this.credentials.filter((other) => other.id !== id);
    const device: Credential = {
      id: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      name: c.name,
      createdAt: Date.now(),
    };
    this.credentials.push(device);
    await this.save();
    return { device, paired: true };
  }
  async revoke(id: string) {
    this.credentials = this.credentials.filter((c) => c.id !== id);
    await this.save();
  }
  connection(
    c: Credential,
    address: string,
    fingerprint: string,
    remoteAddress?: string,
  ): Connection {
    return {
      version: 3,
      hostId: this.hostId,
      credentialId: c.id,
      secret: c.secret,
      kind: c.expiresAt ? "invite" : "device",
      address,
      fingerprint,
      ...(remoteAddress ? { remoteAddress } : {}),
    };
  }
}
