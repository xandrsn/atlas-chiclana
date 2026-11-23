// Tram corridor keep-out test (data/tram/tram.json): keep(x, z, pad) is true within the clear width of the track (and of the platform zone at stops).
// Used by world.js to skip sidewalks, trees, walls, lamp posts etc. that would stand on the rails.
const CELL = 12, R_TRACK = 3.3, R_STOP = 6.8;
export function makeCorridor(T) {
  const stn = T.stations.map(s => Math.max(18, s.sA)), grid = new Map(), kB = (() => { const L = P => { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return l; }; return L(T.B) / L(T.A); })();
  const add = (P, s0, s1, scale) => { let cum = 0; for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let q = 0; q < L; q += 3) { const s = (cum + q) / scale; if (s < s0 || s > s1) continue; const x = a[0] + (b[0] - a[0]) * q / L, z = a[1] + (b[1] - a[1]) * q / L, k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL), r = stn.some(c => Math.abs(s - c) < 24) ? R_STOP : R_TRACK; (grid.get(k) || grid.set(k, []).get(k)).push(x, z, r); } cum += L; } };
  add(T.A, 0, 1e9, 1); for (const [a, b] of T.zones) add(T.B, a, b, kB);
  for (const e of T.extra || []) add(e, 0, 1e9, 1);
  return (x, z, pad = 0) => { const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) { const l = grid.get(i + ',' + j); if (l) for (let q = 0; q < l.length; q += 3) if (Math.hypot(l[q] - x, l[q + 1] - z) < l[q + 2] + pad) return true; }
    return false; };
}
