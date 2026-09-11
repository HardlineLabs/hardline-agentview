// Device-local storage. A non-exportable browser key is not an OS keychain:
// scripts running on this origin can still use it. Never store workspace snapshots.
type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("agentview-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("private");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = undefined;
      reject(
        new Error(
          "Device storage is unavailable. Allow website storage, then try again.",
        ),
      );
    };
  }));
}
async function read<T>(name: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("private").objectStore("private").get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function write(name: string, value?: unknown) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("private", "readwrite");
    const store = tx.objectStore("private");
    if (value === undefined) store.delete(name);
    else store.put(value, name);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          "Could not save this device. Check available storage and try pairing again.",
        ),
      );
  });
}
let keyPromise: Promise<CryptoKey> | undefined;
function key() {
  return (keyPromise ||= (async () => {
    const existing = await read<CryptoKey>("key");
    if (existing) return existing;
    const candidate = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    // Other tabs may initialize simultaneously. Select/create the key atomically.
    const db = await database();
    return new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction("private", "readwrite");
      const store = tx.objectStore("private");
      const request = store.get("key");
      let selected = candidate;
      request.onsuccess = () => {
        selected = request.result || candidate;
        if (!request.result) store.put(selected, "key");
      };
      tx.oncomplete = () => resolve(selected);
      tx.onabort = tx.onerror = () =>
        reject(new Error("Could not create device storage."));
    });
  })().catch((error) => {
    keyPromise = undefined;
    throw error;
  }));
}
export async function savePrivate(
  name: "connection" | "resume",
  value: unknown,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  await write(name, { iv, data });
}
export async function loadPrivate<T>(
  name: "connection" | "resume",
): Promise<T | undefined> {
  const sealed = await read<Sealed>(name);
  if (!sealed) return;
  try {
    const data = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: sealed.iv,
        additionalData: new TextEncoder().encode(name),
      },
      await key(),
      sealed.data,
    );
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    await write(name);
    throw new Error(
      "Saved device data could not be opened. Pair again from Host.",
    );
  }
}
export const removePrivate = (name: "connection" | "resume") => write(name);
