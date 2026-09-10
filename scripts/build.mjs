import { build } from "esbuild";
import { build as viteBuild } from "vite";
await viteBuild();
await build({
  entryPoints: ["src/electron/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/electron/main.cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/electron/preload.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/electron/preload.cjs",
  external: ["electron"],
});
