import { test } from "node:test";
import assert from "node:assert/strict";
import {
  permissionMode,
  threadPolicy,
  turnPolicy,
} from "../src/host/permissions";

test("every access mode keeps approvals interactive without broadening its sandbox", () => {
  for (const [mode, sandbox, type] of [
    ["full", "danger-full-access", "dangerFullAccess"],
    ["workspace", "workspace-write", "workspaceWrite"],
    ["read-only", "read-only", "readOnly"],
  ] as const) {
    assert.deepEqual(threadPolicy(mode), {
      approvalPolicy: "on-request",
      sandbox,
    });
    assert.deepEqual(turnPolicy(mode, process.cwd()), {
      approvalPolicy: "on-request",
      sandboxPolicy:
        mode === "workspace"
          ? { type, writableRoots: [process.cwd()], networkAccess: true }
          : { type },
    });
    assert.equal(permissionMode(mode), mode);
  }
  assert.throws(() => permissionMode("never"), /Choose Full access/);
});
