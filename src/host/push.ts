import webpush from "web-push";
import path from "node:path";
import { loadState, saveState } from "./state";

export function validateSubscription(value: any): webpush.PushSubscription {
  const url = new URL(value?.endpoint);
  const allowed = [
    "web.push.apple.com",
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "notify.windows.com",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !allowed.some(
      (host) => url.hostname === host || url.hostname.endsWith("." + host),
    )
  )
    throw new Error("Unsupported browser push service.");
  if (
    typeof value.keys?.auth !== "string" ||
    typeof value.keys?.p256dh !== "string" ||
    value.keys.auth.length > 100 ||
    value.keys.p256dh.length > 200 ||
    value.endpoint.length > 4096
  )
    throw new Error("Invalid push subscription.");
  return {
    endpoint: url.href,
    keys: { auth: value.keys.auth, p256dh: value.keys.p256dh },
  };
}
export class HostPush {
  private subscriptions: Record<string, webpush.PushSubscription> = {};
  private keys?: { publicKey: string; privateKey: string };
  constructor(private root: string) {}
  async load() {
    this.keys = await loadState(
      path.join(this.root, "push-keys.json"),
      undefined,
    );
    if (!this.keys) {
      this.keys = webpush.generateVAPIDKeys();
      await saveState(path.join(this.root, "push-keys.json"), this.keys);
    }
    this.subscriptions = await loadState(
      path.join(this.root, "push-devices.json"),
      {},
    );
  }
  status(device: string) {
    return {
      publicKey: this.keys!.publicKey,
      subscribed: Boolean(this.subscriptions[device]),
    };
  }
  async subscribe(device: string, subscription: unknown) {
    this.subscriptions[device] = validateSubscription(subscription);
    await this.save();
  }
  async remove(device: string) {
    delete this.subscriptions[device];
    await this.save();
  }
  private save() {
    return saveState(
      path.join(this.root, "push-devices.json"),
      this.subscriptions,
    );
  }
  async send(notice: { title: string; threadId?: string }) {
    await Promise.all(
      Object.entries(this.subscriptions).map(async ([device, subscription]) => {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(notice), {
            vapidDetails: {
              subject: "https://app.hardline-labs.com",
              ...this.keys!,
            },
            TTL: 3600,
            timeout: 10000,
          });
        } catch (e: any) {
          if ([404, 410].includes(e.statusCode)) await this.remove(device);
        }
      }),
    );
  }
}
