import assert from "node:assert/strict";
import type { Page } from "playwright";

// Observe actual canvas drawing without exposing test state in the client.
export async function graphStationSmoke(page: Page) {
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const marks: Record<string, { x: number; y: number; scale: number }> = {};
    (window as any).graphMarks = marks;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      const matrix = this.getTransform();
      const point = matrix.transformPoint({ x, y });
      marks[text] = {
        x: point.x / devicePixelRatio,
        y: point.y / devicePixelRatio,
        scale: matrix.a / devicePixelRatio,
      };
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
    (window as any).restoreGraphDrawing = () => {
      CanvasRenderingContext2D.prototype.fillText = original;
      delete (window as any).graphMarks;
      delete (window as any).restoreGraphDrawing;
    };
  });
  const marks = () =>
    page.evaluate(
      () =>
        (window as any).graphMarks as Record<
          string,
          { x: number; y: number; scale: number }
        >,
    );
  try {
    // A settled graph draws on demand; explicitly invalidate after installing
    // the observer rather than relying on a permanent animation loop.
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    await page.waitForFunction(() => (window as any).graphMarks?.Terminal);
    await page.waitForTimeout(1200);
    const initial = await marks();
    const box = await page
      .locator(".graph-surface canvas:not(.graph-scene)")
      .boundingBox();
    assert.ok(box);
    for (const title of ["Terminal", "Agent workspace"]) {
      assert.ok(initial[title].x > 0 && initial[title].x < box.width);
      assert.ok(initial[title].y > 0 && initial[title].y < box.height);
      assert.ok(
        initial[title].scale <= 1.45,
        "Stations scale with graph nodes",
      );
    }
    const noteLabels = Object.entries(initial).filter(
      ([text]) =>
        !["Terminal", "Agent workspace", ">_", "✦"].includes(text) &&
        !text.includes(" · "),
    );
    assert.ok(
      noteLabels.length,
      "Visible note labels establish network bounds",
    );
    assert.ok(
      noteLabels.every(([, point]) => point.y < initial.Terminal.y - 30),
      "Stations begin below the note network",
    );
    for (const [title, symbol] of [
      ["Terminal", ">_"],
      ["Agent workspace", "✦"],
    ]) {
      const before = await marks();
      const start = before[symbol];
      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + start.x + 35, box.y + start.y + 25, {
        steps: 15,
      });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = await marks();
      assert.ok(
        Math.abs(after[title].x - before[title].x - 35) < 2,
        `${title} drags horizontally`,
      );
      assert.ok(
        Math.abs(after[title].y - before[title].y - 25) < 2,
        `${title} drags vertically`,
      );
      const other = title === "Terminal" ? "Agent workspace" : "Terminal";
      assert.ok(
        Math.abs(after[other].x - before[other].x) < 1,
        "Dragging a station does not pan the graph",
      );
      await page.waitForTimeout(300);
      assert.ok(
        Math.abs((await marks())[title].x - after[title].x) < 1,
        "Dropped station stays put",
      );
    }
    const beforeZoom = await marks();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.waitForTimeout(1000);
    const afterZoom = await marks();
    assert.ok(
      afterZoom.Terminal.scale < beforeZoom.Terminal.scale * 0.9,
      "Station icon size shrinks with zoom",
    );
    assert.equal(afterZoom.Terminal.scale, afterZoom["Agent workspace"].scale);
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await page.locator(".mobile-live").click();
    await page.waitForTimeout(500);
    assert.ok(
      Math.abs((await marks()).Terminal.scale - afterZoom.Terminal.scale) <
        0.01,
      "Returning from chat preserves the graph zoom",
    );
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    await page.waitForTimeout(2000);
    const scene = page.locator(".graph-scene");
    // Software WebKit may still be settling the force layout after the zoom.
    // Compare filters only once the underlying scene is stable.
    await page.waitForFunction(
      () => {
        const image = document
          .querySelector<HTMLCanvasElement>(".graph-scene")!
          .toDataURL();
        if ((window as any).lastSceneImage !== image) {
          (window as any).lastSceneImage = image;
          (window as any).lastSceneChange = performance.now();
        }
        return performance.now() - (window as any).lastSceneChange > 500;
      },
      null,
      { polling: 200, timeout: 45_000 },
    );
    const beforeFilter = await scene.evaluate((c: HTMLCanvasElement) =>
      c.toDataURL(),
    );
    await page.locator(".graph-domains button").nth(1).click();
    await page.waitForFunction(
      (before) =>
        document
          .querySelector<HTMLCanvasElement>(".graph-scene")!
          .toDataURL() !== before,
      beforeFilter,
    );
    await page.getByRole("button", { name: "All notes", exact: true }).click();
    await page.waitForFunction(
      (before) =>
        document
          .querySelector<HTMLCanvasElement>(".graph-scene")!
          .toDataURL() === before,
      beforeFilter,
    );
    const home = (await marks())["First workspace"];
    assert.ok(home, "Home note has a visible label");
    await page.mouse.click(box.x + home.x, box.y + home.y - 17 * home.scale);
    await page.locator(".note-inspector").waitFor();
    await page.getByTitle("Close note", { exact: true }).click();
  } finally {
    await page.evaluate(() => {
      (window as any).restoreGraphDrawing();
      delete (window as any).lastSceneImage;
      delete (window as any).lastSceneChange;
    });
  }
}
