import assert from "node:assert/strict";
import path from "node:path";
import type { Page } from "playwright";

// Emulate keyboard geometry separately from the layout viewport. Desktop browser
// emulation cannot open an actual iPhone keyboard or reproduce its compositor.
export async function installViewportFixture(page: Page) {
  await page.addInitScript(() => {
    const viewport = window.visualViewport!;
    const original = Object.fromEntries(
      ["height", "offsetTop", "scale"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(VisualViewport.prototype, key)!.get!,
      ]),
    );
    (window as any).testViewport = null;
    for (const key of Object.keys(original))
      Object.defineProperty(viewport, key, {
        get: () =>
          (window as any).testViewport?.[key] ?? original[key].call(viewport),
      });
  });
}

async function viewport(
  page: Page,
  height: number | null,
  top = 0,
  notify = true,
) {
  await page.evaluate(
    ({ height, top, notify }) => {
      (window as any).testViewport =
        height === null ? null : { height, offsetTop: top, scale: 1 };
      if (notify) window.visualViewport!.dispatchEvent(new Event("resize"));
    },
    { height, top, notify },
  );
}

async function geometry(page: Page, height: number, top = 0) {
  await page.waitForFunction(
    ({ height, top }) => {
      const app = document
        .querySelector(".browser-app")!
        .getBoundingClientRect();
      return Math.abs(app.height - height) < 2 && Math.abs(app.top - top) < 2;
    },
    { height, top },
  );
  const measurements = await page.evaluate(() => {
    const app = document.querySelector(".browser-app")!.getBoundingClientRect();
    const composer = document
      .querySelector(".composer")!
      .getBoundingClientRect();
    const send = document
      .querySelector('[title="Send message"]')!
      .getBoundingClientRect();
    const chat = document
      .querySelector(".chat-scroll")!
      .getBoundingClientRect();
    return {
      rootY: scrollY,
      pageOverflow: document.documentElement.scrollHeight - innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      composerVisible:
        composer.top >= app.top && composer.bottom <= app.bottom + 1,
      sendVisible: send.right <= app.right && send.bottom <= app.bottom + 1,
      chatHeight: chat.height,
    };
  });
  assert.equal(measurements.rootY, 0, "The document must not scroll");
  assert.ok(measurements.pageOverflow <= 1, JSON.stringify(measurements));
  assert.ok(measurements.horizontalOverflow <= 1, JSON.stringify(measurements));
  assert.ok(measurements.composerVisible, JSON.stringify(measurements));
  assert.ok(measurements.sendVisible, JSON.stringify(measurements));
  assert.ok(measurements.chatHeight >= 60, JSON.stringify(measurements));
}

export async function layoutSmoke(
  page: Page,
  engine: string,
  captures?: string,
) {
  const scrollChat = async (delta: number) => {
    // Playwright cannot inject wheel input into mobile WebKit. Chromium checks
    // real wheel routing (including code blocks); WebKit checks scroll geometry.
    if (engine === "webkit")
      await page
        .locator(".chat-scroll")
        .evaluate((e, y) => e.scrollBy(0, y), delta);
    else await page.mouse.wheel(0, delta);
  };
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel("Message your agent");
  const draft = await input.inputValue();
  await input.blur();
  await geometry(page, 844);
  await input.fill("");
  await input.blur();
  const compactHeight = (await input.boundingBox())!.height;
  assert.ok(compactHeight <= 44, "Empty composer stays one line tall");
  await input.fill("One\nTwo\nThree\nFour");
  assert.ok(
    (await input.boundingBox())!.height > compactHeight,
    "Composer grows with a multiline draft",
  );
  await input.fill("");
  await input.blur();
  assert.ok(
    (await input.boundingBox())!.height <= 44,
    "Clearing a draft shrinks the composer",
  );
  assert.ok(
    (await page.locator(".context-compact").boundingBox())!.height <= 36,
  );
  await page.getByLabel("Context details").click();
  await page
    .getByText("Latest request, including its response.", { exact: false })
    .waitFor();
  await page.getByLabel("Context details").click();
  for (let repeat = 0; repeat < 3; repeat++) {
    await page.getByRole("button", { name: "Model", exact: true }).click();
    await page.getByRole("option", { name: "Test agent", exact: true }).click();
    await page
      .getByRole("button", { name: "Reasoning effort", exact: true })
      .click();
    await page
      .getByRole("option", { name: repeat % 2 ? "high" : "low", exact: true })
      .click();
    // A stale Safari visual viewport after dismissing a picker must not move the app.
    await viewport(page, 430, 260);
    await geometry(page, 844);
    await viewport(page, null);
  }
  if (captures)
    await page.screenshot({
      path: path.join(captures, `${engine}-compact-chat.png`),
    });
  // Empty-input focus, before any typing or viewport event, used to miss the
  // keyboard adjustment. A later geometry change models Safari's animation.
  await input.fill("");
  await input.blur();
  await viewport(page, 430, 32, false);
  await input.focus();
  await geometry(page, 430, 32);
  await viewport(page, 380, 48, false);
  await geometry(page, 380, 48);
  await page.waitForFunction(() => {
    const chat = document.querySelector(".chat-scroll")!;
    return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 3;
  });
  if (captures)
    await page.screenshot({
      path: path.join(captures, `${engine}-keyboard.png`),
    });
  await input.fill(
    Array.from({ length: 40 }, (_, i) => `Draft line ${i + 1}`).join("\n"),
  );
  await geometry(page, 380, 48);
  // Scroll beyond both ends, including an attempted document scroll.
  const chat = page.locator(".chat-scroll");
  await chat.hover();
  await scrollChat(-100000);
  await page.waitForFunction(
    () => document.querySelector(".chat-scroll")!.scrollTop < 2,
  );
  await viewport(page, 400, 24);
  await geometry(page, 400, 24);
  assert.ok(
    await chat.evaluate((e) => e.scrollTop < 2),
    "Reading older messages survives keyboard resizing",
  );
  await scrollChat(-100000);
  await page.evaluate(() => window.scrollTo(0, 10000));
  await geometry(page, 400, 24);
  await scrollChat(100000);
  await page.waitForFunction(() => {
    const chat = document.querySelector(".chat-scroll")!;
    return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 3;
  });
  await scrollChat(100000);
  await geometry(page, 400, 24);
  await viewport(page, null);
  await input.blur();
  await input.fill(draft);
  await geometry(page, 844);

  for (let repeat = 0; repeat < 3; repeat++) {
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search conversations", exact: true })
      .fill("First");
    await viewport(page, 390, 20);
    await page
      .getByRole("button", { name: "Workspace settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Onboarding", exact: true }).click();
    await page
      .getByLabel("Default onboarding instruction")
      .fill("Unsubmitted layout test");
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("pwa-keyboard"),
    );
    const bounds = await page.locator(".settings-modal").boundingBox();
    assert.ok(
      bounds && bounds.y >= 20 && bounds.y + bounds.height <= 411,
      `Settings fit keyboard: ${JSON.stringify(bounds)}`,
    );
    await page.getByTitle("Close settings", { exact: true }).click();
    await viewport(page, null);
    await geometry(page, 844);
    await page.locator(".mobile-live").click();
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    assert.equal(
      await input.inputValue(),
      draft,
      "Repeated navigation retains the draft",
    );
  }
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await geometry(page, size.height);
  }
  console.log(`${engine}: checking search and empty-chat scroll boundaries`);
  await page.locator(".search-trigger").click();
  await viewport(page, 360, 30);
  await page.getByPlaceholder("Find a note or conversation…").fill("First");
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("pwa-keyboard"),
  );
  const palette = await page.locator(".command-palette").boundingBox();
  assert.ok(
    palette && palette.y >= 30 && palette.y + palette.height <= 391,
    `Search stays above the keyboard: ${JSON.stringify(palette)}`,
  );
  await page.getByRole("button", { name: "esc", exact: true }).click();
  await viewport(page, null);
  await page.getByTitle("New conversation", { exact: true }).click();
  await geometry(page, 844);
  await page.locator(".chat-scroll").hover();
  for (const delta of [10000, 10000, -10000, -10000]) {
    await scrollChat(delta);
    await geometry(page, 844);
  }
  await input.fill("Draft on an empty chat");
  await viewport(page, 360, 0);
  await geometry(page, 360);
  await viewport(page, null);
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page.getByRole("button", { name: /First conversation/ }).click();
  await page.waitForFunction(
    (draft) =>
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Message your agent"]',
      )?.value === draft,
    draft,
  );
  assert.equal(
    await input.inputValue(),
    draft,
    "Returning from an empty chat restores the original draft",
  );
  console.log(
    `${engine}: keyboard focus/animation, scroll boundaries, long drafts, dialogs and repeated navigation passed`,
  );
}

export async function safeAreaSmoke(
  page: Page,
  engine: string,
  captures?: string,
) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: sessionStorage.getItem("test-standalone") === "true",
    }),
  );
  await page.evaluate(() => sessionStorage.setItem("test-standalone", "true"));
  await page.reload();
  await page
    .getByText("Welcome to First. Your workspace stays on this computer.")
    .waitFor();
  const insets = await page.addStyleTag({
    content: `
    .pwa-document { --pwa-safe-top: 59px; --pwa-safe-bottom: 34px; }
    /* Model a fixed frame that ends above the display bottom. Explicit 100vh
       must win over that short frame; auto height would shrink by 93px.
       Important prevents the production selector from disabling the fixture. */
    .pwa-viewport-measure { bottom: 93px !important; }
  `,
  });
  await viewport(page, 751);
  await page.getByLabel("Message your agent").blur();
  await geometry(page, 844);
  assert.equal(
    await page
      .locator(".pwa-viewport-measure")
      .evaluate((element) => getComputedStyle(element).bottom),
    "93px",
    "The shortened fixed-frame fixture must actually apply",
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await geometry(page, 844);
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    return {
      headerTop: rect(".app-header").top,
      menuTop: rect(".mobile-menu").top,
      composerBottom: rect(".composer-area").bottom,
      sendBottom: rect('[title="Send message"]').bottom,
    };
  });
  assert.equal(bounds.headerTop, 0, "Header surface reaches the screen edge");
  assert.ok(bounds.menuTop >= 59, "Header controls clear the status area");
  assert.equal(
    bounds.composerBottom,
    844,
    "Composer surface reaches the bottom edge",
  );
  assert.ok(bounds.sendBottom <= 810, "Send clears the home indicator once");
  if (captures)
    await page.screenshot({
      path: path.join(captures, `${engine}-safe-area.png`),
    });
  await page.getByLabel("Message your agent").focus();
  await viewport(page, 430, 32);
  await geometry(page, 430, 32);
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--pwa-bottom-space")
        .trim(),
    ),
    "0px",
  );
  await page.getByLabel("Message your agent").blur();
  await viewport(page, null);
  await geometry(page, 844);
  // A system-owned strip is outside the web viewport. Never force screen.height.
  await page.setViewportSize({ width: 393, height: 782 });
  await geometry(page, 782);
  await page.setViewportSize({ width: 390, height: 844 });
  await geometry(page, 844);
  await insets.evaluate((element) => element.remove());
  await page.evaluate(() => sessionStorage.removeItem("test-standalone"));
  await page.reload();
  await page
    .getByText("Welcome to First. Your workspace stays on this computer.")
    .waitFor();
  console.log(
    `${engine}: installed safe areas, shortened fixed frame, keyboard and viewport bounds passed`,
  );
}
