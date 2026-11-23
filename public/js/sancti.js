import * as THREE from 'three';
import { K, R } from './geo.js';

// Isla de Sancti Petri: real OSM outline (data/sancti.json, from scripts/sancti.mjs) -> ground mesh with beach / rock / scrub,
// a procedural Castillo de Sancti Petri (curtain walls with merlons, corner towers, keep, gate, ruined stretches, cannons),
// the lighthouse, the pier, scrub bushes and a few column stumps for the Temple of Hercules.
// Solids are exposed through hit(x,z,y) and chained into buildings.hit so car / heli / walker collide with it.
const CELL = 5, RAS = 2, hash = (a, b) => { let h = Math.imul((Math.round(a) * 73856093) ^ (Math.round(b) * 19349663), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const vnoise = (x, z) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v; };
const fbm = (x, z) => 0.55 * vnoise(x, z) + 0.3 * vnoise(x * 2.3 + 5, z * 2.3 + 9) + 0.15 * vnoise(x * 5.1 + 2, z * 5.1 + 7);
function inPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
function distPoly(P, x, z) { let best = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < best) best = d; } return best; }

class Mesh {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, ca, cb, cc) { this.p.push(...a, ...b, ...c); this.c.push(...ca, ...(cb || ca), ...(cc || ca)); }
  quad(a, b, c, d, c0, c1) { c1 = c1 || c0; this.tri(a, b, c, c0, c0, c1); this.tri(a, c, d, c0, c1, c1); }   // a,b = bottom (c0), c,d = top (c1)
  /** vertical prism over segment (x1,z1)-(x2,z2), thickness t, from y0 to y1; colours bottom/top */
  wall(x1, z1, x2, z2, t, y0, y1, cb, ct, capCol) {
    const l = Math.hypot(x2 - x1, z2 - z1) || 1, nx = -(z2 - z1) / l * t / 2, nz = (x2 - x1) / l * t / 2;
    const A = [x1 + nx, z1 + nz], B = [x2 + nx, z2 + nz], C = [x2 - nx, z2 - nz], D = [x1 - nx, z1 - nz];
    for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]]) this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], cb, ct);
    this.quad([A[0], y1, A[1]], [B[0], y1, B[1]], [C[0], y1, C[1]], [D[0], y1, D[1]], capCol || ct);
  }
  box(cx, cz, w, d, ang, y0, y1, cb, ct) { ct = ct || cb; const ca = Math.cos(ang), sa = Math.sin(ang); this.wall(cx - ca * w / 2, cz - sa * w / 2, cx + ca * w / 2, cz + sa * w / 2, d, y0, y1, cb, ct); }
  cyl(cx, cz, r0, r1, y0, y1, n, cb, ct) { ct = ct || cb;
    for (let i = 0; i < n; i++) { const a = i / n * 6.2832, b = (i + 1) / n * 6.2832;
      this.quad([cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0], [cx + Math.cos(b) * r0, y0, cz + Math.sin(b) * r0], [cx + Math.cos(b) * r1, y1, cz + Math.sin(b) * r1], [cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1], cb, ct);
      this.tri([cx, y1, cz], [cx + Math.cos(b) * r1, y1, cz + Math.sin(b) * r1], [cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1], ct); }
  }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
  get count() { return this.p.length / 9; }
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export class Sancti {
  constructor(hf) { this.hf = hf; this.D = null; this.solids = { walls: [], circ: [] }; this.active = false; }
  async load() {
    let D; try { const r = await fetch('/data/sancti.json'); if (!r.ok) return; D = await r.json(); } catch { return; }
    if (!D.island) return; this.D = D; const P = D.island, xs = P.map(p => p[0]), zs = P.map(p => p[1]);
    this.bb = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...zs) - 40, Math.max(...zs) + 40];
    const C = D.castle; this.cc = C.reduce((a, p) => [a[0] + p[0] / C.length, a[1] + p[1] / C.length], [0, 0]);
    this.plateau = 6.2;
    this.raster(); this.raiseDEM(); this.patchHeight();
  }
  // ---- ground profile (metres above sea level) from the signed distance to the coast
  profile(x, z) {
    const P = this.D.island, inside = inPoly(P, x, z), d = distPoly(P, x, z) * (inside ? 1 : -1);
    let h;
    if (d < -9) h = -1; else if (d < 0) h = -1 + 1.45 * sstep(-9, 0, d); else h = 0.45 + 1.7 * sstep(0, 22, d) + 1.6 * sstep(18, 80, d) + (fbm(x * 0.03, z * 0.03) - 0.5) * 1.6 * sstep(8, 40, d);
    const dc = Math.hypot(x - this.cc[0], z - this.cc[1]), dp = distPoly(this.D.castle, x, z), inC = inPoly(this.D.castle, x, z), e = inC ? 0 : dp;
    if (d > -9) h = h + (this.plateau - h) * (1 - sstep(0, 26, e)) * (dc < 120 ? 1 : 0);
    return { h, d, inside };
  }
  raster() {
    const [x0, x1, z0, z1] = this.bb, W = Math.ceil((x1 - x0) / RAS) + 1, H = Math.ceil((z1 - z0) / RAS) + 1, g = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) g[j * W + i] = this.profile(x0 + i * RAS, z0 + j * RAS).h;
    this.ras = { g, W, H };
  }
  rasH(x, z) { const { g, W, H } = this.ras, u = (x - this.bb[0]) / RAS, v = (z - this.bb[2]) / RAS; if (u < 0 || v < 0 || u >= W - 1 || v >= H - 1) return -9; const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * W + i; return (g[o] * (1 - fu) + g[o + 1] * fu) * (1 - fv) + (g[o + W] * (1 - fu) + g[o + W + 1] * fu) * fv; }
  /** raise the DEM grid (used by the sea / shore analysis) where the island stands */
  raiseDEM() {
    const hf = this.hf, g = hf.grid, W = hf.W, H = hf.H, s = hf.s;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const mx = (i + 0.5 + hf.tx0 * 256) * s - Math.PI * R, my = Math.PI * R - (j + 0.5 + hf.ty0 * 256) * s, x = (mx - hf._mx0) * K, z = (hf._my0 - my) * K;
      if (x < this.bb[0] || x > this.bb[1] || z < this.bb[2] || z > this.bb[3]) continue;
      const h = this.rasH(x, z); if (h > 0.4) g[j * W + i] = Math.max(g[j * W + i], h - 0.15);
    }
  }
  /** terrain queries (heli / car / walker / terrain mesh) see the island ground at full resolution */
  patchHeight() {
    const hf = this.hf, orig = hf.height.bind(hf), me = this;
    hf.height = (x, z) => { const h = orig(x, z); if (x < me.bb[0] || x > me.bb[1] || z < me.bb[2] || z > me.bb[3]) return h; const r = me.rasH(x, z); return r > 0.3 ? Math.max(h, r) : h; };
  }

  // ---- scene
  attach(scene, world, buildings) {
    if (!this.D) return; const D = this.D;
    this.group = new THREE.Group(); this.detail = new THREE.Group(); scene.add(this.group); this.group.add(this.detail);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), gm = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.group.add(this.ground(gm)); const s = this.structures(); this.detail.add(new THREE.Mesh(s.geometry(), mat));
    this.bushes(); this.pier(mat); this.ruins(mat);
    // collisions: chain into buildings.hit (cars, heli and walker all query it) and, if present, the wall/trunk collide module
    if (buildings && !buildings.__sancti) { const orig = buildings.hit.bind(buildings), me = this; buildings.hit = (x, z, y) => orig(x, z, y) || me.hit(x, z, y); buildings.__sancti = true; }
    this.active = true;
  }
  ground(mat) {
    const [x0, x1, z0, z1] = this.bb, M = new Mesh(), nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), vert = new Map();
    const rocks = (this.D.rocks || []).map(r => ({ P: r, b: [Math.min(...r.map(p => p[0])), Math.max(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[1]))] }));
    const col = (x, z, h, d) => {
      const n = fbm(x * 0.05, z * 0.05), n2 = vnoise(x * 0.4, z * 0.4);
      if (h < 0.2) return [0.20 + n * 0.05, 0.42, 0.45];                                    // shallows under the sea plane
      let rock = false; for (const r of rocks) if (x > r.b[0] && x < r.b[1] && z > r.b[2] && z < r.b[3] && inPoly(r.P, x, z)) rock = true;
      if (rock || (d < 6 && n > 0.55)) return mul([0.55, 0.50, 0.43], 0.85 + 0.3 * n2);
      if (d < 3) return [0.64, 0.58, 0.44];                                                  // wet sand
      if (d < 14 && n < 0.7) return mul([0.86, 0.79, 0.60], 0.92 + 0.12 * n2);               // dry sand
      if (inPoly(this.D.castle, x, z) || distPoly(this.D.castle, x, z) < 7) return mul([0.72, 0.64, 0.49], 0.9 + 0.2 * n2);   // packed earth around the castle
      const t = n * 1.4 + n2 * 0.3; return t < 0.7 ? mul([0.47, 0.50, 0.29], 0.85 + 0.3 * n2) : mul([0.66, 0.60, 0.38], 0.85 + 0.3 * n2);   // scrub / dry grass
    };
    const V = (i, j) => { const k = j * (nx + 1) + i; let v = vert.get(k); if (!v) { const x = x0 + i * CELL, z = z0 + j * CELL, pr = this.profile(x, z); v = [x, Math.max(pr.h, -1) + 0.05, z, col(x, z, pr.h, pr.d), pr.d]; vert.set(k, v); } return v; };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      if (Math.max(a[4], b[4], c[4], d[4]) < -8) continue;
      M.tri([a[0], a[1], a[2]], [d[0], d[1], d[2]], [b[0], b[1], b[2]], a[3], d[3], b[3]); M.tri([b[0], b[1], b[2]], [d[0], d[1], d[2]], [c[0], c[1], c[2]], b[3], d[3], c[3]);
    }
    const mesh = new THREE.Mesh(M.geometry(), mat); mesh.renderOrder = 1; return mesh;
  }
  structures() {
    const M = new Mesh(), C = this.D.castle.slice(0, -1), y0 = this.plateau, SAND = [0.80, 0.70, 0.50], SAND_D = [0.62, 0.53, 0.38], CAP = [0.86, 0.77, 0.58];
    const W = this.solids.walls, T = this.solids.circ, n = C.length;
    // gate on the wall segment closest to the pier
    const pier = this.D.pier, pc = pier.reduce((a, p) => [a[0] + p[0] / pier.length, a[1] + p[1] / pier.length], [0, 0]); let gate = 0, gd = 1e9;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, mx = (C[i][0] + C[j][0]) / 2, mz = (C[i][1] + C[j][1]) / 2, d = Math.hypot(mx - pc[0], mz - pc[1]) - Math.hypot(C[j][0] - C[i][0], C[j][1] - C[i][1]) * 0.5; if (d < gd) { gd = d; gate = i; } }
    const merlon = (ax, az, bx, bz, top, ruined) => {   // crenellations along a wall top
      if (ruined) return; const l = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.floor(l / 2.6)), ang = Math.atan2(bz - az, bx - ax);
      for (let m = 0; m < k; m++) { const f = (m + 0.5) / k; M.box(ax + (bx - ax) * f, az + (bz - az) * f, 1.2, 1.9, ang, top, top + 0.95, SAND, CAP); }
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = C[i][0], az = C[i][1], bx = C[j][0], bz = C[j][1], l = Math.hypot(bx - ax, bz - az); if (l < 0.8) continue;
      const rr = hash(ax, az), ruined = rr < 0.2, top = y0 + (ruined ? 2.6 + rr * 12 : 7.2), v = 0.92 + 0.14 * hash(az, ax), cb = mul(SAND_D, v), ct = mul(SAND, v);
      if (i === gate && l > 9) {   // gateway: two piers + lintel
        const ux = (bx - ax) / l, uz = (bz - az) / l, g0 = l / 2 - 2.2, g1 = l / 2 + 2.2;
        M.wall(ax, az, ax + ux * g0, az + uz * g0, 2.2, y0, top, cb, ct); M.wall(ax + ux * g1, az + uz * g1, bx, bz, 2.2, y0, top, cb, ct);
        M.wall(ax + ux * g0, az + uz * g0, ax + ux * g1, az + uz * g1, 2.2, y0 + 4.6, top, cb, ct);
        W.push([ax, az, ax + ux * g0, az + uz * g0, 1.1, top], [ax + ux * g1, az + uz * g1, bx, bz, 1.1, top]);
        merlon(ax, az, ax + ux * g0, az + uz * g0, top, false); merlon(ax + ux * g1, az + uz * g1, bx, bz, top, false); merlon(ax + ux * g0, az + uz * g0, ax + ux * g1, az + uz * g1, top, false); continue;
      }
      M.wall(ax, az, bx, bz, 2.2, y0 - 0.5, top, cb, ct); W.push([ax, az, bx, bz, 1.1, top]); merlon(ax, az, bx, bz, top, ruined);
    }
    // corner towers where the outline turns sharply
    let last = null;
    for (let i = 0; i < n; i++) {
      const p = C[(i + n - 1) % n], q = C[i], r = C[(i + 1) % n], a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]); let dA = Math.abs(a2 - a1); if (dA > Math.PI) dA = 2 * Math.PI - dA;
      if (dA < 0.55 || (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 14)) continue; last = q;
      const ruined = hash(q[0], q[1]) < 0.15, th = y0 + (ruined ? 6 : 11);
      M.cyl(q[0], q[1], 3.7, 3.3, y0 - 0.5, th, 12, SAND_D, SAND);
      if (!ruined) { for (let k = 0; k < 8; k++) { const a = k / 8 * 6.2832; M.box(q[0] + Math.cos(a) * 3.2, q[1] + Math.sin(a) * 3.2, 1.7, 1.2, a + Math.PI / 2, th, th + 1.0, SAND, CAP); }
        M.cyl(q[0], q[1], 0.45, 0.4, th, th + 1.2, 6, [0.15, 0.15, 0.16]); M.box(q[0] + 2.2, q[1], 2.4, 0.5, 0, th + 0.05, th + 0.5, [0.15, 0.15, 0.16]); }   // cannon on the platform
      T.push([q[0], q[1], 3.7, th]);
    }
    // keep (torre del homenaje) with an arched door and battlements
    const kx = this.cc[0], kz = this.cc[1], kh = y0 + 15.5, ka = Math.atan2(C[1][1] - C[0][1], C[1][0] - C[0][0]);
    M.box(kx, kz, 10.5, 10.5, ka, y0 - 0.3, kh, SAND_D, SAND); M.box(kx, kz, 11.4, 11.4, ka, kh - 1.2, kh, SAND, CAP);
    for (let k = 0; k < 4; k++) { const a = ka + k * Math.PI / 2, ox = Math.cos(a) * 5.6, oz = Math.sin(a) * 5.6; M.box(kx + ox, kz + oz, 4.2, 1.2, a + Math.PI / 2, kh, kh + 1, SAND, CAP); M.box(kx - ox * 0.0 + Math.cos(a + 1.57) * 0, kz, 0.01, 0.01, 0, 0, 0, SAND); }
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) M.box(kx + Math.cos(ka) * dx * 2 - Math.sin(ka) * dz * 2, kz + Math.sin(ka) * dx * 2 + Math.cos(ka) * dz * 2, 1.2, 1.4, ka, kh, kh + 1.0, SAND, CAP);
    for (let k = 0; k < 3; k++) { const wy = y0 + 5 + k * 3.4; M.box(kx + Math.cos(ka + 1.57) * 5.3, kz + Math.sin(ka + 1.57) * 5.3, 0.9, 0.2, ka, wy, wy + 1.5, [0.1, 0.1, 0.12]); }   // slit windows
    M.box(kx - Math.cos(ka + 1.57) * 5.3, kz - Math.sin(ka + 1.57) * 5.3, 2.0, 0.3, ka, y0, y0 + 3.2, [0.18, 0.12, 0.08]);   // door
    for (let q = 0; q < 4; q++) { const a = ka + q * Math.PI / 2, ox = Math.cos(a) * 5.25, oz = Math.sin(a) * 5.25; W.push([kx + ox - Math.sin(a) * 5.25, kz + oz + Math.cos(a) * 5.25, kx + ox + Math.sin(a) * 5.25, kz + oz - Math.cos(a) * 5.25, 0.6, kh]); }
    // low barracks / storehouses inside the walls, half ruined
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26 + 0.4, rr = 9 + (k % 2) * 6, bx = kx + Math.cos(a) * rr * 1.3, bz = kz + Math.sin(a) * rr * 0.9; if (!inPoly(C, bx, bz) || distPoly(C, bx, bz) < 5) continue;
      const h = 2.6 + hash(bx, bz) * 1.2; M.box(bx, bz, 7, 4, a, y0 - 0.2, y0 + h, SAND_D, SAND); W.push([bx - Math.cos(a) * 3, bz - Math.sin(a) * 3, bx + Math.cos(a) * 3, bz + Math.sin(a) * 3, 2.0, y0 + h]);
    }
    // lighthouse (Faro de Sancti-Petri)
    const L = this.D.lighthouse; if (L) { const lx = L.reduce((s, p) => s + p[0], 0) / L.length, lz = L.reduce((s, p) => s + p[1], 0) / L.length, ly = this.rasH(lx, lz) > 0 ? Math.max(this.rasH(lx, lz), y0 - 0.5) : y0;
      M.cyl(lx, lz, 2.3, 1.5, ly, ly + 10, 12, [0.9, 0.9, 0.88], [0.95, 0.95, 0.93]); M.cyl(lx, lz, 2.2, 2.2, ly + 10, ly + 10.5, 12, [0.2, 0.2, 0.22]); M.cyl(lx, lz, 1.0, 1.0, ly + 10.5, ly + 12.2, 8, [0.9, 0.85, 0.5], [1.0, 0.95, 0.6]); M.cyl(lx, lz, 1.5, 0.1, ly + 12.2, ly + 13.4, 8, [0.7, 0.15, 0.12], [0.75, 0.18, 0.12]);
      T.push([lx, lz, 2.3, ly + 13.4]); }
    return M;
  }
  bushes() {
    const g = new THREE.IcosahedronGeometry(1, 0), m = new THREE.MeshLambertMaterial({ vertexColors: false }), N = 700, im = new THREE.InstancedMesh(g, m, N), M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0; const P = this.D.island, [x0, x1, z0, z1] = this.bb;
    for (let t = 0; t < 12000 && n < N; t++) {
      const x = x0 + hash(t, 11) * (x1 - x0), z = z0 + hash(t, 29) * (z1 - z0); if (!inPoly(P, x, z)) continue;
      const pr = this.profile(x, z); if (pr.d < 14 || (distPoly(this.D.castle, x, z) < 10) || fbm(x * 0.02, z * 0.02) < 0.38) continue;
      const s = 0.5 + hash(t, 5) * 1.0; M.compose(new THREE.Vector3(x, pr.h + 0.1 + s * 0.35, z), q, new THREE.Vector3(s * 1.3, s * 0.8, s * 1.3)); im.setMatrixAt(n, M);
      col.setHSL(0.20 + hash(t, 3) * 0.08, 0.35 + hash(t, 4) * 0.2, 0.28 + hash(t, 6) * 0.14); im.setColorAt(n, col); n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); this.group.add(im);
  }
  pier(mat) {
    const P = this.D.pier; if (!P || P.length < 3) return; const M = new Mesh(), xs = P.map(p => p[0]), zs = P.map(p => p[1]);
    let mx = 0, mz = 0; for (const p of P) { mx += p[0] / P.length; mz += p[1] / P.length; } let sxx = 0, szz = 0, sxz = 0; for (const p of P) { const a = p[0] - mx, b = p[1] - mz; sxx += a * a; szz += b * b; sxz += a * b; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ca = Math.cos(ang), sa = Math.sin(ang); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of P) { const a = p[0] - mx, b = p[1] - mz, u = a * ca + b * sa, v = -a * sa + b * ca; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const len = u1 - u0, wid = Math.max(2.6, v1 - v0), cu = (u0 + u1) / 2, cx = mx + cu * ca, cz = mz + cu * sa, deck = 1.5;
    M.box(cx, cz, len, wid, ang, deck - 0.3, deck, [0.45, 0.33, 0.22], [0.62, 0.48, 0.33]);
    for (let u = -len / 2 + 1; u <= len / 2; u += 4) for (const s of [-1, 1]) { const px = cx + ca * u - sa * s * (wid / 2 - 0.2), pz = cz + sa * u + ca * s * (wid / 2 - 0.2); M.cyl(px, pz, 0.22, 0.22, -1.8, deck + 0.6, 6, [0.28, 0.2, 0.14]); }
    this.group.add(new THREE.Mesh(M.geometry(), mat));
    this.solids.walls.push([cx - ca * len / 2, cz - sa * len / 2, cx + ca * len / 2, cz + sa * len / 2, wid / 2, deck]);
  }
  ruins(mat) {   // Temple of Hercules (Melqart): the remains lie on the southern rocks; approximate column stumps on a low platform
    const M = new Mesh(), P = this.D.island; let best = P[0]; for (const p of P) if (p[1] > best[1]) best = p;
    const cx = best[0] + 0, cz = best[1] - 22, y = Math.max(this.rasH(cx, cz), 0.8), S = [0.78, 0.74, 0.66];
    M.box(cx, cz, 14, 9, 0.3, y - 0.3, y + 0.35, mul(S, 0.8), S);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { const u = -5.5 + i * 2.2, px = cx + Math.cos(0.3) * u - Math.sin(0.3) * s * 3, pz = cz + Math.sin(0.3) * u + Math.cos(0.3) * s * 3, h = 0.4 + hash(px, pz) * 2.2; M.cyl(px, pz, 0.55, 0.5, y + 0.3, y + 0.3 + h, 8, mul(S, 0.85), S); }
    this.group.add(new THREE.Mesh(M.geometry(), mat));
  }
  // ---- solids (castle, lighthouse, pier): true if a body at height y is inside one
  hit(x, z, y) {
    if (!this.active || x < this.bb[0] || x > this.bb[1] || z < this.bb[2] || z > this.bb[3]) return false;
    for (const t of this.solids.circ) { if (y < t[3] && Math.hypot(x - t[0], z - t[1]) < t[2]) return true; }
    for (const w of this.solids.walls) {
      if (y > w[5]) continue; const ax = w[0], az = w[1], dx = w[2] - ax, dz = w[3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < w[4]) return true;
    }
    return false;
  }
  update(cam) {
    if (!this.active) return; const d = Math.hypot(cam.x - this.cc[0], cam.z - this.cc[1]);
    this.group.visible = d < 5200; this.detail.visible = d < 2200;
  }
}
