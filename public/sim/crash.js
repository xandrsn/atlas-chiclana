// Rollover / fall-over of a vehicle body (pure, node-testable). State t = { a (roll angle, rad, + = left side up), w (rate), rest, fix }.
// A car has two stable rests (on its wheels a = 0, on its roof a = pi; the half turn between them is the barrier), a bike one on each side (+-pi/2).
// The mesh is rotated about its ground-level origin, so a rolled body is lifted by liftOf() to lie on the ground instead of in it.
const K = 9, FRICTION = 1.2;   // restoring stiffness (rad/s^2) and rolling friction (1/s)

export const startTumble = (w, a = 0) => ({ a, w, rest: false, fix: null });

/** one step; bike = rests on its side; -> true while it is still rolling. Sets t.rest when it settles (t.a snapped to the rest angle). t.done: back upright */
export function tumbleStep(t, dt, bike = false) {
  if (t.fix != null) {   // righted by the player: eases to the nearest upright angle
    t.a += (t.fix - t.a) * Math.min(1, 5 * dt); if (Math.abs(t.fix - t.a) < 0.03) { t.a = t.fix; t.done = true; } return !t.done;
  }
  if (t.rest) return false;
  const s = Math.sin(2 * t.a), tq = bike ? 2 * K * s : -2 * K * s;
  t.w += tq * dt; t.w *= Math.max(0, 1 - FRICTION * dt); t.a += t.w * dt;
  if (Math.abs(t.w) < 0.3 && Math.abs(s) < 0.3) {
    t.a = bike ? Math.round((t.a - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2 : Math.round(t.a / Math.PI) * Math.PI; t.w = 0; t.rest = true;
    if (!bike && Math.abs(Math.round(t.a / Math.PI)) % 2 === 0) t.done = true;   // back on its wheels
  }
  return !t.rest;
}
/** upright: rolled over (on its roof or side) and at rest */
export const flipped = t => !!t && t.rest && !t.done;
/** the player rights it (key R): -> true if it was lying */
export function right(t) { if (!flipped(t) || t.fix != null) return false; t.fix = Math.round(t.a / (2 * Math.PI)) * 2 * Math.PI; return true; }
/** height the origin must be raised so a body of half width hw and height H rolled by a lies on the ground */
export const liftOf = (a, hw, H) => hw * Math.abs(Math.sin(a)) - Math.min(0, H * Math.cos(a));
