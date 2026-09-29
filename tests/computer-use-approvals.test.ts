import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { HostService } from "../src/host/service";
import {
  computerUseApp,
  hasSavedComputerUseApproval,
  savedComputerUseResponse,
} from "../src/host/computer-use-approvals";

const app = "process:C:\\CCP\\EVE\\tq\\bin64\\exefile.exe";
const request = (id = "eve") => ({
  id,
  method: "mcpServer/elicitation/request",
  params: {
    threadId: "owned",
    turnId: "running",
    serverName: "node_repl",
    mode: "form",
    message: "Allow Codex to use exefile?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      connector_id: "computer-use",
      persist: ["session", "always"],
      tool_params: { app },
    },
  },
});
const config = (allowed: unknown = { [app]: true }) => ({
  layers: [
    {
      name: { type: "user" },
      config: {
        computer_use: { windows: { always_allowed_app_ids: allowed } },
      },
    },
  ],
});

test("only the known Computer Use app-consent envelope can use saved approval", () => {
  assert.equal(computerUseApp(request()), app);
  const variants: ((r: any) => void)[] = [
    (r) => (r.method = "item/tool/requestUserInput"),
    (r) => (r.params.serverName = "unrelated-mcp"),
    (r) => (r.params.mode = "url"),
    (r) => (r.params.mode = "openai/form"),
    (r) => (r.params._meta = null),
    (r) => (r.params._meta.connector_id = "other"),
    (r) => (r.params._meta.codex_approval_kind = "action"),
    (r) => (r.params._meta.codex_request_type = "approval_request"),
    (r) => (r.params._meta.persist = ["session"]),
    (r) => (r.params._meta.persist = "always"),
    (r) =>
      (r.params._meta.tool_params = { app, destination: "another action" }),
    (r) => (r.params._meta.tool_params.app = "computer-audio"),
    (r) => (r.params._meta.tool_params.app = ""),
    (r) => (r.params._meta.tool_params.app = [app]),
    (r) =>
      (r.params.requestedSchema.properties = {
        confirmPurchase: { type: "boolean" },
      }),
    (r) => (r.params.requestedSchema.required = ["answer"]),
    (r) => (r.params.requestedSchema = null),
  ];
  for (const change of variants) {
    const r = request();
    change(r);
    assert.equal(computerUseApp(r), undefined, JSON.stringify(r));
  }
  const textOnly = request();
  textOnly.params.message =
    "The display message cannot change the approved app.";
  assert.equal(computerUseApp(textOnly), app);
});

test("consent comes from the exact boolean key in the raw user layer", () => {
  assert.equal(hasSavedComputerUseApproval(config(), app), true);
  for (const value of [
    null,
    [app],
    { [app]: false },
    { [app]: "true" },
    { "exefile.exe": true },
    { "*": true },
  ])
    assert.equal(hasSavedComputerUseApproval(config(value), app), false);
  for (const type of ["project", "commandLine", "system"])
    assert.equal(
      hasSavedComputerUseApproval(
        { layers: [{ ...config().layers[0], name: { type } }] },
        app,
      ),
      false,
    );
  assert.equal(
    hasSavedComputerUseApproval(
      { layers: [{ ...config().layers[0], disabledReason: "untrusted" }] },
      app,
    ),
    false,
  );
  assert.equal(
    hasSavedComputerUseApproval(
      { layers: [config().layers[0], config().layers[0]] },
      app,
    ),
    false,
  );
  assert.equal(
    hasSavedComputerUseApproval({ config: config().layers[0].config }, app),
    false,
  );
  assert.equal(hasSavedComputerUseApproval(config(), app + ".other"), false);
});

function fixture() {
  const host = new HostService(
    { vaultPath: process.cwd(), port: 0, codexPath: "", autoStart: false },
    process.cwd(),
  );
  const state = host as any;
  host.codex.ready = true;
  state.owned.add("owned");
  state.activeTurns.set("owned", "running");
  host.features.notice = async () => {};
  const responses: any[] = [];
  host.codex.respond = (id, result) => {
    responses.push({ id, result });
  };
  let saved = config();
  host.codex.rpc = async (method, params) => {
    assert.equal(method, "config/read");
    assert.deepEqual(params, { includeLayers: true });
    return saved;
  };
  return {
    host,
    state,
    responses,
    revoke: () => {
      saved = config({});
    },
  };
}

test("Host uses saved app consent without a viewer and rereads revocation", async () => {
  const { host, responses, revoke } = fixture();
  host.codex.emit("request", request());
  await setImmediate();
  assert.deepEqual(responses, [
    { id: "eve", result: savedComputerUseResponse() },
  ]);
  assert.equal(host.snapshot().approvals.length, 0);
  revoke();
  host.codex.emit("request", request("revoked"));
  await setImmediate();
  assert.equal(responses.length, 1);
  assert.equal(host.snapshot().approvals[0].id, "revoked");
});

test("unknown config and disconnected, stale or externally owned requests remain manual", async () => {
  for (const change of [
    (h: any) =>
      (h.codex.rpc = async () => {
        throw new Error("unsupported");
      }),
    (h: any) => (h.codex.rpc = async () => ({})),
    (h: any) => (h.codex.ready = false),
    (h: any) => h.completedTurns.add("running"),
    (h: any) => h.activeTurns.set("owned", "different"),
    (h: any) => h.owned.clear(),
  ]) {
    const { host, state, responses } = fixture();
    change(state);
    host.codex.emit("request", request());
    await setImmediate();
    assert.equal(responses.length, 0);
    assert.equal(host.snapshot().approvals.length, 1);
  }
});

test("resolution and turn changes during config lookup prevent a second answer", async () => {
  for (const change of [
    (h: any) => h.approvals.delete("eve"),
    (h: any) => h.completedTurns.add("running"),
    (h: any) => (h.codex.ready = false),
  ]) {
    const { host, state, responses } = fixture();
    let resolve!: (v: any) => void;
    host.codex.rpc = () =>
      new Promise((r) => {
        resolve = r;
      });
    host.codex.emit("request", request());
    change(state);
    resolve(config());
    await setImmediate();
    assert.equal(responses.length, 0);
  }
});

test("failed response remains pending; ordinary MCP acceptance stays one-time", async () => {
  const { host, responses } = fixture();
  host.codex.respond = () => {
    throw new Error("disconnected");
  };
  host.codex.emit("request", request());
  await setImmediate();
  assert.equal(host.snapshot().approvals.length, 1);
  host.codex.respond = (id, result) => {
    responses.push({ id, result });
  };
  await host.handle("approval.respond", { id: "eve", allow: true });
  assert.deepEqual(responses, [
    { id: "eve", result: { action: "accept", content: {}, _meta: null } },
  ]);
});
