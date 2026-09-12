export function trackViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  root.classList.add("pwa-document");
  const measure = document.createElement("div");
  measure.className = "pwa-viewport-measure";
  measure.setAttribute("aria-hidden", "true");
  document.body.append(measure);
  let frame = 0;
  let settleUntil = 0;
  let editingUntil = 0;
  const editable =
    "textarea, input:not([type=checkbox]):not([type=radio]), [contenteditable=true]";
  const update = () => {
    frame = 0;
    // Ignore pinch zoom; use the visible viewport only for keyboard/layout changes.
    if (!viewport || Math.abs(viewport.scale - 1) <= 0.05) {
      // CSS dynamic viewport is authoritative when the keyboard is closed.
      // iOS can retain stale visualViewport height/offset after a native picker
      // or app switch; feeding those values back into a fixed shell leaves gaps.
      const fullHeight = measure.getBoundingClientRect().height || innerHeight;
      const editing =
        document.activeElement?.matches(editable) ||
        performance.now() < editingUntil;
      const keyboard = Boolean(
        editing && viewport && fullHeight - viewport.height > 120,
      );
      const height = keyboard ? viewport!.height : fullHeight;
      const top = keyboard
        ? Math.min(fullHeight - height, Math.max(0, viewport!.offsetTop))
        : 0;
      if (!keyboard && (scrollX || scrollY)) window.scrollTo(0, 0);
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--app-top", `${top}px`);
      root.classList.toggle("pwa-compact", height < 600);
      root.classList.toggle("pwa-keyboard", keyboard);
    }
    if (performance.now() < settleUntil) frame = requestAnimationFrame(update);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const settle = () => {
    // Safari can report keyboard geometry after focus, before typing, without
    // delivering every intermediate resize. Follow only the short transition.
    settleUntil = performance.now() + 1000;
    schedule();
  };
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", settle);
  window.addEventListener("pageshow", settle);
  document.addEventListener("focusin", settle);
  document.addEventListener("focusout", (event) => {
    // Let a tap finish before moving the button that dismissed the keyboard.
    if ((event.target as Element)?.matches(editable))
      editingUntil = performance.now() + 250;
    settle();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) settle();
  });
  update();
}
