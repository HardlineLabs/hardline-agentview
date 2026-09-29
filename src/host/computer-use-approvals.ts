import type { Approval } from "../shared/types";

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Recognize the Windows Computer Use app-access prompt, not arbitrary MCP
// questions, action confirmations, audio capture, or a tool's display message.
export function computerUseApp(request: Approval): string | undefined {
  const p = request.params;
  if (
    request.method !== "mcpServer/elicitation/request" ||
    p?.serverName !== "node_repl" ||
    p.mode !== "form"
  )
    return;
  const meta = p._meta;
  const schema = p.requestedSchema;
  if (
    !record(meta) ||
    meta.connector_id !== "computer-use" ||
    meta.codex_approval_kind !== "mcp_tool_call" ||
    meta.codex_request_type !== undefined ||
    !Array.isArray(meta.persist) ||
    !meta.persist.includes("always") ||
    !record(meta.tool_params) ||
    Object.keys(meta.tool_params).some((key) => key !== "app") ||
    !record(schema) ||
    schema.type !== "object" ||
    !record(schema.properties) ||
    Object.keys(schema.properties).length !== 0 ||
    (schema.required !== undefined &&
      (!Array.isArray(schema.required) || schema.required.length !== 0))
  )
    return;
  const app = meta.tool_params.app;
  if (
    typeof app !== "string" ||
    !app.trim() ||
    app !== app.trim() ||
    app === "computer-audio"
  )
    return;
  return app;
}

// config/read's typed effective config omits the Desktop-owned allowlist.
// Its raw user layer preserves it. Project and CLI layers cannot grant consent.
export function hasSavedComputerUseApproval(
  config: unknown,
  app: string,
): boolean {
  if (!record(config) || !Array.isArray(config.layers)) return false;
  const users = config.layers.filter(
    (layer: unknown) =>
      record(layer) && layer.name?.type === "user" && !layer.disabledReason,
  );
  if (users.length !== 1) return false;
  const allowed =
    users[0].config?.computer_use?.windows?.always_allowed_app_ids;
  return (
    record(allowed) && Object.hasOwn(allowed, app) && allowed[app] === true
  );
}

export function savedComputerUseResponse() {
  return {
    action: "accept",
    content: { source: "computer-use-persisted-state", scope: "global" },
    _meta: { persist: "always" },
  };
}
