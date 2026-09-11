export function trackViewport() {
  const viewport = window.visualViewport;
  const update = () => {
    // Ignore pinch zoom; use the visible viewport only for keyboard/layout changes.
    if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
    document.documentElement.style.setProperty(
      "--app-height",
      `${viewport?.height || innerHeight}px`,
    );
    document.documentElement.style.setProperty(
      "--app-top",
      `${viewport?.offsetTop || 0}px`,
    );
  };
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
}
