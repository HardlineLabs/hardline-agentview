/** A speed cap and exponential arrival keep travel consistent across display refresh rates. */
export function moveToward(
  position: { x: number; y: number },
  target: { x: number; y: number },
  seconds: number,
  scale = 1,
) {
  const dx = target.x - position.x,
    dy = target.y - position.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const step = Math.min(
    distance * (1 - Math.exp(-seconds * 2)),
    (85 * seconds) / scale,
  );
  position.x += (dx / distance) * step;
  position.y += (dy / distance) * step;
}
