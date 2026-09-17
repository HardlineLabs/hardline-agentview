import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target || !path.isAbsolute(target))
  throw new Error(
    "Provide an absolute private-key path outside the repository.",
  );
const relative = path.relative(process.cwd(), target);
if (!relative.startsWith("..") && !path.isAbsolute(relative))
  throw new Error("Keep the signing key outside the repository.");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, privateKey.export({ type: "pkcs8", format: "pem" }), {
  flag: "wx",
  mode: 0o600,
});
console.log(publicKey.export({ type: "spki", format: "pem" }));
