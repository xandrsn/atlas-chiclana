import { R, K, toLocal } from './geo.js';

// Madrid (relief x3): the ~7 m DEM tilts and ripples every carriageway. Before the buildings / terrain / roads read the heightfield, level it under each
// drivable at-grade road to that road's own longitudinally smoothed profile: big avenues use a +-90 m window (Castellana, Prado, Alcalá, Gran Vía, Princesa
// come out flat across and even along), ordinary streets +-20 m (the hill stays - Cuesta de Moyano still climbs - but the cross-tilt and bumps go).
// Every DEM cell takes the profile of its NEAREST road, so junctions agree; the edit fades back to the untouched relief over BANK metres.
const CLS = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)(_link)?$/, BIG = /^(motorway|trunk|primary|secondary)/, STEP = 5, BANK = 9, PASSES = 8;
/** robust ground level: MEDIAN of the DEM over a disc (centre + two rings). On a slope it equals the centre height; a narrow underpass trench, ramp cut or
 *  embankment beside / under the road (x3 relief turns a 6 m underpass into an 18 m canyon) is ignored - the tunnels are drawn by underground.js from grade. */
const _s = new Float64Array(19);
function ground(hf, x, z, r) {
  _s[0] = hf.height(x, z);
  for (let k = 0; k < 6; k++) { const a = k * 1.0472; _s[1 + k] = hf.height(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5); }
  for (let k = 0; k < 12; k++) { const a = k * 0.5236 + 0.26; _s[7 + k] = hf.height(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  return _s.sort()[9];
}
export function levelRoads(hf, osm) {
  const W = hf.W, H = hf.H, g = hf.grid, cell = hf.s * K, key = new Float32Array(W * H).fill(1e9), tgt = new Float32Array(W * H);
  const U = x => (x / K + hf._mx0 + Math.PI * R) / hf.s - hf.tx0 * 256 - 0.5, V = z => (Math.PI * R - hf._my0 + z / K) / hf.s - hf.ty0 * 256 - 0.5;
  let roads = 0;
  for (const r of osm.roads) {
    if (r.b || r.u || !(r.d ? CLS.test(r.h) : r.h === 'pedestrian')) continue;   // + pedestrian streets (Sol, Preciados, Cuesta de Moyano): no lumps underfoot
    const P = [];
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const [ax, az] = toLocal(r.p[i], r.p[i + 1]), [bx, bz] = toLocal(r.p[i + 2], r.p[i + 3]), m = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / STEP));
      for (let k = i ? 1 : 0; k <= m; k++) P.push(ax + (bx - ax) * k / m, az + (bz - az) * k / m);
    }
    const m = P.length / 2; if (m < 2) continue;
    // moving average over the profile extended e samples past both ends along the end tangents (a way that continues straight into the next one gets the same height at the shared node)
    const big = BIG.test(r.h), rad = big ? 45 : 14, e = Math.round((big ? 90 : 20) / STEP), S = new Float64Array(m + 2 * e + 1);
    const at = i => {
      if (i >= 0 && i < m) return ground(hf, P[2 * i], P[2 * i + 1], rad);
      const j = i < 0 ? 0 : m - 1, o = i < 0 ? 1 : m - 2, dx = P[2 * j] - P[2 * o], dz = P[2 * j + 1] - P[2 * o + 1], l = Math.hypot(dx, dz) || 1, d = (i < 0 ? -i : i - m + 1) * STEP;
      return ground(hf, P[2 * j] + dx / l * d, P[2 * j + 1] + dz / l * d, rad);
    };
    for (let i = -e; i < m + e; i++) S[i + e + 1] = S[i + e] + at(i);
    const Y = i => (S[i + 2 * e + 1] - S[i]) / (2 * e + 1);
    const flat = Math.max(r.w || 0, 6.8) / 2 + cell - (r.d ? 0 : 6), pad = (flat + BANK) / cell;   // (pedestrian ways: 6 m narrower, so a carriageway beside them keeps its own cells)  // + one DEM cell: the bilinear surface is then level over the whole carriageway
    for (let i = 0; i + 1 < m; i++) {
      const au = U(P[2 * i]), av = V(P[2 * i + 1]), du = U(P[2 * i + 2]) - au, dv = V(P[2 * i + 3]) - av, l2 = du * du + dv * dv || 1, y0 = Y(i), y1 = Y(i + 1);
      const i0 = Math.max(0, Math.floor(Math.min(au, au + du) - pad)), i1 = Math.min(W - 1, Math.ceil(Math.max(au, au + du) + pad)), j0 = Math.max(0, Math.floor(Math.min(av, av + dv) - pad)), j1 = Math.min(H - 1, Math.ceil(Math.max(av, av + dv) + pad));
      for (let j = j0; j <= j1; j++) for (let c = i0; c <= i1; c++) {
        let t = ((c - au) * du + (j - av) * dv) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(c - au - du * t, j - av - dv * t) * cell - flat, o = j * W + c;
        if (d < key[o]) { key[o] = d; tgt[o] = y0 + (y1 - y0) * t; }
      }
    }
    roads++;
  }
  // parallel carriageways of one avenue (and the streets joining them) each got their own profile: relax the target among the cells that lie ON a carriageway,
  // so a multi-lane avenue is one level sheet instead of a staircase. Streets a block apart do not touch (their flat zones are not adjacent) and keep their levels.
  for (let pass = 0, tmp = new Float32Array(W * H); pass < PASSES; pass++) {
    for (let j = 1; j < H - 1; j++) for (let c = 1, o = j * W + 1; c < W - 1; c++, o++) {
      if (key[o] > 0) { tmp[o] = tgt[o]; continue; }
      let n = 0, a = 0; for (let dj = -W; dj <= W; dj += W) for (let dc = -1; dc <= 1; dc++) if (key[o + dj + dc] <= 0) { a += tgt[o + dj + dc]; n++; }
      tmp[o] = a / n;
    }
    tgt.set(tmp);
  }
  let cells = 0;
  for (let o = 0; o < g.length; o++) if (key[o] < BANK) { const t = Math.max(0, key[o]) / BANK, s = t * t * (3 - 2 * t); g[o] = tgt[o] + (g[o] - tgt[o]) * s; cells++; }
  return { roads, cells };
}
