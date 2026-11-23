// Layered ground for the sim (no THREE, runs in node tests too). Surfaces at a point (x, z):
//   terrain   - the resident cell's baked height grid (absent inside a level "hole": ramp cuts)
//   deck      - the cell's bridge deck segments (scripts/bake_cells.mjs; no road lift: street asphalt is drawn 0.22 m over the height grid and movers ride the grid, so decks match it and the deck ends have no step)
//   level     - data/cells/<map>/levels.json (scripts/bake/plugins/bridges.mjs, underground.mjs): oriented rectangles with a linear
//               long profile (ramps, stairs, footbridge decks, parking floors), optional ceiling (head room), foot-only flag and lane flag
//               (madrid_tunnels.mjs: among overlapping lanes the one nearest the feet wins, not the highest; optional core [s0, s1]: outside it the rect is padding)
// at(x, z, yHint, o) picks the highest surface at most o.step above yHint (the mover's feet now): you stay on the layer you are on, a deck
// above you is a roof and a deck below you is not a floor until you drive off its end. Nothing within reach = a wall (blocked).
//   o: { step (max climb per query, m), maxDrop (a drop deeper than this blocks: parapets and cut edges for cars), foot (walker: may use foot-only levels) }
//   -> { y, blocked, ceil (lowest roof above y, Infinity in the open), layer: 'terrain'|'deck'|'level'|'none', id }
export const CAR = { step: 0.6, maxDrop: 1.2, foot: false };
export const FOOT = { step: 0.5, maxDrop: Infinity, foot: true };
const LIFT = 0, DECK_T = 1.3, SLAB_T = 0.5, GB = 32, NONE = { surfaces: [], holes: [], solids: [] };   // level rects bucketed on a GB m grid (Madrid's tunnels: ~10k rects)

/** oriented rectangle helpers: r = { c: [x, z], u: [ux, uz] (unit, long axis), hl, hw } -> local (s along u, t across) or null when outside */
function local(r, x, z, pad = 0) {
  const dx = x - r.c[0], dz = z - r.c[1], s = dx * r.u[0] + dz * r.u[1], t = -dx * r.u[1] + dz * r.u[0];
  return Math.abs(s) <= r.hl + pad && Math.abs(t) <= r.hw + pad ? s : null;
}

export class Ground {
  /** cells: { S, byKey: Map('i,j' -> { i, j, hm, N, decks }) } (stream/cells.js or a node loader); levels: levels.json or null */
  constructor(cells, levels) {
    this.cells = cells; this.L = { surfaces: [], holes: [], solids: [], ...(levels || {}) }; this.B = new Map();
    for (const kind of ['surfaces', 'holes', 'solids']) for (const r of this.L[kind]) {
      const ex = Math.abs(r.u[0]) * r.hl + Math.abs(r.u[1]) * r.hw + 0.05, ez = Math.abs(r.u[1]) * r.hl + Math.abs(r.u[0]) * r.hw + 0.05;
      for (let i = Math.floor((r.c[0] - ex) / GB); i <= Math.floor((r.c[0] + ex) / GB); i++) for (let j = Math.floor((r.c[1] - ez) / GB); j <= Math.floor((r.c[1] + ez) / GB); j++) {
        const k = i + ',' + j; let b = this.B.get(k); if (!b) this.B.set(k, b = { surfaces: [], holes: [], solids: [] }); b[kind].push(r);
      }
    }
  }
  /** the level rects that may touch (x, z) */
  near(x, z) { return this.B.get(Math.floor(x / GB) + ',' + Math.floor(z / GB)) || NONE; }
  terrain(x, z) {
    const cs = this.cells, S = cs.S, c = cs.byKey.get(Math.floor(x / S) + ',' + Math.floor(z / S)); if (!c || !c.hm) return null;
    const N = c.N, st = S / (N - 1), u = (x - c.i * S) / st, v = (z - c.j * S) / st, iu = Math.min(N - 2, u | 0), iv = Math.min(N - 2, v | 0), fu = u - iu, fv = v - iv, h = c.hm, o = iv * N + iu;
    return { c, y: Math.max(0.2, (h[o] * (1 - fu) + h[o + 1] * fu) * (1 - fv) + (h[o + N] * (1 - fu) + h[o + N + 1] * fu) * fv) };
  }
  /** every surface at (x, z): [{ y, roof (underside height), head (own ceiling or Infinity), layer, id, foot }] */
  surfaces(x, z) {
    const out = [], L = this.near(x, z), T = this.terrain(x, z);
    if (!T) return null;
    if (!L.holes.some(r => local(r, x, z) !== null)) out.push({ y: T.y, roof: T.y - SLAB_T, head: Infinity, layer: 'terrain' });
    const D = T.c.decks, lx = x - T.c.i * this.cells.S, lz = z - T.c.j * this.cells.S;
    if (D) for (let k = 0; k < D.length; k += 7) {
      const ax = D[k], az = D[k + 1], dx = D[k + 2] - ax, dz = D[k + 3] - az, u = ((lx - ax) * dx + (lz - az) * dz) / (dx * dx + dz * dz || 1), t = Math.max(0, Math.min(1, u));
      if (Math.hypot(ax + dx * t - lx, az + dz * t - lz) > D[k + 4]) continue;
      // round cap past an end: falls away at the deck's own grade, so at a bend, sag or crest of a steep deck it never stands over the next piece
      const y = D[k + 5] + (D[k + 6] - D[k + 5]) * t - Math.abs(D[k + 6] - D[k + 5]) * Math.abs(u - t) + LIFT; out.push({ y, roof: y - DECK_T, head: Infinity, layer: 'deck' });
    }
    for (const r of L.surfaces) {
      const s = local(r, x, z, 0.02); if (s === null) continue;   // pad: levels.json rounds rects to 1 cm, neighbours must not leave a crack
      const y = r.y0 + (r.y1 - r.y0) * (s + r.hl) / (2 * r.hl);
      out.push({ y, roof: y - (r.thick ?? 0.4), head: r.head ? y + r.head : Infinity, layer: 'level', id: r.id, foot: !!r.foot, lane: !!r.lane, core: !r.core || s >= r.core[0] - 0.02 && s <= r.core[1] + 0.02 });
    }
    return out;
  }
  at(x, z, yHint = Infinity, o = CAR) {
    const all = this.surfaces(x, z);
    if (!all) return { y: isFinite(yHint) ? yHint : 0, blocked: false, ceil: Infinity, layer: 'none' };   // cell not loaded yet: keep the height
    let best = null;
    for (const s of all) if ((o.foot || !s.foot) && s.y <= yHint + o.step && (!best || s.y > best.y)) best = s;
    // lanes (tunnel floors) that overlap where two tubes run side by side or merge differ by a few dm on a grade: keep the one under the feet;
    // a lane whose own piece (core) holds the point beats another's bend padding (the two only meet without a step at the piece's end)
    if (best?.lane && isFinite(yHint)) for (const s of all) if (s.lane && s.y <= yHint + o.step && best.y - s.y < 0.6 && (s.core && !best.core || s.core === best.core && Math.abs(s.y - yHint) < Math.abs(best.y - yHint))) best = s;
    const top = isFinite(yHint) ? yHint : best?.y ?? 0;
    for (const r of this.near(x, z).solids) if (local(r, x, z) !== null && top + 1.6 > r.y0 && top < r.y1) return { y: top, blocked: true, ceil: Infinity, layer: 'solid', id: r.id };
    if (!best || isFinite(yHint) && yHint - best.y > o.maxDrop) return { y: top, blocked: true, ceil: Infinity, layer: best ? 'edge' : 'wall' };
    let ceil = best.head; for (const s of all) if (s !== best && s.y > best.y + 0.3) ceil = Math.min(ceil, s.roof);
    return { y: best.y, blocked: false, ceil, layer: best.layer, id: best.id };
  }
}

/** sim callback for Car / Player: (x, z, yHint) -> { y, blocked, ceil } (number-returning callbacks keep working: see car.js / player.js) */
export const groundFn = (g, o) => (x, z, y) => g.at(x, z, y, o);
