import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { HostService } from "../src/host/service";
import type { Agent, Graph } from "../src/shared/types";

// Same encrypted-host workload before and after a rendering change. Canvas work
// and main-thread time are battery-cost proxies, not a physical battery test.
export async function energySmoke(page: Page, host: HostService) {
  const originalGraph = host.vault.graph;
  const domains = [
    "company",
    "operations",
    "relay",
    "agentview",
    "aegis",
    "website",
    "discord-bot",
  ];
  const graph: Graph = {
    revision: originalGraph.revision + 1,
    nodes: Array.from({ length: 160 }, (_, i) => ({
      id: `energy-${i}.md`,
      title: `Workspace note ${i}`,
      domain: domains[i % domains.length],
      kind: i % 12 === 0 ? "entry" : "reference",
      status: "current",
      modified: 0,
      size: 100,
    })),
    links: Array.from({ length: 620 }, (_, i) => ({
      source: `energy-${i % 160}.md`,
      target: `energy-${((i % 160) + 1 + Math.floor(i / 160) * 17) % 160}.md`,
    })),
  };
  const publishGraph = (value: Graph) => {
    host.vault.graph = value;
    host.vault.emit("graph", value);
  };
  const publishAgents = (agents: Agent[]) =>
    (host as any).broadcast({ type: "agents", agents });
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const originals = {
      clearRect: proto.clearRect,
      createRadialGradient: proto.createRadialGradient,
      measureText: proto.measureText,
    };
    const stats = {
      frames: 0,
      gradients: 0,
      textMeasures: 0,
      frameMs: [] as number[],
    };
    (window as any).energyStats = stats;
    const isGraph = (ctx: CanvasRenderingContext2D) =>
      ctx.canvas.matches(".graph-surface canvas");
    for (const [name, counter] of [
      ["clearRect", "frames"],
      ["createRadialGradient", "gradients"],
      ["measureText", "textMeasures"],
    ] as const) {
      (proto as any)[name] = function (...args: any[]) {
        if (isGraph(this)) stats[counter]++;
        return (originals[name] as Function).apply(this, args);
      };
    }
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      raf.call(window, (time) => {
        const frames = stats.frames,
          start = performance.now();
        callback(time);
        if (stats.frames > frames)
          stats.frameMs.push(performance.now() - start);
      });
    (window as any).restoreEnergy = () => {
      Object.assign(proto, originals);
      window.requestAnimationFrame = raf;
    };
  });
  const cdp =
    page.context().browser()!.browserType().name() === "chromium"
      ? await page.context().newCDPSession(page)
      : undefined;
  await cdp?.send("Performance.enable");
  const taskTime = async () => {
    const result = await cdp?.send("Performance.getMetrics");
    return result?.metrics.find((m) => m.name === "TaskDuration")?.value;
  };
  const results: Record<string, unknown> = {};
  async function measure(name: string) {
    const samples = [];
    for (let run = 0; run < 3; run++) {
      await page.evaluate(() =>
        Object.assign((window as any).energyStats, {
          frames: 0,
          gradients: 0,
          textMeasures: 0,
          frameMs: [],
        }),
      );
      const before = await taskTime();
      await page.waitForTimeout(3000);
      const after = await taskTime();
      const stats = await page.evaluate(() => {
        const s = (window as any).energyStats;
        const timings = [...s.frameMs].sort((a: number, b: number) => a - b);
        return {
          frames: s.frames,
          gradients: s.gradients,
          textMeasures: s.textMeasures,
          drawMs: s.frameMs.reduce((a: number, b: number) => a + b, 0),
          p95Ms: timings[Math.floor(timings.length * 0.95)] || 0,
        };
      });
      samples.push({
        ...stats,
        taskMs:
          before !== undefined && after !== undefined
            ? (after - before) * 1000
            : null,
      });
    }
    results[name] = samples;
    console.log(
      `Energy ${page.context().browser()!.browserType().name()} ${name}: ${JSON.stringify(samples)}`,
    );
    return samples;
  }
  const baseline = process.env.AGENTVIEW_ENERGY_BASELINE === "1";
  try {
    publishGraph(graph);
    publishAgents([]);
    await page.waitForTimeout(7000);
    const hidden = await measure("phone-chat");
    await page.locator(".mobile-live").click();
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    // The force simulation advances per frame. Slow software WebKit rendering
    // needs a longer warm-up than Chromium; do not label settling work as idle.
    if (baseline) await page.waitForTimeout(60_000);
    else {
      await page.waitForTimeout(1000);
      await page.waitForFunction(
        () => {
          const stats = (window as any).energyStats;
          if (stats.frames !== stats.lastFrames) {
            stats.lastFrames = stats.frames;
            stats.lastChange = performance.now();
            return false;
          }
          return performance.now() - stats.lastChange > 750;
        },
        null,
        { timeout: 45_000 },
      );
    }
    const idle = await measure("brain-idle");
    if (!baseline) {
      assert.ok(
        hidden.every((s) => s.frames === 0),
        "Hidden phone graph does not draw",
      );
      assert.ok(
        idle.every((s) => s.frames === 0),
        "Settled brain does not draw continuously",
      );
      await page.evaluate(() => {
        (window as any).idleGraphImage = document
          .querySelector<HTMLCanvasElement>(".graph-scene")!
          .toDataURL();
      });
      publishGraph({ ...graph, revision: graph.revision + 1 });
      await page.waitForTimeout(2000);
      assert.ok(
        await page.evaluate(() => {
          const unchanged =
            (window as any).idleGraphImage ===
            document
              .querySelector<HTMLCanvasElement>(".graph-scene")!
              .toDataURL();
          delete (window as any).idleGraphImage;
          return unchanged;
        }),
        "A metadata-only snapshot preserves the settled layout exactly",
      );
    }
    publishAgents(
      Array.from({ length: 3 }, (_, i) => ({
        id: `energy-agent-${i}`,
        threadId: `energy-thread-${i}`,
        name: `Agent ${i + 1}`,
        action: i === 0 ? "running" : "reading",
        target: i ? `energy-${i * 35}.md` : undefined,
        active: true,
        updated: Date.now(),
      })),
    );
    await page.waitForTimeout(1500);
    const active = await measure("brain-active");
    assert.ok(
      active.every((s) => s.frames > 2),
      "Live agents remain animated (without assuming the test machine's refresh rate)",
    );
    if (!baseline)
      assert.ok(
        active.every((s) => s.gradients === 0),
        "PWA graph uses flat marks without radial gradients",
      );
    if (process.env.AGENTVIEW_PWA_CAPTURES)
      await page.screenshot({
        path: path.join(
          process.env.AGENTVIEW_PWA_CAPTURES,
          `${page.context().browser()!.browserType().name()}-energy-brain.png`,
        ),
      });
    if (!baseline) {
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const background = await measure("app-background");
      assert.ok(
        background.every((s) => s.frames === 0),
        "Background app stops graph rendering",
      );
      await page.evaluate(() => {
        delete (document as any).hidden;
        delete (document as any).visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.locator(".connection-pill:not(.lost)").waitFor();
      publishAgents(
        Array.from({ length: 3 }, (_, i) => ({
          id: `energy-agent-${i}`,
          threadId: `energy-thread-${i}`,
          name: `Agent ${i + 1}`,
          action: "running",
          active: true,
          updated: Date.now(),
        })),
      );
      await page.waitForTimeout(500);
      assert.ok(
        await page.evaluate(() => (window as any).energyStats.frames > 0),
        "Foreground graph resumes drawing",
      );
    }
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await page.waitForTimeout(500);
    const activeHidden = await measure("phone-chat-active");
    if (!baseline)
      assert.ok(
        activeHidden.every((s) => s.frames === 0),
        "Active agents do not animate the hidden graph",
      );
    if (process.env.AGENTVIEW_PWA_CAPTURES)
      await writeFile(
        path.join(
          process.env.AGENTVIEW_PWA_CAPTURES,
          `${page.context().browser()!.browserType().name()}-energy.json`,
        ),
        JSON.stringify(results, null, 2),
      );
  } finally {
    publishAgents([]);
    publishGraph(originalGraph);
    await page.evaluate(() => (window as any).restoreEnergy());
    await cdp?.detach();
  }
}
