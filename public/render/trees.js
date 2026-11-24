// v2 trees: original species of foliage cards, expanded per cell in the cell worker (stream/worker.js) into ONE merged mesh with vertex colours
// (one draw call per cell, the tree material). Pure module (no three.js): the bake (scripts/bake/plugins/trees.mjs) imports SP / SPW from here.
// Baked tree record (scripts/bake_cells.mjs): cell-relative x, absolute ground y, cell-relative z, species * SPW + crown radius (m).
export const SP = { BROAD: 0, PINE: 1, CYPRESS: 2, PALM: 3, BUSH: 4, CONIFER: 5, PLANE: 6, OLIVE: 7, ORANGE: 8, JACARANDA: 9, EUCALYPT: 10,
  WHEAT: 11, SUNFLOWER: 12, VINE: 13, LENTISCO: 14, RETAMA: 15, PALMITO: 16, LAVENDER: 17 };   // 11..16: ground-level crop and scrub vegetation (scripts/bake/plugins/crops.mjs), same merged mesh
export const SPW = 64;   // old cells (radius only, < 64) decode as BROAD

// ---- templates: triangles in metres for a crown radius of R0; sMin..sMax clamp the per-tree scale r / R0
// Crowns = alpha-tested foliage cards (assets/textures/leaf.webp, CELL) on an ellipsoid around a dark core, shaded with the ellipsoid's normals.
// A template triangle: { p: 3 points, col, n?: 3 normals (else the face normal), t?: 3 texture bytes (else 255 = plain colour), ao?: 3 }
const CELL = { broad: 0, needle: 1, narrow: 2, frond: 3, small: 4, blossom: 5, tuft: 6, bark: 7 };
const tb = (cell, u, v) => cell * 16 + (u ? 8 : 0) + v;   // v 0 (top) .. 7 (bottom) of the cell: the shader decodes it (render/world.js TREE_VS)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
const nrm = (a, b, c) => cross(sub(b, a), sub(c, a));
const R01 = (k, s) => { let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 4294967296; };   // same wobble every bake
/** quad a b c d (top-left, top-right, bottom-right, bottom-left of the cell), normals from fn(point) */
function quad(out, P, cell, col, fn, ao) {
  const t = [tb(cell, 0, 0), tb(cell, 1, 0), tb(cell, 1, 7), tb(cell, 0, 7)];
  for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) out.push({ p: [P[i], P[j], P[k]], t: [t[i], t[j], t[k]], col, n: fn && [fn(P[i]), fn(P[j]), fn(P[k])], ao: ao && [ao(P[i]), ao(P[j]), ao(P[k])] });
}
/** tapered trunk with bark, n sides, from [y, r] to [y, r], optional offset of the top (a limb) */
function trunk(out, y0, r0, y1, r1, n = 4, off = [0, 0], base = [0, 0]) {
  const ring = (y, r, o) => Array.from({ length: n }, (_, s) => { const a = s / n * Math.PI * 2 + 0.4; return [Math.cos(a) * r + o[0], y, Math.sin(a) * r + o[1]]; }), A = ring(y0, r0, base), C = ring(y1, r1, off);
  for (let s = 0; s < n; s++) { const e = (s + 1) % n, f = p => { const k = (p[1] - y0) / (y1 - y0 || 1); return unit([p[0] - base[0] - (off[0] - base[0]) * k, 0.1, p[2] - base[1] - (off[1] - base[1]) * k]); }; quad(out, [C[s], C[e], A[e], A[s]], CELL.bark, 'trunk', f); }
}
/** soft shadow on the ground: one leaf-cell quad */
function disc(out, r) { quad(out, [[-r, 0.1, -r], [r, 0.1, -r], [r, 0.1, r], [-r, 0.1, r]], CELL.small, 'blob'); }
/** crown: n cards of half-size sz on the ellipsoid centred at (x, cy, z) with radii rx, ry; hole = share of the sphere left open at the bottom (0..1) */
function crown(out, { x = 0, z = 0, cy, rx, ry, n, sz, cell, seed = 0, low = -0.75, inner = 0.6, flat = 0, col = 'leaf', core = true }) {
  const tall = Math.min(1.9, Math.max(1, ry / rx / 2));   // spindle crowns: taller, upright cards and a longer core, or they break into clumps
  const c0 = [x, cy, z], nf = p => unit([(p[0] - x) / rx, (p[1] - cy) / ry + 0.15, (p[2] - z) / rx]), ao = p => 0.62 + 0.38 * Math.min(1, Math.max(0, (p[1] - cy + ry) / (2 * ry))) * Math.min(1, 0.55 + 0.45 * Math.hypot((p[0] - x) / rx, (p[1] - cy) / ry, (p[2] - z) / rx));
  if (core) { const k = 5, q = inner - 0.04, bt = (v, u) => tb(CELL.bark, u, v), top = [x, cy + ry * Math.min(0.94, q * tall), z], bot = [x, cy - ry * q * 0.8, z];   // dark core: no see-through crown
    for (let s = 0; s < k; s++) { const e = a => { const an = a / k * Math.PI * 2 + seed, w = 0.9 + 0.2 * R01(a % k, seed); return [x + Math.cos(an) * rx * q * w, cy, z + Math.sin(an) * rx * q * w]; }, A = e(s), C = e(s + 1); out.push({ p: [A, top, C], t: [bt(6, 0), bt(0, 0), bt(6, 1)], col: 'core' }, { p: [A, C, bot], t: [bt(0, 0), bt(0, 1), bt(6, 0)], col: 'core' }); } }
  for (let k = 0; k < n; k++) {
    const ny = 1 - (1 - low) * (k + 0.5) / n, rr = Math.sqrt(Math.max(0, 1 - ny * ny)), th = k * 2.39996 + seed, d = [Math.cos(th) * rr, ny, Math.sin(th) * rr];
    const far = inner * (tall > 1 ? 0.95 + 0.2 * R01(k, seed + 5) : 0.82 + 0.5 * R01(k, seed + 5)), c = [c0[0] + d[0] * rx * far, c0[1] + d[1] * ry * far, c0[2] + d[2] * rx * far], j = i => (R01(k * 5 + i, seed + 3) - 0.5), w = unit([d[0] + j(0) * 0.9, d[1] * (1 - flat) + flat * 1.6 + j(1) * 0.9, d[2] + j(2) * 0.9]);
    const up0 = Math.abs(w[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], r = unit(cross(up0, w)), u = cross(w, r), rot = j(3) * 1.2 / (tall * tall), cr = Math.cos(rot), sr = Math.sin(rot), q = sz * (0.85 + 0.4 * R01(k, seed + 9)), R = r.map((v, i) => (v * cr + u[i] * sr) * q), U = u.map((v, i) => (u[i] * cr - r[i] * sr) * q * tall);
    quad(out, [add(add(c, R, -1), U), add(add(c, R), U), add(add(c, R), U, -1), add(add(c, R, -1), U, -1)], cell, col, nf, ao);
  }
}
/** palm crown: n arching fronds of length L from height y */
function fronds(out, n, y, L, w, rise, drop, seg = 2, inner = 0) {
  for (let f = 0; f < n; f++) {
    const a = f / n * Math.PI * 2 + 0.35 * R01(f, 1), c = Math.cos(a), s = Math.sin(a), li = L * (0.85 + 0.3 * R01(f, 2)), lift = rise * (0.5 + R01(f, 3)), fall = drop * (0.6 + 0.8 * R01(f, 4));
    const at = (k, side) => { const d = inner + li * k; return [c * d - s * w * side, y + lift * 4 * k * (1 - k) - fall * k * k + (side ? -0.10 * w : 0), s * d + c * w * side]; };
    for (let k = 0; k < seg; k++) { const k0 = k / seg, k1 = (k + 1) / seg, v = q => Math.round(7 - 7 * q), P = [at(k1, -1), at(k1, 1), at(k0, 1), at(k0, -1)], T4 = [tb(CELL.frond, 0, v(k1)), tb(CELL.frond, 1, v(k1)), tb(CELL.frond, 1, v(k0)), tb(CELL.frond, 0, v(k0))], nf = p => unit([p[0] * 0.25, 1, p[2] * 0.25]);
      for (const [i, j, m] of [[0, 1, 2], [0, 2, 3]]) out.push({ p: [P[i], P[j], P[m]], t: [T4[i], T4[j], T4[m]], col: 'leaf', n: [nf(P[i]), nf(P[j]), nf(P[m])] }); }
  }
}
/** crossed vertical cards (grass, wheat, broom, vine rows) */
function tufts(out, n, r, h, w, cell, col = 'leaf') {
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI + 0.3, c = Math.cos(a), s = Math.sin(a), o = [(R01(k, 5) - 0.5) * r, (R01(k, 6) - 0.5) * r], at = (x, y) => [o[0] + c * x, y, o[1] + s * x];
    quad(out, [at(-w, h), at(w, h), at(w, 0), at(-w, 0)], cell, col, p => unit([0, 1, 0]), p => 0.7 + 0.3 * p[1] / h); }
}
const SOLID = (out, prof, n, col) => { for (let k = 0; k + 1 < prof.length; k++) for (let s = 0; s < n; s++) { const P = ([y, r], a) => [Math.cos(a / n * 6.2832) * r, y, Math.sin(a / n * 6.2832) * r], a0 = P(prof[k], s), a1 = P(prof[k], s + 1), b0 = P(prof[k + 1], s), b1 = P(prof[k + 1], s + 1); if (prof[k][1] > 0) out.push({ p: [a0, b0, a1], col }); if (prof[k + 1][1] > 0) out.push({ p: [a1, b0, b1], col }); } };

function out4(out, c, r, col) { const P = [[r, -r * 0.7, 0], [-r * 0.5, -r * 0.7, r * 0.87], [-r * 0.5, -r * 0.7, -r * 0.87], [0, r, 0]].map(v => add(c, v)); for (const [i, j, k] of [[0, 1, 3], [1, 2, 3], [2, 0, 3]]) out.push({ p: [P[i], P[j], P[k]], col }); }   // small tetrahedron (an orange)
const T = [], def = (sp, o, build) => { const t = []; build(t); T[sp] = { ...o, tris: t }; };
def(SP.BROAD, { R0: 2.6, sMin: 0.55, sMax: 2.0, leaf: [[74, 106, 52], [66, 96, 46], [90, 112, 56], [82, 100, 46], [96, 106, 60]], trunk: [96, 78, 60] }, t => { disc(t, 2.6); trunk(t, 0, 0.26, 2.6, 0.17); trunk(t, 2.2, 0.12, 4.0, 0.06, 3, [1.0, 0.5]);
  crown(t, { cy: 4.1, rx: 2.5, ry: 2.2, n: 13, sz: 1.35, cell: CELL.broad }); });
def(SP.PINE, { R0: 3.4, sMin: 0.6, sMax: 1.45, lean: 0.06, leaf: [[62, 90, 50], [68, 98, 54], [56, 84, 48], [74, 96, 52]], trunk: [124, 92, 70] }, t => { disc(t, 3.1); trunk(t, 0, 0.32, 5.9, 0.18); for (let k = 0; k < 2; k++) trunk(t, 5.2, 0.12, 6.5, 0.06, 3, [1.9 * Math.cos(k * 2.6), 1.9 * Math.sin(k * 2.6)]);   // pino piñonero: bare bole, parasol crown
  crown(t, { cy: 6.4, rx: 3.5, ry: 1.0, n: 14, sz: 1.5, cell: CELL.needle, low: -0.55, inner: 0.72, flat: 0.5 }); });
def(SP.CYPRESS, { R0: 1.25, sMin: 0.7, sMax: 1.25, leaf: [[46, 74, 46], [52, 80, 50], [42, 68, 42]], trunk: [86, 70, 56] }, t => { disc(t, 1.4); trunk(t, 0, 0.16, 1.0, 0.14, 3);   // ciprés: tall closed spindle
  crown(t, { cy: 5.4, rx: 0.95, ry: 4.9, n: 26, sz: 0.72, cell: CELL.needle, low: -0.95, inner: 0.7 }); });
def(SP.PALM, { R0: 2.8, sMin: 0.75, sMax: 1.3, lean: 0.12, curve: true, leaf: [[92, 116, 58], [102, 122, 62], [84, 108, 54]], trunk: [138, 120, 98] }, t => { disc(t, 2.0); trunk(t, 0, 0.34, 3.5, 0.25, 5); trunk(t, 3.5, 0.25, 7.2, 0.22, 5);   // palmera
  fronds(t, 13, 7.2, 3.1, 0.62, 0.75, 1.5); fronds(t, 5, 7.25, 2.3, 0.5, 1.3, -0.2); });
def(SP.BUSH, { R0: 1.2, sMin: 0.5, sMax: 1.6, leaf: [[78, 102, 52], [90, 110, 58], [70, 92, 50], [100, 106, 62], [84, 96, 70]], trunk: [80, 62, 46] }, t => { disc(t, 1.3); crown(t, { cy: 0.6, rx: 1.15, ry: 0.75, n: 9, sz: 0.62, cell: CELL.small, low: -0.35 }); });
def(SP.CONIFER, { R0: 2.4, sMin: 0.6, sMax: 1.4, leaf: [[48, 80, 60], [54, 86, 64], [50, 74, 54]], trunk: [92, 74, 58] }, t => { disc(t, 2.3); trunk(t, 0, 0.26, 2.0, 0.2);   // cedro / abeto: tiers
  for (let k = 0; k < 4; k++) { const r = [2.2, 1.75, 1.2, 0.65][k]; crown(t, { cy: 1.9 + k * 1.75, rx: r, ry: 1.1, n: [7, 6, 5, 3][k], sz: r * 0.62 + 0.25, cell: CELL.needle, seed: k * 0.9, low: -0.5, flat: 0.35, core: k < 3 }); } });
def(SP.PLANE, { R0: 3.4, sMin: 0.6, sMax: 2.1, leaf: [[82, 112, 56], [76, 106, 52], [92, 118, 60], [72, 100, 52]], trunk: [152, 142, 124] }, t => { disc(t, 3.4); trunk(t, 0, 0.32, 2.9, 0.22, 5); for (let k = 0; k < 2; k++) trunk(t, 2.7, 0.15, 5.0, 0.08, 3, [1.4 * Math.cos(k * 3), 1.4 * Math.sin(k * 3)]);   // plátano de sombra: big round crown, pale trunk
  crown(t, { cy: 5.6, rx: 3.3, ry: 2.9, n: 18, sz: 1.6, cell: CELL.broad }); });
def(SP.OLIVE, { R0: 2.3, sMin: 0.6, sMax: 1.5, lean: 0.08, leaf: [[112, 124, 90], [102, 116, 82], [118, 128, 96], [94, 108, 78]], trunk: [108, 96, 82] }, t => { disc(t, 2.3); trunk(t, 0, 0.36, 1.2, 0.28); for (let k = 0; k < 2; k++) trunk(t, 1.0, 0.18, 2.3, 0.08, 3, [0.9 * Math.cos(k * 2.8), 0.9 * Math.sin(k * 2.8)]);   // olivo: low wide silvery crown
  crown(t, { cy: 2.7, rx: 2.2, ry: 1.45, n: 12, sz: 1.05, cell: CELL.narrow }); });
def(SP.ORANGE, { R0: 2.0, sMin: 0.6, sMax: 1.4, leaf: [[54, 92, 46], [58, 98, 48], [62, 96, 46]], core: [40, 60, 34], trunk: [92, 76, 60] }, t => { disc(t, 1.9); trunk(t, 0, 0.15, 1.4, 0.12, 4);   // naranjo: compact dark ball with fruit
  crown(t, { cy: 2.6, rx: 1.8, ry: 1.6, n: 12, sz: 1.0, cell: CELL.small });
  for (let k = 0; k < 4; k++) { const a = k * 1.9, y = 2.2 + (k % 3) * 0.5, r = 1.72 * Math.sqrt(Math.max(0.1, 1 - ((y - 2.6) / 1.6) ** 2)), c = [Math.cos(a) * r, y, Math.sin(a) * r]; out4(t, c, 0.11, 'fruit'); } });
def(SP.JACARANDA, { R0: 3.0, sMin: 0.6, sMax: 1.7, leaf: [[150, 124, 172], [138, 116, 162], [98, 122, 74], [90, 114, 70]], trunk: [112, 94, 78] }, t => { disc(t, 2.9); trunk(t, 0, 0.26, 3.0, 0.18); for (let k = 0; k < 2; k++) trunk(t, 2.8, 0.13, 4.8, 0.06, 3, [1.4 * Math.cos(k * 2.9 + 1), 1.4 * Math.sin(k * 2.9 + 1)]);   // jacaranda: light wide crown, some lilac in bloom
  crown(t, { cy: 5.1, rx: 2.9, ry: 2.1, n: 14, sz: 1.45, cell: CELL.broad, core: false }); crown(t, { cy: 5.2, rx: 2.9, ry: 2.1, n: 5, sz: 1.3, cell: CELL.blossom, seed: 2, core: false, inner: 0.75 }); });
def(SP.EUCALYPT, { R0: 1.8, sMin: 0.6, sMax: 1.7, lean: 0.07, leaf: [[90, 114, 94], [82, 106, 88], [98, 120, 98]], trunk: [168, 156, 138] }, t => { disc(t, 1.9); trunk(t, 0, 0.3, 7.5, 0.16); trunk(t, 5.5, 0.12, 8.2, 0.06, 3, [1.0, -0.6]);   // eucalipto: tall, narrow blue-green crown in clumps
  crown(t, { cy: 9.9, rx: 1.65, ry: 4.2, n: 18, sz: 1.2, cell: CELL.narrow, low: -0.85, inner: 0.7 }); crown(t, { cy: 8.0, x: 1.1, z: -0.5, rx: 1.2, ry: 1.3, n: 5, sz: 0.95, cell: CELL.narrow, seed: 2, core: false }); });
// ---- crops and scrub (plugins/crops.mjs): tiny templates, hundreds per cell, near the player only like every tree
def(SP.WHEAT, { R0: 0.55, sMin: 0.7, sMax: 1.4, lean: 0.05, leaf: [[196, 170, 96], [184, 160, 88], [206, 180, 106]], trunk: [150, 130, 70] }, t => tufts(t, 3, 0.5, 1.05, 0.6, CELL.tuft));
def(SP.SUNFLOWER, { R0: 0.5, sMin: 0.8, sMax: 1.25, lean: 0.03, leaf: [[226, 176, 36], [236, 190, 44], [214, 160, 30]], core: [92, 62, 28], trunk: [76, 106, 48] }, t => { SOLID(t, [[0, 0.03], [1.5, 0.025]], 3, 'trunk'); tufts(t, 1, 0, 1.1, 0.35, CELL.small, 'trunk'); SOLID(t, [[1.46, 0.3], [1.62, 0]], 8, 'leaf'); SOLID(t, [[1.55, 0.15], [1.66, 0]], 6, 'core'); });
def(SP.VINE, { R0: 0.7, sMin: 0.8, sMax: 1.2, leaf: [[96, 122, 58], [108, 130, 60], [118, 130, 62]], trunk: [90, 70, 50] }, t => { trunk(t, 0, 0.06, 0.6, 0.05, 3); crown(t, { cy: 0.8, rx: 0.65, ry: 0.45, n: 6, sz: 0.46, cell: CELL.broad, core: false }); });
def(SP.LENTISCO, { R0: 1.0, sMin: 0.6, sMax: 1.8, leaf: [[52, 84, 50], [58, 92, 52], [48, 78, 46]], trunk: [80, 62, 46] }, t => crown(t, { cy: 0.6, rx: 1.0, ry: 0.75, n: 9, sz: 0.56, cell: CELL.small, low: -0.35 }));
def(SP.RETAMA, { R0: 1.1, sMin: 0.6, sMax: 1.7, lean: 0.08, leaf: [[128, 140, 88], [138, 146, 90], [118, 130, 82], [164, 160, 80]], trunk: [90, 78, 56] }, t => { tufts(t, 4, 0.5, 2.0, 1.0, CELL.tuft); crown(t, { cy: 1.3, rx: 0.9, ry: 0.8, n: 4, sz: 0.55, cell: CELL.narrow, core: false }); });
def(SP.PALMITO, { R0: 0.9, sMin: 0.6, sMax: 1.6, leaf: [[96, 120, 60], [86, 108, 54], [106, 126, 66]], trunk: [90, 70, 50] }, t => fronds(t, 8, 0.1, 0.95, 0.34, 0.45, -0.35, 1));
def(SP.LAVENDER, { R0: 0.35, sMin: 0.7, sMax: 1.3, lean: 0.05, leaf: [[138, 108, 168], [126, 98, 160], [148, 118, 174]], trunk: [112, 124, 92] }, t => { tufts(t, 2, 0.2, 0.36, 0.34, CELL.tuft, 'trunk'); tufts(t, 3, 0.25, 0.6, 0.36, CELL.tuft); });
for (const s of T) { let h = 0; for (const q of s.tris) for (const p of q.p) h = Math.max(h, p[1]); s.h = h; }
export const BLOB = [40, 42, 35];

const hash = (x, z) => { let h = Math.imul((Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** triangles per baked record (for budgets and tests) */
export const trisOf = v => T[Math.min(T.length - 1, Math.floor(v / SPW))].tris.length;

/** records (Float32 x, y, z, sp*SPW+r per tree) -> merged mesh, int16 positions in the cell's world-mesh units ((x, y - yOff, z) * q),
 *  pre-lit colours (sun + sky ambient per vertex, darker low in the crown), alpha = texture byte (255 plain). Returns { pos: Int16Array, col: Uint8Array RGBA, y0, y1 } (y in metres). */
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
    const rgb = { leaf, core: M.core || leaf.map(c => c * 0.72), trunk: M.trunk, blob: BLOB, fruit: [214, 122, 34] };
    for (const { p, col: kc, n: N, t: tx, ao } of M.tris) {
      const W = p.map(([px, py, pz]) => { const ly = py * sy, bend = M.curve ? lean * ly * ly / H : lean * ly; return [x + (px * cy - pz * sn) * s + bend * cy, y + ly, z + (px * sn + pz * cy) * s + bend * sn]; }), face = N ? null : unit(nrm(...W));
      for (let k = 0; k < 3; k++) {
        const w = W[k], c0 = rgb[kc]; let f = 1;
        if (kc !== 'blob') {
          const nn = N ? [N[k][0] * cy - N[k][2] * sn, N[k][1], N[k][0] * sn + N[k][2] * cy] : face, dt = nn[0] * S[0] + nn[1] * S[1] + nn[2] * S[2], sd = Math.max(0, N ? dt * 0.75 + 0.25 : Math.abs(dt));   // wrapped light through the leaves
          f = (ambient * (0.75 + 0.25 * (0.5 + 0.5 * nn[1])) + (1 - ambient) * 1.3 * sd) * (ao ? ao[k] : 0.9) * tint * 1.2;
        }
        pos[o * 3] = q16(w[0] * qxz); pos[o * 3 + 1] = q16((w[1] - yOff) * qy); pos[o * 3 + 2] = q16(w[2] * qxz);
        for (let i = 0; i < 3; i++) col[o * 4 + i] = Math.min(255, c0[i] * f * (f > 1 && i === 2 ? 0.94 : 1));
        col[o * 4 + 3] = tx ? tx[k] : 255; o++;
        if (w[1] < y0) y0 = w[1]; if (w[1] > y1) y1 = w[1];
      }
    }
  }
  return { pos, col, y0, y1 };
}
