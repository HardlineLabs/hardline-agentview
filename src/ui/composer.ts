import { useLayoutEffect, useRef, type RefObject } from "react";

// The visible chat viewport already accounts for the keyboard and safe areas.
// Measure its remaining space instead of guessing a fraction of the screen.
export function useComposer(
  input: RefObject<HTMLTextAreaElement | null>,
  follow: RefObject<boolean>,
  enabled: boolean,
  text: string,
  chatId?: string,
) {
  const animations = useRef<Animation[]>([]);
  const flight = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !input.current) return;
    const element = input.current;
    const panel = element.closest<HTMLElement>(".chat-panel")!;
    const area = element.closest<HTMLElement>(".composer-area")!;
    const scroll = panel.querySelector<HTMLElement>(".chat-scroll")!;
    const resize = () => {
      const overhead =
        area.getBoundingClientRect().height - element.offsetHeight;
      const available =
        panel.getBoundingClientRect().bottom -
        scroll.getBoundingClientRect().top -
        overhead -
        36;
      const previousScroll = element.scrollTop;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, Math.max(36, available))}px`;
      element.scrollTop = previousScroll;
      // Growing the draft shrinks the transcript in the same layout pass. Keep
      // its tail anchored before the resulting scroll event updates follow.
      if (follow.current) scroll.scrollTop = scroll.scrollHeight;
    };
    resize();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Changing the input also resizes the observed composer and transcript.
      // Let that layout settle before measuring again (especially in WebKit).
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          resize();
        });
    });
    for (const child of panel.children) observer.observe(child);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled, input, follow, text, chatId]);

  useLayoutEffect(
    () => () => {
      animations.current.forEach((animation) => animation.cancel());
      flight.current?.remove();
    },
    [],
  );

  return (steering = false) => {
    if (
      !enabled ||
      !input.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const draft = input.current.closest<HTMLElement>(".composer-draft")!;
    const panel = draft.closest<HTMLElement>(".chat-panel")!;
    const bounds = draft.getBoundingClientRect();
    const origin = panel.getBoundingClientRect();
    animations.current.forEach((animation) => animation.cancel());
    flight.current?.remove();
    // A decorative copy never receives focus or becomes a second editable draft.
    const copy = document.createElement("div");
    copy.className = `composer-flight${steering ? " composer-steering" : ""}`;
    copy.setAttribute("aria-hidden", "true");
    copy.textContent = [
      input.current.value,
      ...Array.from(
        draft.querySelectorAll(
          ".message-attachments span, .attached-note span",
        ),
        (attachment) => `[${attachment.textContent}]`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    Object.assign(copy.style, {
      left: `${bounds.left - origin.left}px`,
      top: `${bounds.top - origin.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    panel.append(copy);
    flight.current = copy;
    const opacity = Number(getComputedStyle(copy).opacity);
    const draftOpacity = Number(getComputedStyle(draft).opacity);
    const departure = copy.animate(
      [
        { transform: "translateY(0) scale(1)", opacity },
        { transform: "translateY(-40px) scale(.98)", opacity, offset: 0.45 },
        { transform: "translateY(-110px) scale(.94)", opacity: 0 },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    departure.onfinish = () => copy.remove();
    const replacement = draft.animate(
      [
        { transform: "scale(.96,.6)", opacity: draftOpacity * 0.2 },
        { transform: "scale(1)", opacity: draftOpacity },
      ],
      { duration: 260, delay: 90, fill: "backwards", easing: "ease-out" },
    );
    animations.current = [departure, replacement];
  };
}
