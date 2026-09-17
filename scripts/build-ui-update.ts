import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  UI_BRIDGE_VERSION,
  UI_UPDATE_PUBLIC_KEY,
  type UiManifest,
} from "../src/shared/ui-update";
import { unpackUiBundle } from "../src/electron/ui-updates";

const keyPath = process.env.AGENTVIEW_UI_SIGNING_KEY;
if (!keyPath || !path.isAbsolute(keyPath))
  throw new Error(
    "Set AGENTVIEW_UI_SIGNING_KEY to the external private-key file.",
  );
const key = createPrivateKey(await readFile(keyPath));
if (
  createPublicKey(key).export({ type: "spki", format: "pem" }).toString() !==
  UI_UPDATE_PUBLIC_KEY
)
  throw new Error("Signing key does not match the desktop trust key.");
const version = process.argv[2];
if (!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version))
  throw new Error("Provide a unique UI version, for example 2026.09.17.1.");
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim()
)
  throw new Error("Commit the tested source before signing a UI publication.");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const files: { path: string; data: string }[] = [];
async function collect(directory: string, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink())
      throw new Error("UI output must not contain links.");
    if (entry.isDirectory())
      await collect(path.join(directory, entry.name), `${name}/`);
    else
      files.push({
        path: name,
        data: (await readFile(path.join(directory, entry.name))).toString(
          "base64",
        ),
      });
  }
}
await collect("dist/ui");
const bytes = gzipSync(JSON.stringify({ files }), { level: 9 });
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest: UiManifest = {
  schema: 1,
  version,
  bridge: UI_BRIDGE_VERSION,
  publishedAt: Date.now(),
  sha256,
  bytes: bytes.length,
  bundle: `${sha256}.json.gz`,
};
unpackUiBundle(bytes, manifest);
const payload = Buffer.from(JSON.stringify(manifest));
const destination = path.resolve("artifacts/ui-updates", version);
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, manifest.bundle), bytes, { flag: "wx" });
await writeFile(
  path.join(destination, "latest.json"),
  JSON.stringify({
    payload: payload.toString("base64"),
    signature: sign(null, payload, key).toString("base64"),
  }),
  { flag: "wx" },
);
await writeFile(
  path.join(destination, "publication.json"),
  JSON.stringify(
    { sourceCommit, version, sha256, bytes: bytes.length },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  `Signed UI ${version} (${bytes.length} bytes) from ${sourceCommit}: ${destination}`,
);
