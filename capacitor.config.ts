import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "labs.hardline.agentview",
  appName: "AgentView",
  webDir: "dist/ui",
  loggingBehavior: "none",
  plugins: { SystemBars: { style: "DARK" } },
  android: {
    backgroundColor: "#0b1014",
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};
export default config;
