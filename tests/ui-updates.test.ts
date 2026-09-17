import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import {
  UiUpdates,
  verifyUiManifest,
  unpackUiBundle,
} from "../src/electron/ui-updates";
import type { UiManifest } from "../src/shared/ui-update";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = publicKey.export({ type: "spki", format: "pem" }).toString();
function release(
  version: string,
  publishedAt: number,
  files = [
    { path: "index.html", data: Buffer.from(version).toString("base64") },
  ],
  bridge = 1,
) {
  const bytes = gzipSync(JSON.stringify({ files }));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest: UiManifest = {
    schema: 1,
    version,
    publishedAt,
    bridge,
    sha256,
    bytes: bytes.length,
    bundle: `${sha256}.json.gz`,
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  return {
    manifest,
    bytes,
    envelope: {
      payload: payload.toString("base64"),
      signature: sign(null, payload, privateKey).toString("base64"),
    },
  };
}
test("UI update rejects forged manifests, incompatible bridges, corrupt bundles and unsafe paths", () => {
  const valid = release("one", 1);
  assert.equal(verifyUiManifest(valid.envelope, key).version, "one");
  assert.throws(
    () =>
      verifyUiManifest(
        { ...valid.envelope, signature: Buffer.alloc(64).toString("base64") },
        key,
      ),
    /signature/,
  );
  assert.throws(
    () => verifyUiManifest(release("future", 2, undefined, 2).envelope, key),
    /newer desktop/,
  );
  assert.throws(
    () => unpackUiBundle(Buffer.from("bad"), valid.manifest),
    /checksum/,
  );
  for (const name of [
    "../main.cjs",
    "assets/../../escape.js",
    "assets\\escape.js",
    "assets/a.js:evil",
    "/index.html",
    "assets/main.cjs",
  ]) {
    const unsafe = release("unsafe", 1, [{ path: name, data: "" }]);
    assert.throws(
      () => unpackUiBundle(unsafe.bytes, unsafe.manifest),
      /Unsafe/,
    );
  }
  const duplicate = release("duplicate", 1, [
    { path: "index.html", data: "" },
    { path: "index.html", data: "" },
  ]);
  assert.throws(
    () => unpackUiBundle(duplicate.bytes, duplicate.manifest),
    /Unsafe/,
  );
});

test("UI updates stage atomically, survive offline restart and recover interrupted/modified updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-ui-test-"));
  let current = release("one", 1);
  let offline = false;
  const fetcher: typeof fetch = async (input) => {
    if (offline) throw new Error("offline");
    return new Response(
      String(input).endsWith("latest.json")
        ? JSON.stringify(current.envelope)
        : new Uint8Array(current.bytes),
    );
  };
  const make = () =>
    new UiUpdates(root, "bundled/index.html", { key, fetcher });
  try {
    const updater = make();
    await updater.initialize();
    assert.equal(updater.entry, "bundled/index.html");
    assert.equal((await updater.stage()).available, true);
    assert.equal(updater.entry, "bundled/index.html");
    await updater.activate();
    assert.equal(updater.pending, true);
    assert.equal(await readFile(updater.entry, "utf8"), "one");
    await updater.ready();
    assert.equal((await updater.stage()).available, false);
    offline = true;
    const restart = make();
    await restart.initialize();
    assert.equal(await readFile(restart.entry, "utf8"), "one");
    await assert.rejects(restart.stage(), /offline/);
    offline = false;
    current = release("two", 2);
    await restart.stage();
    await restart.activate();
    // Simulate process exit before the renderer acknowledges startup.
    const interrupted = make();
    await interrupted.initialize();
    assert.equal(await readFile(interrupted.entry, "utf8"), "one");
    assert.match(interrupted.message, /did not finish/);
    await interrupted.stage();
    await interrupted.activate();
    await interrupted.ready();
    await writeFile(interrupted.entry, "modified");
    const tampered = make();
    await tampered.initialize();
    assert.equal(await readFile(tampered.entry, "utf8"), "one");
    current = release("old", 1);
    await assert.rejects(tampered.stage(), /older/);
    await writeFile(tampered.entry, "modified too");
    const fallback = make();
    await fallback.initialize();
    assert.equal(fallback.entry, "bundled/index.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Failed or oversized downloads preserve the running UI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentview-ui-bad-"));
  const valid = release("one", 1);
  let manifest = true;
  const fetcher: typeof fetch = async () =>
    manifest
      ? ((manifest = false), new Response(JSON.stringify(valid.envelope)))
      : new Response(new Uint8Array(valid.bytes.length + 1));
  try {
    const updater = new UiUpdates(root, "bundled", { key, fetcher });
    await updater.initialize();
    await assert.rejects(updater.stage(), /too large/);
    assert.equal(updater.entry, "bundled");
    await assert.rejects(updater.activate(), /No verified/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
