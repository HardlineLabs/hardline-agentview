// Versioned authenticated ECDH sessions. Web Crypto owns all cryptographic primitives.
// The out-of-band 256-bit pairing secret authenticates ephemeral keys; it never travels.
const utf8 = new TextEncoder();
const text = new TextDecoder();
export const hex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(value instanceof Uint8Array ? value : new Uint8Array(value), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length % 2 ||
    !/^[0-9a-f]+$/i.test(value)
  )
    throw new Error("Invalid secure frame.");
  return Uint8Array.from(value.match(/../g)!, (b) => parseInt(b, 16));
}
export const nonce = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function ephemeral() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return {
    privateKey: keys.privateKey,
    publicKey: hex(await crypto.subtle.exportKey("raw", keys.publicKey)),
  };
}
export type Hello = {
  type: "hello";
  version: 3;
  hostId: string;
  credentialId: string;
  nonce: string;
  publicKey: string;
};
export type Challenge = {
  type: "challenge";
  nonce: string;
  publicKey: string;
  proof: string;
};
export async function session(
  secret: string,
  privateKey: CryptoKey,
  peer: string,
  hello: Hello,
  challenge: Pick<Challenge, "nonce" | "publicKey">,
  server: boolean,
) {
  if (
    !/^[a-f0-9]{64}$/i.test(hello.nonce) ||
    !/^[a-f0-9]{64}$/i.test(challenge.nonce) ||
    peer.length !== 130
  )
    throw new Error("Invalid handshake.");
  const publicKey = await crypto.subtle.importKey(
    "raw",
    unhex(peer),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  const transcript = JSON.stringify([
    "AgentView/3",
    hello.hostId,
    hello.credentialId,
    hello.nonce,
    hello.publicKey,
    challenge.nonce,
    challenge.publicKey,
  ]);
  const derive = (
    purpose: string,
    algorithm: AesKeyGenParams | HmacKeyGenParams,
    usages: KeyUsage[],
  ) =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: unhex(secret),
        info: utf8.encode(transcript + "/" + purpose),
      },
      material,
      algorithm,
      false,
      usages,
    );
  const auth = await derive(
    "proof",
    { name: "HMAC", hash: "SHA-256", length: 256 },
    ["sign", "verify"],
  );
  const send = await derive(
    server ? "server-data" : "client-data",
    { name: "AES-GCM", length: 256 },
    ["encrypt"],
  );
  const receive = await derive(
    server ? "client-data" : "server-data",
    { name: "AES-GCM", length: 256 },
    ["decrypt"],
  );
  let sent = 0,
    received = 0;
  const iv = (n: number) => {
    const b = new Uint8Array(12);
    new DataView(b.buffer).setBigUint64(4, BigInt(n));
    return b;
  };
  return {
    proof: async (role: "host" | "client") =>
      hex(await crypto.subtle.sign("HMAC", auth, utf8.encode(role))),
    verify: async (role: "host" | "client", proof: string) =>
      crypto.subtle.verify("HMAC", auth, unhex(proof), utf8.encode(role)),
    async encrypt(value: unknown) {
      const sequence = sent++;
      if (!Number.isSafeInteger(sequence)) throw new Error("Session expired.");
      const data = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv(sequence),
          additionalData: utf8.encode("AgentView/3"),
        },
        send,
        utf8.encode(JSON.stringify(value)),
      );
      return JSON.stringify({ type: "sealed", sequence, data: hex(data) });
    },
    async decrypt(frame: any) {
      if (
        frame.type !== "sealed" ||
        frame.sequence !== received ||
        typeof frame.data !== "string" ||
        frame.data.length > 64_000_000
      )
        throw new Error("Invalid or replayed secure frame.");
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv(received),
          additionalData: utf8.encode("AgentView/3"),
        },
        receive,
        unhex(frame.data),
      );
      received++;
      return JSON.parse(text.decode(bytes));
    },
  };
}
export type SecureSession = Awaited<ReturnType<typeof session>>;
