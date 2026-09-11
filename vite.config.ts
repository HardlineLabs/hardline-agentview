import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "pwa"
      ? [
          {
            name: "agentview-pwa-html",
            transformIndexHtml(html: string) {
              return html
                .replace("img-src 'self' data:", "img-src 'self' data: blob:")
                .replace("connect-src 'self'", "connect-src 'self' wss:")
                .replace(
                  "object-src 'none'",
                  "worker-src 'self'; object-src 'none'",
                )
                .replace(
                  "<title>AgentView</title>",
                  `<meta name="description" content="Your conversations and living brain, connected to your own computer." />
    <meta name="referrer" content="no-referrer" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/icon-180.png" />
    <link rel="icon" href="/icons/icon-192.png" />
    <title>Hardline AgentView</title>`,
                );
            },
          },
        ]
      : []),
  ],
  base: mode === "pwa" ? "/" : "./",
  build: { outDir: mode === "pwa" ? "dist/client" : "dist/ui" },
}));
