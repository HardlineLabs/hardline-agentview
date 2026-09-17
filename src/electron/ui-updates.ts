import { createHash, verify, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  UI_BRIDGE_VERSION,
  UI_UPDATE_PUBLIC_KEY,
  UI_UPDATE_URL,
  type SignedUiManifest,
  type UiManifest,
} from "../shared/ui-update";

const MAX_BUNDLE = 32 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
type Selection = {
  active?: string;
  previous?: string;
  pending?: boolean;
  newest?: number;
};

export function verifyUiManifest(
  envelope: SignedUiManifest,
  key = UI_UPDATE_PUBLIC_KEY,
): UiManifest {
  if (
    typeof envelope?.payload !== "string" ||
    typeof envelope.signature !== "string"
  )
    throw new Error("Invalid UI update manifest.");
  const bytes = Buffer.from(envelope.payload, "base64");
  if (!verify(null, bytes, key, Buffer.from(envelope.signature, "base64")))
    throw new Error("UI update signature is not trusted.");
  const manifest = JSON.parse(bytes.toString("utf8")) as UiManifest;
  if (
    manifest.schema !== 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.version) ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 1 ||
    manifest.bytes > MAX_BUNDLE ||
    !Number.isSafeInteger(manifest.publishedAt) ||
    manifest.publishedAt < 1 ||
    manifest.bundle !== `${manifest.sha256}.json.gz`
  )
    throw new Error("Invalid UI update manifest.");
  if (manifest.bridge !== UI_BRIDGE_VERSION)
    throw new Error(
      "This UI needs a newer desktop app. Update AgentView.exe first.",
    );
  return manifest;
}

export function unpackUiBundle(
  bytes: Buffer,
  manifest: UiManifest,
): Map<string, Buffer> {
  if (bytes.length !== manifest.bytes || digest(bytes) !== manifest.sha256)
    throw new Error("UI download checksum does not match.");
  const bundle = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED }).toString("utf8"),
  );
  if (!Array.isArray(bundle.files) || bundle.files.length > 500)
    throw new Error("Invalid UI bundle.");
  const files = new Map<string, Buffer>();
  const names = new Set<string>();
  let total = 0;
  for (const file of bundle.files) {
    // Only the renderer output can be installed, never native code or arbitrary paths.
    if (
      typeof file.path !== "string" ||
      !/^(index\.html|assets\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(js|css|woff2?|png|svg|webp|jpg))$/.test(
        file.path,
      ) ||
      names.has(file.path.toLowerCase()) ||
      typeof file.data !== "string" ||
      file.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
    )
      throw new Error("Unsafe UI bundle file.");
    const data = Buffer.from(file.data, "base64");
    total += data.length;
    if (total > MAX_EXPANDED) throw new Error("UI bundle is too large.");
    files.set(file.path, data);
    names.add(file.path.toLowerCase());
  }
  if (!files.has("index.html")) throw new Error("UI bundle has no entry page.");
  return files;
}

async function download(url: string, limit: number, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new Error(`UI update download failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("UI download is too large.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("UI download is too large.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}

export class UiUpdates {
  private selection: Selection = {};
  private busy = false;
  private staged?: string;
  message = "";
  constructor(
    private root: string,
    readonly bundledEntry: string,
    private options: {
      key?: string;
      url?: string;
      fetcher?: typeof fetch;
    } = {},
  ) {}

  get pending() {
    return Boolean(this.selection.pending);
  }
  get entry() {
    return this.selection.active
      ? path.join(this.root, this.selection.active, "index.html")
      : this.bundledEntry;
  }

  private async save() {
    const temporary = path.join(this.root, "selection.tmp");
    await fs.writeFile(temporary, JSON.stringify(this.selection));
    await fs.rename(temporary, path.join(this.root, "selection.json"));
  }

  private async cached(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new Error("Invalid cached UI identifier.");
    const folder = path.join(this.root, id);
    const envelope = JSON.parse(
      await fs.readFile(path.join(folder, "manifest.json"), "utf8"),
    );
    const manifest = verifyUiManifest(envelope, this.options.key);
    if (manifest.sha256 !== id)
      throw new Error("Cached UI identifier mismatch.");
    const files = unpackUiBundle(
      await fs.readFile(path.join(folder, "bundle.json.gz")),
      manifest,
    );
    for (const [name, bytes] of files) {
      if (!(await fs.readFile(path.join(folder, name))).equals(bytes))
        throw new Error("Cached UI was modified.");
    }
    return manifest;
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      this.selection = JSON.parse(
        await fs.readFile(path.join(this.root, "selection.json"), "utf8"),
      );
    } catch {
      this.selection = {};
    }
    if (!this.selection || typeof this.selection !== "object")
      this.selection = {};
    if (this.selection.pending)
      await this.rollback(
        "The previous update did not finish starting. Restored the working UI.",
      );
    if (this.selection.active) {
      try {
        await this.cached(this.selection.active);
      } catch {
        await this.rollback(
          "The saved UI could not be verified. Restored the working UI.",
        );
      }
    }
    await this.cleanup();
  }

  async status(shellVersion: string) {
    const version = this.selection.active
      ? (await this.cached(this.selection.active)).version
      : "bundled";
    return { version, shellVersion, message: this.message };
  }

  async stage() {
    if (this.busy || this.pending)
      throw new Error("A UI update is already in progress.");
    this.busy = true;
    try {
      const url = this.options.url || UI_UPDATE_URL;
      const fetcher = this.options.fetcher || fetch;
      const envelope = JSON.parse(
        (await download(url, 16384, fetcher)).toString("utf8"),
      );
      const manifest = verifyUiManifest(envelope, this.options.key);
      if (manifest.sha256 === this.selection.active)
        return { available: false };
      if (manifest.publishedAt < (this.selection.newest || 0))
        throw new Error(
          "The published UI is older than this client's update history.",
        );
      const bytes = await download(
        new URL(manifest.bundle, url).href,
        manifest.bytes,
        fetcher,
      );
      const files = unpackUiBundle(bytes, manifest);
      const temporary = path.join(this.root, `staging-${randomUUID()}`);
      const destination = path.join(this.root, manifest.sha256);
      await fs.mkdir(path.join(temporary, "assets"), { recursive: true });
      try {
        for (const [name, data] of files)
          await fs.writeFile(path.join(temporary, name), data);
        await fs.writeFile(
          path.join(temporary, "manifest.json"),
          JSON.stringify(envelope),
        );
        await fs.writeFile(path.join(temporary, "bundle.json.gz"), bytes);
        // A previously downloaded identical version is safe to reuse only after verification.
        try {
          await this.cached(manifest.sha256);
          await fs.writeFile(
            path.join(destination, "manifest.json"),
            JSON.stringify(envelope),
          );
        } catch {
          await fs.rm(destination, { recursive: true, force: true });
          await fs.rename(temporary, destination);
        }
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
      this.staged = manifest.sha256;
      return { available: true, version: manifest.version };
    } finally {
      this.busy = false;
    }
  }

  async activate() {
    if (!this.staged || this.busy || this.pending)
      throw new Error("No verified UI is ready to apply.");
    const manifest = await this.cached(this.staged);
    const previous = this.selection;
    this.selection = {
      active: this.staged,
      previous: this.selection.active,
      pending: true,
      newest: Math.max(this.selection.newest || 0, manifest.publishedAt),
    };
    try {
      await this.save();
    } catch (error) {
      this.selection = previous;
      throw error;
    }
    this.staged = undefined;
  }

  async ready() {
    if (!this.pending) return;
    this.selection.pending = false;
    this.message = "UI updated.";
    await this.save();
    await this.cleanup();
  }

  async rollback(message: string) {
    let active = this.selection.previous;
    if (active) {
      try {
        await this.cached(active);
      } catch {
        active = undefined;
      }
    }
    this.selection = { active, newest: this.selection.newest };
    this.message = message;
    await this.save();
  }

  private async cleanup() {
    for (const name of await fs.readdir(this.root)) {
      if (
        (/^[a-f0-9]{64}$/.test(name) || /^staging-[a-f0-9-]+$/.test(name)) &&
        name !== this.selection.active &&
        name !== this.selection.previous
      )
        await fs.rm(path.join(this.root, name), {
          recursive: true,
          force: true,
        });
    }
  }
}
