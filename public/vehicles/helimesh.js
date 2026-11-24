// Helicopters for data/vehicles/<id>.json with kind "heli" (body.type = a key of TYPES): real proportions, own mesh. The fuselage and the
// engine cowling are lofts of superellipse sections; windows, stripes, doors and panel lines are patches laid on that surface.
// The main rotor is its own geometry (buildRotor) so it can spin. Frame as carmesh.js: x right, y up, z forward, origin on the ground under
// the mast. Same Builder / material / paint channel; carmesh.js gives it smooth normals (creased).
import { Builder, LAMP } from '../lowpoly.js';

const GLASS = '#26323c', TRIM = '#2a2b2d', METAL = '#8d9194', BLADE = '#303235', LIGHT = '#fff3cc', TAIL = '#b3121a', GREEN = '#1f8a46', SEAM = '#1d1e20', SOOT = '#1a1918';
const v = (x, y, z) => ({ x, y, z }), rad = Math.PI / 180;

// hull / cowl: sections [z, centre y, half width, height above it, below it, squareness (2 = ellipse)] from nose to tail.
// Points on them are [s, angle]: s = section number (fractional), angle 0 = side, 90 = top, -90 = bottom.
const TYPES = {
  r44: {
    mast: 3.15, blades: 2, chord: 0.26, skid: [-1.15, 1.35], cross: [-0.75, 0.75], belly: 0.5,
    hull: [[2.4, 1.0, 0.02, 0.02, 0.02, 2], [2.34, 1.0, 0.26, 0.22, 0.2, 2.1], [2.12, 1.03, 0.46, 0.44, 0.36, 2.3], [1.65, 1.1, 0.6, 0.72, 0.5, 2.5], [1.0, 1.15, 0.64, 0.88, 0.6, 2.8], [0.2, 1.16, 0.64, 0.9, 0.62, 2.9],
      [-0.6, 1.2, 0.62, 0.82, 0.62, 2.7], [-1.2, 1.28, 0.52, 0.64, 0.58, 2.5], [-1.75, 1.42, 0.34, 0.4, 0.44, 2.3], [-2.3, 1.56, 0.16, 0.18, 0.2, 2], [-4, 1.6, 0.115, 0.115, 0.115, 2], [-5.85, 1.64, 0.09, 0.09, 0.09, 2], [-5.95, 1.64, 0.02, 0.02, 0.02, 2]],
    cowl: [[0.5, 2.0, 0.03, 0.05, 0.1, 2], [0.36, 2.02, 0.1, 0.4, 0.2, 2], [0.1, 2.02, 0.14, 0.92, 0.2, 2.2], [-0.3, 2.0, 0.15, 0.9, 0.2, 2.2], [-0.6, 1.95, 0.1, 0.5, 0.2, 2], [-0.8, 1.9, 0.02, 0.1, 0.1, 2]],
    glass: [[[1.1, 8], [3.1, 4], [3.75, 74], [1.1, 82]], [[3.3, 4], [4.35, 4], [4.35, 52], [3.75, 54]], [[4.5, 4], [5.5, 4], [5.4, 50], [4.5, 52]]],
    door: [[[3.15, -48], [4.42, -48], [4.42, 58], [3.7, 60]], [[4.45, -48], [5.6, -48], [5.6, 56], [4.45, 58]]],
    stripes: [[[2.2, -14], [8.6, -2], [8.6, 12], [2.6, -4]]], panels: [[[6.2, -40], [7.4, -30], [7.4, 40], [6.2, 40]]],
    boomFrom: 9, fin: [[[-5.5, 1.66], [-5.75, 1.66], [-6.35, 2.55], [-6.05, 2.55]], [[-5.45, 1.62], [-5.8, 1.62], [-6.1, 0.95], [-5.85, 0.95]]], stab: { z: [-5.6, -5.2], x: [0.0, 1.0], y: 1.64 },
    tail: { z: -5.88, y: 1.64, x: -0.22, r: 0.74, n: 2 },
  },
  as350: {
    mast: 3.06, blades: 3, chord: 0.35, skid: [-1.25, 2.15], cross: [-0.75, 1.15], belly: 0.56,
    hull: [[3.25, 1.0, 0.02, 0.02, 0.02, 2], [3.18, 1.0, 0.34, 0.22, 0.2, 2.2], [2.95, 1.04, 0.62, 0.42, 0.33, 2.4], [2.5, 1.12, 0.83, 0.72, 0.48, 2.6], [1.9, 1.2, 0.92, 0.9, 0.58, 2.9], [1.1, 1.25, 0.935, 0.97, 0.66, 3.1], [0, 1.25, 0.935, 0.98, 0.68, 3.1],
      [-0.9, 1.28, 0.9, 0.94, 0.66, 2.9], [-1.7, 1.35, 0.74, 0.74, 0.56, 2.6], [-2.5, 1.5, 0.45, 0.44, 0.38, 2.4], [-3.4, 1.62, 0.29, 0.27, 0.26, 2.2], [-5, 1.75, 0.21, 0.2, 0.2, 2], [-7, 1.9, 0.14, 0.14, 0.14, 2], [-7.15, 1.91, 0.02, 0.02, 0.02, 2]],
    cowl: [[1.15, 2.08, 0.03, 0.03, 0.05, 2], [0.9, 2.1, 0.34, 0.26, 0.2, 2.4], [0.3, 2.14, 0.46, 0.46, 0.3, 2.6], [-0.6, 2.14, 0.5, 0.5, 0.4, 2.6], [-1.6, 2.08, 0.44, 0.44, 0.45, 2.5], [-2.35, 1.98, 0.31, 0.32, 0.4, 2.3], [-2.75, 1.95, 0.2, 0.2, 0.3, 2]],
    glass: [[[1.1, 6], [3.2, 2], [4.0, 72], [1.1, 84]], [[1.5, -14], [3.0, -16], [2.9, -56], [1.6, -58]], [[3.45, 2], [4.88, 2], [4.88, 46], [4.2, 48]], [[5.08, 2], [6.0, 2], [6.0, 46], [5.08, 46]], [[6.16, 4], [6.8, 4], [6.6, 40], [6.16, 44]]],
    door: [[[3.3, -50], [4.98, -50], [4.98, 54], [4.15, 56]], [[4.98, -50], [6.08, -50], [6.08, 54], [4.98, 54]]],
    stripes: [[[2.0, -10], [9.2, -24], [9.2, 0], [2.3, -2]], [[9.6, 20], [11.6, 20], [11.6, 60], [9.6, 60]]], panels: [[[6.9, -45], [8.0, -40], [8.0, 20], [6.9, 10]], [[8.2, -30], [8.8, -25], [8.8, 25], [8.2, 25]]],
    boomFrom: 10, exhaust: [[0, 2.0, -2.6, -3.15, 0.2]], fin: [[[-6.3, 1.9], [-7.0, 1.9], [-7.6, 3.0], [-7.2, 3.0]], [[-6.45, 1.85], [-6.95, 1.85], [-7.25, 1.1], [-6.95, 1.1]]], stab: { z: [-5.2, -4.75], x: [-1.25, 1.25], y: 1.74 },
    tail: { z: -6.67, y: 1.9, x: 0.32, r: 0.93, n: 2 },
  },
  ec135: {
    mast: 3.3, blades: 4, chord: 0.29, skid: [-1.35, 2.0], cross: [-0.9, 1.05], belly: 0.52,
    hull: [[3.1, 0.95, 0.02, 0.02, 0.02, 2], [3.04, 0.96, 0.3, 0.24, 0.2, 2.2], [2.8, 1.0, 0.56, 0.5, 0.36, 2.4], [2.3, 1.1, 0.75, 0.85, 0.5, 2.6], [1.65, 1.2, 0.82, 1.0, 0.62, 3], [0.9, 1.25, 0.83, 1.05, 0.68, 3.3], [-0.2, 1.25, 0.83, 1.05, 0.68, 3.3],
      [-1.2, 1.28, 0.8, 1.0, 0.66, 3], [-1.8, 1.5, 0.66, 0.78, 0.6, 2.7], [-2.4, 1.8, 0.42, 0.46, 0.42, 2.4], [-3.2, 1.95, 0.27, 0.28, 0.27, 2.2], [-4.6, 2.02, 0.23, 0.23, 0.23, 2], [-6.0, 2.06, 0.2, 0.22, 0.22, 2], [-6.2, 2.06, 0.02, 0.02, 0.02, 2]],
    cowl: [[1.35, 2.2, 0.03, 0.03, 0.05, 2], [1.1, 2.2, 0.4, 0.26, 0.2, 2.6], [0.5, 2.22, 0.62, 0.5, 0.3, 2.9], [-0.5, 2.22, 0.68, 0.56, 0.4, 2.9], [-1.3, 2.2, 0.62, 0.5, 0.45, 2.7], [-2.0, 2.15, 0.42, 0.36, 0.4, 2.4], [-2.45, 2.1, 0.16, 0.2, 0.25, 2]],
    glass: [[[1.1, 4], [3.1, 2], [3.9, 74], [1.1, 84]], [[1.4, -14], [2.9, -14], [2.8, -54], [1.5, -56]], [[3.4, 2], [4.8, 2], [4.8, 50], [4.05, 52]], [[5.0, 2], [6.05, 2], [6.05, 50], [5.0, 50]], [[6.25, 4], [6.85, 4], [6.7, 46], [6.25, 48]]],
    door: [[[3.25, -50], [4.9, -50], [4.9, 58], [4.0, 60]], [[4.9, -50], [6.15, -50], [6.15, 58], [4.9, 58]]],
    stripes: [[[1.8, -12], [8.8, -40], [8.8, -14], [2.1, -4]], [[9.6, -20], [12.2, -20], [12.2, 20], [9.6, 20]]], panels: [[[7.0, -40], [7.8, -40], [7.8, 25], [7.0, 25]]],
    boomFrom: 10, exhaust: [[-0.34, 2.36, -1.75, -2.25, 0.15], [0.34, 2.36, -1.75, -2.25, 0.15]], fin: [[[-5.8, 2.6], [-6.7, 2.6], [-7.0, 3.55], [-6.6, 3.55]], [[-6.1, 1.7], [-6.8, 1.7], [-6.9, 1.2], [-6.6, 1.2]]],
    stab: { z: [-5.35, -4.9], x: [-1.28, 1.28], y: 2.05, plates: true }, fenestron: { z: -6.45, y: 2.05, r: 0.62, n: 10 },
  },
};
export const heliDims = spec => TYPES[spec.body.type];

/** Catmull-Rom through the sections -> section at s */
function section(S, s) {
  const i = Math.max(0, Math.min(S.length - 2, Math.floor(s))), t = s - i, a = S[Math.max(0, i - 1)], b = S[i], c = S[i + 1], d = S[Math.min(S.length - 1, i + 2)];
  return b.map((_, k) => { const y = 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t ** 3); return k > 1 && k < 5 ? Math.max(0.015, y) : y; });
}
const pw = (x, e) => Math.sign(x) * Math.abs(x) ** (2 / e);
function surf(S, s, deg, off = 0, sx = 1) {
  const at = (s, deg) => { const [z, y, w, up, lo, e] = section(S, s), c = Math.cos(deg * rad), n = Math.sin(deg * rad); return v(w * pw(c, e), y + (n > 0 ? up : lo) * pw(n, e), z); };
  const p = at(s, deg);
  if (off) {
    const h = 0.04, a = at(Math.min(s + h, S.length - 1), deg), b = at(Math.max(s - h, 0), deg), c = at(s, deg + 2), d = at(s, deg - 2);
    const u = [a.x - b.x, a.y - b.y, a.z - b.z], w = [c.x - d.x, c.y - d.y, c.z - d.z], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const o = off / (Math.hypot(...n) || 1) * (n[0] * p.x + n[1] * (p.y - section(S, s)[1]) < 0 ? -1 : 1); p.x += n[0] * o; p.y += n[1] * o; p.z += n[2] * o;
  }
  p.x *= sx; return p;
}
function loft(B, S, n, sub) {
  const N = (S.length - 1) * sub, ring = k => Array.from({ length: n }, (_, i) => surf(S, k / sub, (i + 0.5) / n * 360));
  let A = ring(0); const ctr = k => { const c = section(S, k / sub); return v(0, c[1], c[0]); };
  B.ctr = ctr(1); B.poly(A);
  for (let k = 0; k < N; k++) {
    const C = ring(k + 1), a = ctr(k), b = ctr(k + 1); B.ctr = v(0, (a.y + b.y) / 2, (a.z + b.z) / 2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.poly([A[i], A[j], C[j], C[i]]); }
    A = C;
  }
  B.ctr = ctr(N - 1); B.poly(A); B.ctr = null;
}
/** region of the surface, four [s, angle] corners, lifted by off; both sides. grow: metres added (window frames) */
function patch(B, S, q, off, nu = 5, nv = 5, grow = 0) {
  const L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], m = [0, 1].map(k => q.reduce((t, p) => t + p[k], 0) / 4), g = q.map(p => [p[0] + Math.sign(p[0] - m[0]) * grow, p[1] + Math.sign(p[1] - m[1]) * grow * 45]);
  for (const sx of [-1, 1]) {
    const P = Array.from({ length: nu + 1 }, (_, i) => Array.from({ length: nv + 1 }, (_, j) => surf(S, ...L(L(g[0], g[1], i / nu), L(g[3], g[2], i / nu), j / nv), off, sx))), c = section(S, m[0]); B.ctr = v(0, c[1], c[0]);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) B.poly([P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]);
    B.ctr = null;
  }
}
/** line on the surface through [s, angle] points, w m wide; both sides */
function seam(B, S, pts, w = 0.014, n = 6) {
  for (const sx of [-1, 1]) for (let k = 0; k + 1 < pts.length; k++) {
    const P = Array.from({ length: n + 1 }, (_, i) => [0, 1].map(j => pts[k][j] + (pts[k + 1][j] - pts[k][j]) * i / n)), T = P.map(p => surf(S, ...p, 0.008, sx)), U = P.map(p => surf(S, ...p, 0.1, sx));
    for (let i = 0; i < n; i++) {
      const a = T[i], b = T[i + 1], d = [b.x - a.x, b.y - a.y, b.z - a.z], u = [U[i].x - a.x, U[i].y - a.y, U[i].z - a.z], c = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]], l = w / 2 / (Math.hypot(...c) || 1), o = p => [v(p.x + c[0] * l, p.y + c[1] * l, p.z + c[2] * l), v(p.x - c[0] * l, p.y - c[1] * l, p.z - c[2] * l)];
      const [a1, a2] = o(a), [b1, b2] = o(b); B.quad(a1, b1, b2, a2, v(a.x - u[0], a.y - u[1], a.z - u[2]));
    }
  }
}
/** round bar through points, radius r, n sides */
function tube(B, pts, r, n = 8) {
  const ring = (p, d) => { const l = Math.hypot(d.x, d.y, d.z), k = [d.x / l, d.y / l, d.z / l], h = Math.abs(k[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], a = [k[1] * h[2] - k[2] * h[1], k[2] * h[0] - k[0] * h[2], k[0] * h[1] - k[1] * h[0]], m = Math.hypot(...a), e = a.map(x => x / m), f = [k[1] * e[2] - k[2] * e[1], k[2] * e[0] - k[0] * e[2], k[0] * e[1] - k[1] * e[0]];
    return Array.from({ length: n }, (_, i) => { const t = i / n * 2 * Math.PI, c = r * Math.cos(t), s = r * Math.sin(t); return v(p.x + e[0] * c + f[0] * s, p.y + e[1] * c + f[1] * s, p.z + e[2] * c + f[2] * s); }); };
  const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z), mid = (a, b) => v((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), R = pts.map((p, i) => ring(p, sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])));
  for (let k = 0; k + 1 < pts.length; k++) { B.ctr = mid(pts[k], pts[k + 1]); for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.poly([R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]]); } }
  for (const [k, o] of [[0, 1], [pts.length - 1, pts.length - 2]]) { B.ctr = pts[o]; B.poly(R[k]); }
  B.ctr = null;
}

export function heli(B, spec, lod) {
  const D = heliDims(spec), b = spec.body, paint = [spec.palette[0], true], second = b.second || '#f1efe8', sk = spec.dims.skidTrack / 2, H = D.hull, C = D.cowl, n = lod ? 8 : 24;
  B.style(...paint); loft(B, H, n, lod ? 1 : 2); loft(B, C, lod ? 6 : 16, lod ? 1 : 2);
  for (const q of lod ? D.glass.slice(0, 1) : D.glass) {   // black rubber round each pane
    if (!lod) { B.style(TRIM); patch(B, H, q, 0.008, 6, 6, 0.06); }
    B.style(GLASS, LAMP.glass); patch(B, H, q, 0.018, lod ? 1 : 6, lod ? 2 : 6);
  }
  if (!lod) {
    B.style(second); for (const q of D.stripes) patch(B, H, q, 0.012, 14, 2);
    B.style(SEAM);
    for (const d of D.door) { seam(B, H, [...d, d[0]]); seam(B, H, [[d[1][0] - 0.18, -6], [d[1][0] - 0.07, -6]], 0.05, 1); }   // door gaps and handles
    for (const p of D.panels) seam(B, H, [...p, p[0]], 0.01);
    for (let s = D.boomFrom + 0.5; s < H.length - 2; s += 0.5) seam(B, H, [[s, -88], [s, 88]], 0.01);   // boom joints
    for (const s of [1.5, 2.5, 3.5]) seam(B, C, [[s, 0], [s, 88]], 0.01);
    B.style(SOOT); patch(B, C, [[1.45, 18], [2.2, 18], [2.2, 50], [1.45, 50]], 0.01, 2, 3);           // air intakes with slats
    B.style(METAL); for (const g of [24, 31, 38, 45]) seam(B, C, [[1.5, g], [2.15, g]], 0.012, 2);
    B.style(SOOT); for (const g of [20, 30, 40]) seam(B, C, [[3.0, g], [3.45, g]], 0.03, 2);          // cooling louvres
  }
  B.style(TRIM); tube(B, [v(0, Math.max(...C.map(c => c[1] + c[3])) - 0.1, 0), v(0, D.mast, 0)], 0.09, lod ? 4 : 10);   // mast
  for (const [x, y, z0, z1, r] of D.exhaust || []) { B.style(METAL); tube(B, [v(x, y, z0), v(x, y + 0.04, z1)], r, lod ? 5 : 12); B.style(SOOT); if (!lod) tube(B, [v(x, y + 0.04, z1 - 0.01), v(x, y + 0.04, z1 - 0.015)], r * 0.85, 12); }
  B.style(...paint); for (const f of D.fin) B.prism(f, () => 0.045);
  const st = D.stab; B.box(st.x[0], st.x[1], st.y - 0.025, st.y + 0.025, st.z[0], st.z[1], undefined, 1, 0.8);
  if (st.plates) for (const sx of [-1, 1]) B.prism([[st.z[1] + 0.1, st.y - 0.35], [st.z[1], st.y + 0.45], [st.z[0] - 0.1, st.y + 0.45], [st.z[0] - 0.15, st.y - 0.35]], () => 0.025, undefined, undefined, sx * st.x[1]);
  if (D.fin[0] && !lod) { B.style(second); const [a, , c, d] = D.fin[0], k = t => [[a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t], [D.fin[0][1][0] + (c[0] - D.fin[0][1][0]) * t, a[1] + (c[1] - a[1]) * t]], [p, q] = k(0.62), [r, s] = k(0.8); B.prism([p, q, s, r], () => 0.052); }   // band on the fin
  if (D.fenestron) {
    const f = D.fenestron, N = lod ? 8 : 24; B.style(...paint); B.cylX(0, f.y, f.z, f.r, 0.36, N);
    for (const sx of lod ? [] : [-1, 1]) {
      const X = sx * 0.188, ring = (r, x) => Array.from({ length: N }, (_, i) => v(x, f.y + r * Math.cos(i / N * 2 * Math.PI), f.z + r * Math.sin(i / N * 2 * Math.PI)));
      B.style(SOOT); B.ctr = v(0, f.y, f.z); B.poly(ring(f.r * 0.8, X)); B.style(BLADE);
      for (let k = 0; k < f.n; k++) { const a = k / f.n * 2 * Math.PI, q = (r, d) => v(X + sx * 0.004, f.y + r * Math.cos(a + d), f.z + r * Math.sin(a + d)); B.style(METAL); B.poly([q(0.14, -0.25), q(0.14, 0.25), q(f.r * 0.78, 0.07), q(f.r * 0.78, -0.07)]); }
      B.style(TRIM); B.poly(ring(0.15, X + sx * 0.01)); B.ctr = null;
    }
  } else {
    const t = D.tail, sx = Math.sign(t.x); B.style(TRIM); tube(B, [v(0, t.y, t.z), v(t.x + sx * 0.05, t.y, t.z)], 0.06, lod ? 4 : 8); B.style(...paint); B.box(-0.12, 0.12, t.y - 0.13, t.y + 0.13, t.z - 0.18, t.z + 0.18);   // gearbox
    for (let k = 0; k < t.n; k++) {
      const a = k / t.n * 2 * Math.PI + 0.6, q = (r, w, x) => v(x, t.y + r * Math.cos(a) - w * Math.sin(a), t.z + r * Math.sin(a) + w * Math.cos(a));
      const seg = (r0, r1, c) => { B.style(c); B.hexa([q(r0, -0.07, t.x - 0.012), q(r0, -0.07, t.x + 0.012), q(r1, -0.07, t.x - 0.012), q(r1, -0.07, t.x + 0.012), q(r0, 0.07, t.x - 0.012), q(r0, 0.07, t.x + 0.012), q(r1, 0.07, t.x - 0.012), q(r1, 0.07, t.x + 0.012)]); };
      seg(0.04, t.r * 0.72, BLADE); seg(t.r * 0.72, t.r * 0.86, '#e9e7df'); seg(t.r * 0.86, t.r, '#b3261e');
    }
  }
  B.style(TRIM);
  for (const sx of [-1, 1]) {   // skids curved up at the front, on two arched cross tubes
    const [z0, z1] = D.skid, x = sx * sk, r = 0.045, P = lod ? [v(x, r, z0), v(x, r, z1)] : [v(x, r, z0), v(x, r, z1 - 0.35), v(x, r + 0.04, z1 - 0.15), v(x, r + 0.13, z1), v(x, r + 0.28, z1 + 0.12)];
    tube(B, P, r, lod ? 4 : 8);
    for (const z of D.cross) tube(B, lod ? [v(0, D.belly, z), v(x, r, z)] : [v(0, D.belly + 0.06, z), v(sx * (sk - 0.5), D.belly + 0.02, z), v(sx * (sk - 0.22), D.belly * 0.72, z), v(x, r, z)], 0.038, lod ? 4 : 8);
    if (!lod) B.box(x - 0.1, x + 0.1, D.belly * 0.62, D.belly * 0.62 + 0.03, 0.4, 1.0);   // step
  }
  B.style(LIGHT, LAMP.head); B.box(-0.11, 0.11, D.belly - 0.02, D.belly + 0.1, 1.5, 1.66);   // landing light
  const fz = D.fin[0][2]; B.style(TAIL, LAMP.tail); B.box(-0.05, 0.05, fz[1], fz[1] + 0.06, fz[0] + 0.1, fz[0] + 0.22);   // beacon
  if (lod) return;
  for (const [sx, c] of [[-1, TAIL], [1, GREEN]]) { B.style(c); const x = sx * (st.x[1] - 0.06); B.box(x - 0.04, x + 0.04, st.y + 0.02, st.y + 0.07, st.z[1] - 0.16, st.z[1] - 0.06); }   // navigation lights
  B.style(TRIM); tube(B, [v(0, D.belly + 0.1, -0.4), v(0, D.belly - 0.22, -0.55)], 0.012, 5); const top = surf(H, 4.6, 90); tube(B, [v(0.2, top.y - 0.05, top.z), v(0.2, top.y + 0.35, top.z - 0.12)], 0.01, 5);   // antennas
  tube(B, [v(0, H[2][1] - H[2][4] * 0.6, H[2][0]), v(0, H[2][1] - H[2][4] * 0.6, H[0][0] + 0.08)], 0.014, 5);   // pitot
}

/** main rotor: blades round the hub, centred on the mast (spin it with mesh.rotation.y) */
export function buildRotor(spec) {
  const B = new Builder();
  rotor(B, spec);
  return B.geometry();
}
export function rotor(B, spec) {
  const R = spec.dims.rotor / 2, { mast: m, blades: n, chord } = heliDims(spec);
  for (let k = 0; k < n; k++) {
    const a = k * 2 * Math.PI / n, c = Math.cos(a), s = Math.sin(a), P = (r, w, y) => v(c * r - s * w, y, s * r + c * w), y = r => m + 0.05 + 0.022 * r;   // blades cone up a little
    const seg = (r0, r1, w0, w1, t, col) => { B.style(col); B.hexa([0, 1, 2, 3, 4, 5, 6, 7].map(i => { const r = i & 1 ? r1 : r0, w = i & 1 ? w1 : w0; return P(r, (i & 4 ? 0.65 : -0.35) * w, y(r) + (i & 2 ? t : -t) * (i & 4 ? 0.3 : 1)); })); };
    seg(0.1, 0.62, 0.12, 0.12, 0.035, METAL); seg(0.58, 0.95, 0.14, chord, 0.022, BLADE); seg(0.95, R - 0.55, chord, chord, 0.02, BLADE); seg(R - 0.55, R - 0.12, chord, chord, 0.02, '#d9a520'); seg(R - 0.12, R, chord, chord * 0.75, 0.016, BLADE);
    B.style(TRIM); tube(B, [P(0.3, 0.12, m - 0.22), P(0.36, 0.12, m + 0.04)], 0.016, 5);   // pitch link
  }
  B.style(METAL); tube(B, [v(0, m - 0.26, 0), v(0, m - 0.2, 0)], 0.26, 12); B.style(TRIM); tube(B, [v(0, m - 0.06, 0), v(0, m + 0.12, 0)], 0.17, 12); tube(B, [v(0, m + 0.12, 0), v(0, m + 0.18, 0)], 0.09, 10);
}
