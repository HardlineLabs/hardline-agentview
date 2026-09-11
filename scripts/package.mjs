import { build, Platform } from "electron-builder";
import "./icon.mjs";
// Fast compression keeps internal builds quick without changing the app payload.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= "3";
for (const role of ["host", "client"]) {
  const productName = role === "host" ? "AgentView Host" : "AgentView";
  await build({
    targets: Platform.WINDOWS.createTarget(["portable"]),
    config: {
      appId: `labs.hardline.agentview.${role}`,
      productName,
      copyright: "Copyright © Hardline Labs",
      directories: { output: `out/${role}` },
      files: ["dist/electron/**/*", "dist/ui/**/*", "assets/icon.png", "package.json"],
      extraMetadata: {
        name:
          role === "host"
            ? "hardline-agentview-host"
            : "hardline-agentview-client",
        productName,
      },
      asar: true,
      asarUnpack: ["dist/electron/runtime.cjs"],
      npmRebuild: false,
      win: {
        target: ["portable"],
        icon: "assets/icon.ico",
        artifactName: `${productName}.exe`,
        signAndEditExecutable: true,
      },
      portable: {
        artifactName: `${productName}.exe`,
        requestExecutionLevel: "user",
      },
    },
  });
}
