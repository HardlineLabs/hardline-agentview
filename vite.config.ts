import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "pwa"
      ? [
          {
            name: "agentview-pwa-html",
            enforce: "pre" as const,
            transform(code: string, id: string) {
              // Supported PWA browsers use WOFF2. Do not precache the duplicate
              // legacy WOFF fallback supplied by the font package.
              if (id.includes("/@fontsource/") && id.endsWith(".css"))
                return code.replace(
                  /,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g,
                  "",
                );
            },
            transformIndexHtml(html: string) {
              return html
                .replace(
                  'name="theme-color" content="#0b1014"',
                  'name="theme-color" content="#05090d"',
                )
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
  // Watching extracted executables can lock directories during Windows packaging.
  server: {
    watch: {
      ignored: [
        "**/out/**",
        "**/artifacts/**",
        "**/.local/**",
        "**/dist/**",
        "**/.wrangler/**",
      ],
    },
  },
  build: { outDir: mode === "pwa" ? "dist/client" : "dist/ui" },
}));
