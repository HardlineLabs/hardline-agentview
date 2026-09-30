import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { linkTargets, resolveLink, Vault } from "../src/host/vault";

test("Obsidian links resolve aliases, headings, encoded paths and ambiguity", () => {
  const ids = [
    "Home.md",
    "Projects/Agent View.md",
    "Projects/Detail.md",
    "Other/Detail.md",
  ];
  const links = linkTargets(
    "[[Projects/Agent View#Heading|Display]] [Project](Projects/Agent%20View.md) `[[ignored]]`\n```md\n[[ignored]]\n```",
  );
  assert.equal(links.length, 2);
  assert.equal(
    resolveLink("Home.md", links[0].target, true, ids),
    "Projects/Agent View.md",
  );
  assert.equal(
    resolveLink("Home.md", links[1].target, false, ids),
    "Projects/Agent View.md",
  );
  assert.equal(resolveLink("Home.md", "Detail", true, ids), undefined);
  assert.equal(
    resolveLink("Projects/Agent View.md", "../Home.md", false, ids),
    "Home.md",
  );
});

test("live vault reconciles additions and deletions and never reads arbitrary paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-vault-"));
  const vault = new Vault(root);
  try {
    await fs.writeFile(
      path.join(root, "Home.md"),
      "---\ntype: hub\ndomain: company\n---\n# Home\n[[New]]",
    );
    await fs.mkdir(path.join(root, ".private"));
    await fs.writeFile(path.join(root, ".private/secret.md"), "# Hidden");
    await vault.start();
    assert.equal(vault.graph.nodes.length, 1);
    assert.throws(() => vault.read("../secret.txt"), /no longer/);
    const waitGraph = (predicate: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          vault.off("graph", check);
          reject(new Error("Watcher did not reconcile"));
        }, 5000);
        const check = () => {
          if (predicate()) {
            clearTimeout(timer);
            vault.off("graph", check);
            resolve();
          }
        };
        vault.on("graph", check);
      });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const added = waitGraph(() => vault.graph.nodes.length === 2);
    await fs.writeFile(path.join(root, "New.md"), "# New\n[[Home]]");
    await added;
    assert.equal(vault.graph.links.length, 1);
    const removed = waitGraph(() => vault.graph.nodes.length === 1);
    await fs.unlink(path.join(root, "New.md"));
    await removed;
    assert.equal(vault.graph.links.length, 0);
  } finally {
    await vault.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace products use their entry titles and refresh from the manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentview-projects-"));
  const vault = new Vault(root);
  try {
    await fs.mkdir(path.join(root, "Projects/Relay/App"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Projects/Relay/App/index.md"),
      "---\ntype: entry\ndomain: relay\nstatus: current\n---\n# Hardline Relay App\n",
    );
    await fs.writeFile(
      path.join(root, "workspace.json"),
      JSON.stringify({
        products: {
          "relay-app": {
            path: "../products/relay-app",
            onboarding: "Projects/Relay/App/index.md",
          },
        },
      }),
    );
    await vault.start();
    assert.deepEqual(
      vault.projects.map(({ id, name }) => ({ id, name })),
      [
        { id: "vault", name: "Company brain" },
        { id: "relay-app", name: "Hardline Relay App" },
      ],
    );
    const refreshed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Projects did not refresh")),
        5000,
      );
      const check = () => {
        if (vault.projects.some((project) => project.id === "new-product")) {
          clearTimeout(timer);
          vault.off("graph", check);
          resolve();
        }
      };
      vault.on("graph", check);
    });
    await fs.mkdir(path.join(root, "Projects/New Product"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "Projects/New Product/index.md"),
      "---\ntype: entry\ndomain: product\nstatus: current\n---\n# New Product\n",
    );
    await fs.writeFile(
      path.join(root, "workspace.json"),
      JSON.stringify({
        products: {
          "relay-app": {
            path: "../products/relay-app",
            onboarding: "Projects/Relay/App/index.md",
          },
          "new-product": {
            path: "../products/new-product",
            onboarding: "Projects/New Product/index.md",
          },
        },
      }),
    );
    await refreshed;
    assert.equal(
      vault.projects.find((project) => project.id === "new-product")?.name,
      "New Product",
    );
  } finally {
    await vault.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
