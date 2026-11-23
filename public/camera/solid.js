// Building walls from the baked LOD0 mesh's tall near-vertical triangles, built in the cell worker (stream/worker.js, off the main thread:
// ready the moment the cell is live). Two views of the same walls:
//   - a per-cell 1 m grid of wall top / bottom heights (wallGrid): the camera boom (solid height = max(ground, wall top)) and the helicopter;
//   - the exact wall footprints (wallSegs): pieces <= 1 m long, each with its own height span, in 4 m buckets. The movers (sim/walls.js)
//     test their body rectangle against them (Solid.hits), so a wall blocks only where it is drawn: no 1 m cell rounding, no corner
//     cells, and a wall's [bottom, top] is its own (not merged with other walls in the same cell), so arcades, decks and tunnels under or
//     over a wall keep working.

/** pure: calls fn(px, pz, ex, ez, L, sec, W, front) for each wall triangle in [t0, t1) (index offsets, multiples of 3): footprint segment from
 *  (px, pz) along the unit (ex, ez), length L, and sec(w) -> [lo, hi] its height span at w along it, in metres (quantized cells v3:
 *  int16, metres = p / qxz horizontally, p / qy + yOff vertically); front > 0 when the drawn face looks to the left of (ex, ez), i.e.
 *  along (-ez, ex) (the triangle's winding normal: the side three.js draws, materials are single-sided). Skipped: under 1.5 m tall (ground, roofs, kerbs, parapets), slanted
 *  (|ny| > 0.35: roofs, ramps, stairs), under 1 m of footprint (lamp posts and other thin props), and with q.col (vertex RGBA, kind =
 *  alpha >> 4) terrain kinds 1-7 (grass .. water: steep slopes, banks and terrain skirts are ground, sim/ground.js walks them). */
function eachWall(P, I, q, t0, t1, fn) {
  const kx = 1 / q.qxz, ky = 1 / q.qy, yo = q.yOff || 0, C = q.col;
  for (let t = t0; t < t1; t += 3) {
    if (C) { const k = C[I[t] * 4 + 3] >> 4; if (k >= 1 && k <= 7) continue; }
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ya = P[a + 1] * ky + yo, yb = P[b + 1] * ky + yo, yc = P[c + 1] * ky + yo;
    const y0 = Math.min(ya, yb, yc), y1 = Math.max(ya, yb, yc); if (y1 - y0 < 1.5) continue;
    const ax = P[a] * kx, az = P[a + 2] * kx, bx = P[b] * kx, bz = P[b + 2] * kx, cx = P[c] * kx, cz = P[c + 2] * kx;
    const ux = bx - ax, uy = yb - ya, uz = bz - az, vx = cx - ax, vy = yc - ya, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (Math.abs(ny) > 0.35 * Math.hypot(nx, ny, nz)) continue;
    // the wall's footprint is a segment: the two vertices furthest apart in xz
    const lab = Math.hypot(ux, uz), lac = Math.hypot(vx, vz), lbc = Math.hypot(cx - bx, cz - bz), L = Math.max(lab, lac, lbc);
    if (L < 1) continue;
    const [px, pz, qx, qz] = L === lab ? [ax, az, bx, bz] : L === lac ? [ax, az, cx, cz] : [bx, bz, cx, cz];
    // the triangle in its own vertical plane (w along the footprint, y): its height span at each w, so sloped tops / bottoms
    // (stair stringers, ramp walls, gables) are not flattened to the triangle's extremes
    const ex = (qx - px) / L, ez = (qz - pz) / L, W = [(ax - px) * ex + (az - pz) * ez, (bx - px) * ex + (bz - pz) * ez, (cx - px) * ex + (cz - pz) * ez], Y = [ya, yb, yc];
    fn(px, pz, ex, ez, L, w => {
      let lo = Infinity, hi = -Infinity;
      for (let e = 0; e < 3; e++) { const w0 = W[e], w1 = W[(e + 1) % 3]; if ((w - w0) * (w - w1) > 1e-9) continue; const flat = Math.abs(w1 - w0) < 1e-6, y = flat ? Math.max(Y[e], Y[(e + 1) % 3]) : Y[e] + (Y[(e + 1) % 3] - Y[e]) * (w - w0) / (w1 - w0); lo = Math.min(lo, flat ? Math.min(Y[e], Y[(e + 1) % 3]) : y); hi = Math.max(hi, y); }
      return hi < lo ? [y0, y1] : [lo, hi];   // numerical miss at an end: whole span
    }, W, nz * ex - nx * ez);
  }
}

/**
 * pure: positions + indices -> fills G (n*n wall-top heights, 0 = no wall) and B (wall bottoms, valid where G > 0) for triangles [t0, t1).
 * Footprints are rasterized 4-connected (a diagonal step also marks the corner cell). Camera / helicopter only (coarse on purpose).
 */
export function wallGrid(P, I, S, res = 1, q = { qxz: 1, qy: 1, yOff: 0 }, G = null, t0 = 0, t1 = I.length, B = null) {
  const n = Math.round(S / res); G ||= new Float32Array(n * n);
  const mark = (u, v, top, bot) => { if (u < 0 || v < 0 || u >= n || v >= n) return; const k = v * n + u; if (B && (!G[k] || B[k] > bot)) B[k] = bot; if (G[k] < top) G[k] = top; };
  eachWall(P, I, q, t0, t1, (px, pz, ex, ez, L, sec) => {
    const k = Math.ceil(L / (res * 0.5)); let pu = null, pv = 0;
    for (let s = 0; s <= k; s++) {
      const w = L * s / k, [lo, hi] = sec(w), u = Math.floor((px + ex * w) / res), v = Math.floor((pz + ez * w) / res);
      if (pu !== null && u !== pu && v !== pv) mark(u, pv, hi, lo);
      mark(u, v, hi, lo); pu = u; pv = v;
    }
  });
  return G;
}

export const BUCKET = 4;
/** pure: the exact wall footprints of a cell (cell-local metres) as pieces <= 1 m: { s: Float32Array [x0, z0, x1, z1, lo, hi] per piece
 *  (its drawn face looks to the left of x0 -> x1: along (z0 - z1, x1 - x0)),
 *  bx, bz, nx, nz (bucket grid origin and size, BUCKET m), st: Uint32Array (bucket -> first index in ix, CSR), ix: Uint32Array }, or null */
export function wallSegs(P, I, q = { qxz: 1, qy: 1, yOff: 0 }) {
  const s = [];
  eachWall(P, I, q, 0, I.length, (px, pz, ex, ez, L, sec, W, front) => {
    const k = Math.ceil(L), cut = W.filter(w => w > 1e-6 && w < L - 1e-6);   // the span is piecewise linear in w, kinks at the vertices
    for (let p = 0; p < k; p++) {
      const w0 = L * p / k, w1 = L * (p + 1) / k; let lo = Infinity, hi = -Infinity;
      for (const w of [w0, w1, ...cut.filter(w => w > w0 && w < w1)]) { const [a, b] = sec(w); lo = Math.min(lo, a); hi = Math.max(hi, b); }
      if (front >= 0) s.push(px + ex * w0, pz + ez * w0, px + ex * w1, pz + ez * w1, lo, hi);   // stored so the drawn face looks left of x0 -> x1
      else s.push(px + ex * w1, pz + ez * w1, px + ex * w0, pz + ez * w0, lo, hi);
    }
  });
  if (!s.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < s.length; k += 6) { x0 = Math.min(x0, s[k], s[k + 2]); x1 = Math.max(x1, s[k], s[k + 2]); z0 = Math.min(z0, s[k + 1], s[k + 3]); z1 = Math.max(z1, s[k + 1], s[k + 3]); }
  const bx = Math.floor(x0 / BUCKET) * BUCKET, bz = Math.floor(z0 / BUCKET) * BUCKET, nx = Math.floor((x1 - bx) / BUCKET) + 1, nz = Math.floor((z1 - bz) / BUCKET) + 1;
  const range = (k, f) => { const u0 = Math.floor((Math.min(s[k], s[k + 2]) - bx) / BUCKET), u1 = Math.floor((Math.max(s[k], s[k + 2]) - bx) / BUCKET), v0 = Math.floor((Math.min(s[k + 1], s[k + 3]) - bz) / BUCKET), v1 = Math.floor((Math.max(s[k + 1], s[k + 3]) - bz) / BUCKET); for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) f(v * nx + u); };
  const st = new Uint32Array(nx * nz + 1);
  for (let k = 0; k < s.length; k += 6) range(k, b => st[b + 1]++);
  for (let b = 0; b < nx * nz; b++) st[b + 1] += st[b];
  const fill = st.slice(0, -1), ix = new Uint32Array(st[nx * nz]);
  for (let k = 0; k < s.length; k += 6) range(k, b => { ix[fill[b]++] = k / 6; });
  return { s: new Float32Array(s), bx, bz, nx, nz, st, ix };
}

/** does the segment (a0, b0)-(a1, b1) cross the rectangle |a| <= hw, |b| <= hl? (Liang-Barsky) */
function segBox(a0, b0, a1, b1, hw, hl) {
  let t0 = 0, t1 = 1; const da = a1 - a0, db = b1 - b0;
  for (const [p, q] of [[-da, a0 + hw], [da, hw - a0], [-db, b0 + hl], [db, hl - b0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

export class Solid {
  /** cells: stream/cells.js (or a node loader) whose live cells carry walls = { top, bot, seg } (grid at `res` m, wallSegs) */
  constructor(cells, res = 1) { this.cells = cells; this.res = res; this.n = Math.round(cells.S / res); }
  /** grid index of (x, z) in its cell and the cell's walls, or null (cell not live) */
  cell(x, z) {
    const S = this.cells.S, c = this.cells.byKey.get(Math.floor(x / S) + ',' + Math.floor(z / S)), w = c?.walls; if (!w) return null;
    return [w, Math.min(this.n - 1, Math.floor((z - c.j * S) / this.res)) * this.n + Math.min(this.n - 1, Math.floor((x - c.i * S) / this.res))];
  }
  /** camera: solid height = max(ground, wall top) */
  at(x, z) { const g0 = this.cells.heightAt(x, z), r = this.cell(x, z); return r ? Math.max(g0, r[0].top[r[1]]) : g0; }
  /** calls fn(s, k, ox, oz) for every wall piece k (s: its cell's pieces, ox/oz: that cell's origin) whose bucket meets the square
   *  (x, z) +- r, in the 3 x 3 cells around (a building's walls go with the cell it was baked in, and may overhang it). fn true: stop */
  near(x, z, r, fn) {
    const S = this.cells.S, i0 = Math.floor(x / S), j0 = Math.floor(z / S);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      const g = this.cells.byKey.get(i + ',' + j)?.walls?.seg; if (!g) continue;
      const ox = i * S, oz = j * S, lx = x - ox - g.bx, lz = z - oz - g.bz;
      const u0 = Math.max(0, Math.floor((lx - r) / BUCKET)), u1 = Math.min(g.nx - 1, Math.floor((lx + r) / BUCKET)), v0 = Math.max(0, Math.floor((lz - r) / BUCKET)), v1 = Math.min(g.nz - 1, Math.floor((lz + r) / BUCKET));
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) { const b = v * g.nx + u; for (let e = g.st[b]; e < g.st[b + 1]; e++) if (fn(g.s, g.ix[e] * 6, ox, oz)) return true; }
    }
    return false;
  }
  /** movers: does a wall whose [bottom, top] overlaps (y0, y1) cross the body rectangle (half width hw across, half length hl along
   *  heading h: forward = (-sin h, -cos h), right = (cos h, -sin h)) centred at (x, z)? Only from the side its face is drawn on: the
   *  back of a single-sided face is not rendered, so it must not block (no invisible walls); a closed or two-faced wall blocks both ways. */
  hits(x, z, h, hw, hl, y0, y1) {
    const s = Math.sin(h), c = Math.cos(h);
    return this.near(x, z, Math.hypot(hw, hl), (g, k, ox, oz) => {
      if (g[k + 5] <= y0 || g[k + 4] >= y1) return false;
      const dx0 = g[k] + ox - x, dz0 = g[k + 1] + oz - z, dx1 = g[k + 2] + ox - x, dz1 = g[k + 3] + oz - z;
      if (dx0 * dz1 - dz0 * dx1 < -0.02) return false;   // centre behind the face: (centre - p0) . (z0 - z1, x1 - x0) < 0 (2 cm slack)
      return segBox(c * dx0 - s * dz0, -s * dx0 - c * dz0, c * dx1 - s * dz1, -s * dx1 - c * dz1, hw, hl);
    });
  }
  /** a wall spans part of (y0, y1) within r (default 0.05 m) of (x, z) */
  blocks(x, z, y0, y1, r = 0.05) { return this.hits(x, z, 0, r, r, y0, y1); }
}
