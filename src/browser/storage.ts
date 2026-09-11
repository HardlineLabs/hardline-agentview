// Device-local storage. A non-exportable browser key is not an OS keychain:
// scripts running on this origin can still use it. Never store workspace snapshots.
type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };
type PrivateName =
  "connection" | "resume" | "drafts" | "pairingProbe" | "pairingClaim";
function deadline(tx: IDBTransaction, reject: (error: Error) => void) {
  const timer = setTimeout(() => {
    try {
      tx.abort();
    } catch {
      /* It may have finished as the timer fired. */
    }
    reject(
      new Error(
        "Device storage did not respond. Close other AgentView tabs and try again.",
      ),
    );
  }, 8000);
  return () => clearTimeout(timer);
}
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("agentview-device", 1);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opening = undefined;
      reject(
        new Error(
          "Device storage is unavailable. Close other AgentView tabs, allow website storage, then try again.",
        ),
      );
    };
    const timer = setTimeout(fail, 8000);
    request.onblocked = fail;
    request.onupgradeneeded = () => request.result.createObjectStore("private");
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = fail;
  }));
}
async function read<T>(name: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("private");
    const done = deadline(tx, reject);
    const request = tx.objectStore("private").get(name);
    request.onsuccess = () => {
      done();
      resolve(request.result);
    };
    request.onerror = () => {
      done();
      reject(request.error);
    };
  });
}
async function write(name: string, value?: unknown) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("private", "readwrite");
    const done = deadline(tx, reject);
    const store = tx.objectStore("private");
    if (value === undefined) store.delete(name);
    else store.put(value, name);
    tx.oncomplete = () => {
      done();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      done();
      reject(
        new Error(
          "Could not save this device. Check available storage and try pairing again.",
        ),
      );
    };
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
      const done = deadline(tx, reject);
      const store = tx.objectStore("private");
      const request = store.get("key");
      let selected = candidate;
      request.onsuccess = () => {
        selected = request.result || candidate;
        if (!request.result) store.put(selected, "key");
      };
      tx.oncomplete = () => {
        done();
        resolve(selected);
      };
      tx.onabort = tx.onerror = () => {
        done();
        reject(new Error("Could not create device storage."));
      };
    });
  })().catch((error) => {
    keyPromise = undefined;
    throw error;
  }));
}
export async function savePrivate(name: PrivateName, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  await write(name, { iv, data });
}
export async function loadPrivate<T>(
  name: PrivateName,
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
export const removePrivate = (name: PrivateName) => write(name);
