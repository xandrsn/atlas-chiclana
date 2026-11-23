// v2 trees: original low-poly faceted species, expanded per cell in the cell worker (stream/worker.js) into ONE merged mesh with vertex colours
// (one draw call per cell, the tree material). Pure module (no three.js): the bake (scripts/bake/plugins/trees.mjs) imports SP / SPW from here.
// Baked tree record (scripts/bake_cells.mjs): cell-relative x, absolute ground y, cell-relative z, species * SPW + crown radius (m).
export const SP = { BROAD: 0, PINE: 1, CYPRESS: 2, PALM: 3, BUSH: 4, CONIFER: 5, PLANE: 6, OLIVE: 7, ORANGE: 8, JACARANDA: 9, EUCALYPT: 10,
  WHEAT: 11, SUNFLOWER: 12, VINE: 13, LENTISCO: 14, RETAMA: 15, PALMITO: 16 };   // 11..16: ground-level crop and scrub vegetation (scripts/bake/plugins/crops.mjs), same merged mesh
export const SPW = 64;   // old cells (radius only, < 64) decode as BROAD

// ---- templates: triangles in metres for a crown radius of R0; sMin..sMax clamp the per-tree scale r / R0
const JIT = [1, 0.86, 1.08, 0.93, 1.12, 0.9, 1.04, 0.95];   // fixed radius wobble per ring vertex: organic facets, same every bake
/** lathe: profile [[y, r], ...] bottom to top, n sides; r = 0 is an apex. Triangles wound outwards from the axis. */
function lathe(out, prof, n, col, rot = 0, jit = true) {
  const ring = ([y, r], k) => { const P = []; for (let s = 0; s < n; s++) { const a = (s + (k & 1) * 0.5) / n * Math.PI * 2 + rot, q = r * (jit ? JIT[(s + k * 3) % 8] : 1); P.push([Math.cos(a) * q, y, Math.sin(a) * q]); } return P; };
  for (let k = 0; k + 1 < prof.length; k++) {
    const A = ring(prof[k], k), Bv = ring(prof[k + 1], k + 1), ym = (prof[k][0] + prof[k + 1][0]) / 2;
    for (let s = 0; s < n; s++) {
      const a0 = A[s], a1 = A[(s + 1) % n], b0 = Bv[s], b1 = Bv[(s + 1) % n];
      if (prof[k][1] > 0) tri(out, a0, a1, b0, col, ym);
      if (prof[k + 1][1] > 0) tri(out, a1, b1, b0, col, ym);
    }
  }
}
/** triangle with outward winding (normal away from the axis point at height ym); both = also the back face (thin palm fronds) */
function tri(out, a, b, c, col, ym, both) {
  const n = nrm(a, b, c), m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 - ym, (a[2] + b[2] + c[2]) / 3];
  if (both) { out.push({ p: [a, b, c], col }, { p: [a, c, b], col }); return; }
  out.push({ p: n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0 ? [a, b, c] : [a, c, b], col });
}
function nrm(a, b, c) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; }
function disc(out, r, n) { for (let s = 0; s < n; s++) { const a0 = s / n * Math.PI * 2, a1 = (s + 1) / n * Math.PI * 2; out.push({ p: [[0, 0.1, 0], [Math.cos(a1) * r, 0.1, Math.sin(a1) * r], [Math.cos(a0) * r, 0.1, Math.sin(a0) * r]], col: 'blob' }); } }

const T = [];
{ const t = []; disc(t, 2.3, 6); lathe(t, [[0, 0.3], [2.6, 0.2]], 3, 'trunk', 0, false); lathe(t, [[2.1, 0], [3.5, 2.6], [5.1, 2.1], [6.3, 0]], 6, 'leaf');
  T[SP.BROAD] = { R0: 2.6, sMin: 0.55, sMax: 2.0, tris: t, leaf: [[74, 110, 52], [66, 100, 46], [92, 118, 58], [84, 104, 44], [100, 112, 60]], trunk: [96, 74, 52] }; }
{ const t = []; disc(t, 2.8, 6); lathe(t, [[0, 0.34], [5.8, 0.17]], 3, 'trunk', 0.4, false); lathe(t, [[5.3, 0], [6.1, 3.4], [6.9, 2.5], [7.3, 0]], 6, 'leaf');   // pino piñonero: bare bole, parasol crown
  T[SP.PINE] = { R0: 3.4, sMin: 0.6, sMax: 1.45, lean: 0.06, tris: t, leaf: [[56, 88, 48], [62, 96, 52], [50, 82, 46], [68, 94, 50]], trunk: [124, 84, 60] }; }
{ const t = []; disc(t, 1.4, 5); lathe(t, [[0.2, 0], [3.4, 1.25], [7.4, 0.8], [10.4, 0]], 5, 'leaf');   // ciprés: tall closed spindle
  T[SP.CYPRESS] = { R0: 1.25, sMin: 0.7, sMax: 1.25, tris: t, leaf: [[38, 70, 44], [44, 76, 48], [34, 64, 40]], trunk: [80, 62, 46] }; }
{ const t = []; disc(t, 1.8, 6); lathe(t, [[0, 0.32], [3.5, 0.24], [7.2, 0.2]], 4, 'trunk', 0, false);   // palmera: ringed trunk, six folded fronds
  for (let f = 0; f < 6; f++) { const a = f / 6 * Math.PI * 2 + 0.3, c = Math.cos(a), s = Math.sin(a), at = (d, y, w) => [c * d - s * w, y, s * d + c * w];
    const base = at(0, 7.2, 0), tip = at(2.9, 6.1, 0), l = at(1.5, 7.6, 0.45), r = at(1.5, 7.6, -0.45);
    tri(t, base, l, tip, 'leaf', 0, true); tri(t, base, tip, r, 'leaf', 0, true); }
  T[SP.PALM] = { R0: 2.8, sMin: 0.75, sMax: 1.3, lean: 0.12, curve: true, tris: t, leaf: [[96, 124, 58], [108, 130, 62], [88, 116, 54]], trunk: [138, 118, 92] }; }
{ const t = []; disc(t, 1.3, 5); lathe(t, [[0, 0.85], [0.55, 1.2], [1.35, 0]], 5, 'leaf');   // arbusto / mata: low dome, no trunk
  T[SP.BUSH] = { R0: 1.2, sMin: 0.5, sMax: 1.6, tris: t, leaf: [[78, 108, 52], [92, 116, 58], [70, 96, 50], [104, 112, 62], [86, 100, 72]], trunk: [80, 62, 46] }; }
{ const t = []; disc(t, 2.2, 6); lathe(t, [[0, 0.26], [1.6, 0.2]], 3, 'trunk', 0, false); lathe(t, [[1.1, 0], [1.4, 2.4], [5.0, 0]], 6, 'leaf'); lathe(t, [[4.0, 0], [4.2, 1.7], [8.2, 0]], 6, 'leaf', 0.5);   // cedro / abeto: two tiers
  T[SP.CONIFER] = { R0: 2.4, sMin: 0.6, sMax: 1.4, tris: t, leaf: [[42, 78, 58], [50, 86, 64], [46, 74, 52]], trunk: [92, 70, 52] }; }
{ const t = []; disc(t, 3.4, 7); lathe(t, [[0, 0.34], [2.8, 0.24]], 4, 'trunk', 0, false); lathe(t, [[2.3, 0], [3.2, 2.9], [5.6, 3.4], [7.6, 2.3], [8.7, 0]], 7, 'leaf');   // plátano de sombra: big round crown, pale trunk
  T[SP.PLANE] = { R0: 3.4, sMin: 0.6, sMax: 2.1, tris: t, leaf: [[84, 120, 56], [76, 112, 52], [96, 128, 60], [70, 104, 50]], trunk: [150, 138, 118] }; }
{ const t = []; disc(t, 2.4, 6); lathe(t, [[0, 0.36], [1.3, 0.3]], 3, 'trunk', 0.3, false); lathe(t, [[0.9, 0], [1.7, 2.1], [2.9, 2.4], [3.9, 1.3], [4.3, 0]], 6, 'leaf');   // olivo: low wide silvery-green crown
  T[SP.OLIVE] = { R0: 2.3, sMin: 0.6, sMax: 1.5, lean: 0.08, tris: t, leaf: [[112, 128, 88], [100, 120, 80], [120, 134, 96], [92, 112, 76]], trunk: [104, 90, 74] }; }
{ const t = []; disc(t, 2.1, 6); lathe(t, [[0, 0.22], [1.1, 0.18]], 3, 'trunk', 0, false); lathe(t, [[0.9, 0], [1.6, 1.9], [2.9, 2.1], [4.0, 1.0], [4.4, 0]], 6, 'leaf');   // naranjo: compact dark ball
  T[SP.ORANGE] = { R0: 2.0, sMin: 0.6, sMax: 1.4, tris: t, leaf: [[48, 92, 42], [54, 100, 46], [60, 98, 44], [140, 118, 44]], trunk: [88, 68, 50] }; }
{ const t = []; disc(t, 3.0, 6); lathe(t, [[0, 0.28], [3.0, 0.2]], 3, 'trunk', 0.2, false); lathe(t, [[2.6, 0], [3.4, 2.8], [5.4, 3.1], [7.2, 1.8], [7.9, 0]], 6, 'leaf');   // jacaranda: light wide crown, some lilac in bloom
  T[SP.JACARANDA] = { R0: 3.0, sMin: 0.6, sMax: 1.7, tris: t, leaf: [[154, 122, 172], [140, 112, 164], [100, 128, 74], [90, 118, 70]], trunk: [112, 88, 70] }; }
{ const t = []; disc(t, 1.9, 5); lathe(t, [[0, 0.3], [6.5, 0.18]], 3, 'trunk', 0, false); lathe(t, [[4.8, 0], [6.4, 1.8], [10.5, 1.6], [14.2, 0.7], [15.3, 0]], 6, 'leaf');   // eucalipto: tall, narrow blue-green crown
  T[SP.EUCALYPT] = { R0: 1.8, sMin: 0.6, sMax: 1.7, lean: 0.07, tris: t, leaf: [[86, 116, 96], [78, 108, 90], [96, 124, 100]], trunk: [168, 152, 130] }; }
// ---- crops and scrub (plugins/crops.mjs): tiny templates, hundreds per cell, near the player only like every tree
{ const t = []; for (let b = 0; b < 3; b++) { const a = b * 2.1 + 0.4, bx = Math.cos(a) * 0.5, bz = Math.sin(a) * 0.5, tx = bx * 1.3, tz = bz * 1.3, w = 0.07, sx = -Math.sin(a) * w, sz = Math.cos(a) * w;   // wheat: three fine blades with a darker ear at the tip
    tri(t, [bx - sx, 0, bz - sz], [bx + sx, 0, bz + sz], [tx, 0.95, tz], 'leaf', 0);
    tri(t, [tx - sx * 1.6, 0.62, tz - sz * 1.6], [tx + sx * 1.6, 0.62, tz + sz * 1.6], [tx, 1.1, tz], 'core', 0); }
  T[SP.WHEAT] = { R0: 0.55, sMin: 0.7, sMax: 1.4, lean: 0.05, tris: t, leaf: [[186, 160, 78], [174, 150, 70], [196, 170, 88]], core: [156, 118, 52], trunk: [150, 130, 70] }; }
{ const t = []; lathe(t, [[0, 0.05], [1.5, 0.04]], 3, 'trunk', 0, false); lathe(t, [[1.45, 0.3], [1.62, 0]], 6, 'leaf', 0, false); lathe(t, [[1.6, 0.13], [1.7, 0]], 5, 'core', 0, false);   // girasol: green stalk, yellow head, brown disc
  T[SP.SUNFLOWER] = { R0: 0.5, sMin: 0.8, sMax: 1.25, lean: 0.03, tris: t, leaf: [[226, 176, 36], [236, 190, 44], [214, 160, 30]], core: [92, 62, 28], trunk: [76, 106, 48] }; }
{ const t = []; lathe(t, [[0.25, 0], [0.6, 0.55], [0.95, 0.5], [1.15, 0]], 6, 'leaf');   // cepa: low leafy dome in a row
  T[SP.VINE] = { R0: 0.7, sMin: 0.8, sMax: 1.2, tris: t, leaf: [[96, 128, 58], [110, 138, 60], [124, 138, 62]], trunk: [90, 70, 50] }; }
{ const t = []; lathe(t, [[0, 0.95], [0.6, 1.05], [1.3, 0]], 6, 'leaf');   // lentisco: dense dark glossy dome
  T[SP.LENTISCO] = { R0: 1.0, sMin: 0.6, sMax: 1.8, tris: t, leaf: [[44, 84, 48], [52, 92, 50], [40, 76, 44]], trunk: [80, 62, 46] }; }
{ const t = []; lathe(t, [[0, 0], [0.4, 0.35], [1.5, 1.0], [2.1, 0.5], [2.3, 0]], 5, 'leaf');   // retama: tall loose grey-green broom
  T[SP.RETAMA] = { R0: 1.1, sMin: 0.6, sMax: 1.7, lean: 0.08, tris: t, leaf: [[128, 144, 84], [140, 152, 86], [118, 134, 80], [168, 166, 76]], trunk: [90, 78, 56] }; }
{ const t = []; for (let f = 0; f < 6; f++) { const a = f / 6 * Math.PI * 2 + 0.2, c = Math.cos(a), s = Math.sin(a), at = (d, y, w) => [c * d - s * w, y, s * d + c * w];   // palmito: ground fan of stiff fronds
    tri(t, at(0.5, 0.05, 0), at(0.3, 0.85, 0.3), at(0.3, 0.85, -0.3), 'leaf', 0); }
  T[SP.PALMITO] = { R0: 0.9, sMin: 0.6, sMax: 1.6, tris: t, leaf: [[96, 124, 60], [84, 110, 52], [108, 132, 66]], trunk: [90, 70, 50] }; }
for (const s of T) { let h = 0; for (const q of s.tris) for (const p of q.p) h = Math.max(h, p[1]); s.h = h; }
export const BLOB = [52, 58, 40];

const hash = (x, z) => { let h = Math.imul((Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** triangles per baked record (for budgets and tests) */
export const trisOf = v => T[Math.min(T.length - 1, Math.floor(v / SPW))].tris.length;

/** records (Float32 x, y, z, sp*SPW+r per tree) -> merged faceted mesh, int16 positions in the cell's world-mesh units ((x, y - yOff, z) * q),
 *  pre-lit colours (sun + sky ambient per facet, darker low in the crown). Returns { pos: Int16Array, col: Uint8Array RGBA, y0, y1 } (y in metres). */
export function buildTrees(rec, { yOff, qxz, qy, sun, ambient = 0.58 }) {
  const n = rec.length / 4; let nv = 0;
  for (let t = 0; t < n; t++) nv += trisOf(rec[t * 4 + 3]) * 3;
  const pos = new Int16Array(nv * 3), col = new Uint8Array(nv * 4), L = Math.hypot(...sun), S = sun.map(v => v / L);
  let o = 0, y0 = 1e9, y1 = -1e9;
  const q16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
  for (let t = 0; t < n; t++) {
    const x = rec[t * 4], y = rec[t * 4 + 1], z = rec[t * 4 + 2], v = rec[t * 4 + 3], sp = Math.min(T.length - 1, Math.floor(v / SPW)), r = v - sp * SPW, M = T[sp];
    const h1 = hash(x, z), h2 = hash(z + 17.3, x - 5.1), s = Math.max(M.sMin, Math.min(M.sMax, r / M.R0)), sy = s * (0.88 + 0.24 * h2);
    const yaw = h1 * Math.PI * 2, cy = Math.cos(yaw), sn = Math.sin(yaw), lean = (M.lean || 0) * (h2 * 2 - 1), tint = 0.9 + 0.2 * hash(x - 3.7, z + 9.1);
    const leaf = M.leaf[Math.floor(h2 * M.leaf.length) % M.leaf.length], H = M.h * sy;
    for (const { p, col: kc } of M.tris) {
      const W = p.map(([px, py, pz]) => { const ly = py * sy, bend = M.curve ? lean * ly * ly / H : lean * ly; return [x + (px * cy - pz * sn) * s + bend * cy, y + ly, z + (px * sn + pz * cy) * s + bend * sn]; });
      let c;
      if (kc === 'blob') c = BLOB;
      else {
        const nn = nrm(...W), l = Math.hypot(...nn) || 1, nx = nn[0] / l, ny = nn[1] / l, nz = nn[2] / l, sd = Math.max(0, nx * S[0] + ny * S[1] + nz * S[2]);
        const ao = kc === 'leaf' || kc === 'core' ? 0.72 + 0.28 * Math.min(1, ((W[0][1] + W[1][1] + W[2][1]) / 3 - y) / H) : 0.85, f = (ambient * (0.8 + 0.2 * (0.5 + 0.5 * ny)) + (1 - ambient) * sd) * ao * tint;
        c = (kc === 'leaf' ? leaf : kc === 'core' ? M.core : M.trunk).map(a => Math.min(255, a * f * 1.25));
      }
      for (const w of W) {
        pos[o * 3] = q16(w[0] * qxz); pos[o * 3 + 1] = q16((w[1] - yOff) * qy); pos[o * 3 + 2] = q16(w[2] * qxz);
        col[o * 4] = c[0]; col[o * 4 + 1] = c[1]; col[o * 4 + 2] = c[2]; col[o * 4 + 3] = 255; o++;
        if (w[1] < y0) y0 = w[1]; if (w[1] > y1) y1 = w[1];
      }
    }
  }
  return { pos, col, y0, y1 };
}
