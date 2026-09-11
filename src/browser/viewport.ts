export function trackViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  root.classList.add("pwa-document");
  let frame = 0;
  let settleUntil = 0;
  const update = () => {
    frame = 0;
    // Ignore pinch zoom; use the visible viewport only for keyboard/layout changes.
    if (!viewport || Math.abs(viewport.scale - 1) <= 0.05) {
      const height = viewport?.height || innerHeight;
      const top = Math.max(0, viewport?.offsetTop || 0);
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--app-top", `${top}px`);
      root.classList.toggle("pwa-compact", height < 600);
      root.classList.toggle("pwa-keyboard", root.clientHeight - height > 120);
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
  document.addEventListener("focusout", settle);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) settle();
  });
  update();
}
