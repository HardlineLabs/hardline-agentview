import { build } from "vite";
import sharp from "sharp";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const output = "dist/client";
await build({ mode: "pwa", build: { outDir: output } });
await mkdir(`${output}/icons`, { recursive: true });
for (const size of [180, 192, 512]) {
  await sharp("assets/icon.svg")
    .resize(size, size)
    .flatten({ background: "#0b1014" })
    .png()
    .toFile(`${output}/icons/icon-${size}.png`);
}
await writeFile(
  `${output}/manifest.webmanifest`,
  JSON.stringify(
    {
      id: "/",
      name: "Hardline AgentView",
      short_name: "AgentView",
      description:
        "Your conversations and living brain, connected to your own computer.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#05090d",
      theme_color: "#05090d",
      icons: [192, 512].map((size) => ({
        src: `/icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any",
      })),
    },
    null,
    2,
  ),
);
const files = (await readdir(output, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map(
    (entry) =>
      "/" +
      path
        .relative(output, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
  )
  .sort();
const hash = createHash("sha256");
hash.update(await readFile(new URL(import.meta.url)));
for (const file of files)
  hash.update(file).update(await readFile(output + file));
const version = hash.digest("hex").slice(0, 16);
// Cache the canonical page URL; static hosts redirect /index.html to /.
const assets = files.map((file) => (file === "/index.html" ? "/" : file));
await writeFile(
  `${output}/sw.js`,
  `// Generated from the complete immutable client build.
const CACHE = 'agentview-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('push', event => {
  let notice = {}; try { notice = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification('AgentView', { body: notice.title || 'Your workspace has an update', icon: '/icons/icon-192.png', tag: notice.threadId || 'agentview', data: { threadId: notice.threadId } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.threadId;
  const url = new URL(id ? '/#thread=' + encodeURIComponent(id) : '/', self.location.origin).href;
  event.waitUntil((async () => { const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const client of clients) { if (new URL(client.url).origin === self.location.origin) { await client.navigate(url); return client.focus(); } } return self.clients.openWindow(url); })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Keep the preceding build available to tabs that have not opted into reloading.
  const keys = (await caches.keys()).filter(key => key.startsWith('agentview-'));
  await Promise.all(keys.filter(key => key !== CACHE).slice(0, -1).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only application files enter the cache. Workspace data travels over encrypted WSS.
  const asset = event.request.mode === 'navigate' ? '/' : url.pathname;
  if (!ASSETS.includes(asset)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(asset)) || fetch(event.request)));
});
`,
);
await writeFile(
  `${output}/_headers`,
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Content-Security-Policy: frame-ancestors 'none'
/
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log(`PWA ${version}: ${files.length} public assets in ${output}`);
