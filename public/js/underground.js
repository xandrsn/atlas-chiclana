// Underground roads (tunnels, underpasses) and car parks. Data: scripts/underground.mjs -> data/[madrid/]underground.json (OSM tunnel=yes highways + parking polygons).
// Floor profile of a way: depth(s) = min(D, SLOPE*s at a grade end, SLOPE*(L-s) at a grade end); where the terrain is less than ROOF m above the floor the DEM is carved into an
// open trench, deeper down a closed tube (floor, walls, ceiling, lights, lane marks) is built on demand.
// The terrain is a coarse heightfield (7.7 m cells in Madrid) and cannot hold a clean cut, so nothing is carved: the trench mouth is a strip on the ground that resets the depth
// buffer to "far" (renderOrder PUNCH, after terrain and roads); trench / tube meshes (PUNCH + 1) and vehicles / people (PUNCH + 2, set in update) are drawn after it and show through.
// Queries: floor() (walkable/drivable height), under() + blocks() (collision, hooked in Buildings.hit), ceil() (camera).
import * as THREE from 'three';
import { toLocal } from './geo.js';

const STEP = 4, SLOPE = 0.09, CELLQ = 32, SECT = 14, SHOW = 420;
const ROAD = { D: 8, H: 5.2 }, RAMP = { D: 4.5, H: 3.2 }, HALL_H = 3.2;
const roofDepth = h => h + 0.8, PUNCH = 6;
const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
function resample(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { let [ax, az] = pts[i - 1]; const [bx, bz] = pts[i]; let d = Math.hypot(bx - ax, bz - az);
    while (acc + d >= step) { const t = (step - acc) / d; ax += (bx - ax) * t; az += (bz - az) * t; out.push([ax, az]); d = Math.hypot(bx - ax, bz - az); acc = 0; }
    acc += d; }
  const L = pts[pts.length - 1]; if (Math.hypot(L[0] - out[out.length - 1][0], L[1] - out[out.length - 1][1]) > 0.5) out.push(L);
  return out;
}
const ll = p => { const o = []; for (let i = 0; i < p.length; i += 2) o.push(toLocal(p[i], p[i + 1])); return o; };

export class Underground {
  /** build the model (no meshes yet). Call carve() on a fresh model before the terrain is created. */
  constructor(scene, hf, data) {
    this.scene = scene; this.hf = hf; this.ways = []; this.halls = []; this.grid = new Map(); this.sect = new Map(); this.grp = new THREE.Group(); scene.add(this.grp);
    for (const t of data.t || []) this.addWay(ll(t.p), t.w, !!t.e0, !!t.e1, ROAD, t.n);
    for (const k of data.k || []) {
      const poly = ll(k.poly), r = ll(k.ramp); if (poly.length < 3 || r.length < 2) continue;
      const w = this.addWay(r, 5.6, true, false, RAMP, k.n + ' (rampa)'); if (!w) continue;
      const Y0 = w.Y[w.Y.length - 1], hall = { n: k.n, poly, Y0, ramp: w, H: HALL_H, bb: [1e9, -1e9, 1e9, -1e9] }; w.hall = hall;
      for (const [x, z] of poly) { hall.bb[0] = Math.min(hall.bb[0], x); hall.bb[1] = Math.max(hall.bb[1], x); hall.bb[2] = Math.min(hall.bb[2], z); hall.bb[3] = Math.max(hall.bb[3], z); }
      let be = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > be) { be = d; hall.u = [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; } }
      hall.o = poly[0]; this.halls.push(hall);
    }
    // depth = min(D, SLOPE * distance along the tunnel NETWORK to the nearest end at grade), so forks and links meet at one height (per-way depths left steps of several metres)
    const key = p => Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4), nd = new Map(), dist = k => nd.get(k) ?? Infinity;
    for (const w of this.ways) { w.k0 = key(w.P[0]); w.k1 = key(w.P[w.P.length - 1]); if (w.e0) nd.set(w.k0, 0); if (w.e1) nd.set(w.k1, 0); }
    for (let go = true; go;) { go = false; for (const w of this.ways) { const a = dist(w.k0), b = dist(w.k1); if (a + w.L < b - 0.01) { nd.set(w.k1, a + w.L); go = true; } else if (b + w.L < a - 0.01) { nd.set(w.k0, b + w.L); go = true; } } }
    for (const w of this.ways) { const a = dist(w.k0), b = dist(w.k1), flat = !w.hall && a === 0 && b === 0 && SLOPE * w.L / 2 < 1.5;   // too short to get under anything: stays a strip at grade (was a pothole)
      for (let i = 0; i < w.P.length; i++) { w.dep[i] = flat ? 0 : Math.min(w.T.D, SLOPE * Math.min(a + w.s[i], b + w.L - w.s[i])); w.Y[i] = w.G[i] - w.dep[i]; } }
    for (const h of this.halls) h.Y0 = h.ramp.Y[h.ramp.Y.length - 1];
    // dead ends that stay deep get a concrete cap (an end that meets another tube / ramp stays open)
    const eps = new Map();
    for (const w of this.ways) for (const p of [w.P[0], w.P[w.P.length - 1]]) eps.set(key(p), (eps.get(key(p)) || 0) + 1);
    for (const w of this.ways) { const th = roofDepth(w.T.H); w.cap0 = !w.e0 && w.dep[0] >= th && eps.get(key(w.P[0])) < 2; w.cap1 = !w.e1 && w.dep[w.P.length - 1] >= th && eps.get(key(w.P[w.P.length - 1])) < 2 && !w.hall; }
  }
  addWay(P0, w, e0, e1, T, name) {
    if (P0.length < 2) return null;
    const P = resample(P0, STEP), n = P.length; if (n < 2) return null;
    const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = s[n - 1], G = P.map(p => this.hf.height(p[0], p[1])), Y = new Float32Array(n), dep = new Float32Array(n);
    for (let i = 0; i < n; i++) { let d = T.D; if (e0) d = Math.min(d, SLOPE * s[i]); if (e1) d = Math.min(d, SLOPE * (L - s[i])); dep[i] = d; Y[i] = G[i] - d; }
    const hw = w / 2 + 0.9, way = { P, s, L, G, Y, dep, w, hw, T, name, id: this.ways.length, e0, e1 };
    this.ways.push(way);
    for (let i = 0; i < n - 1; i++) {   // segment index in the coarse grid (cells touched by the segment + half-width)
      const [ax, az] = P[i], [bx, bz] = P[i + 1], x0 = Math.floor((Math.min(ax, bx) - hw) / CELLQ), x1 = Math.floor((Math.max(ax, bx) + hw) / CELLQ), z0 = Math.floor((Math.min(az, bz) - hw) / CELLQ), z1 = Math.floor((Math.max(az, bz) + hw) / CELLQ);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a * 100003 + b; (this.grid.get(k) || this.grid.set(k, []).get(k)).push(way.id * 65536 + i); }
    }
    return way;
  }
  carve() {}   // kept for main.js: trenches are depth-punched now (see top), the DEM stays intact
  /** is (x,z) at height y well inside a way other than `not`? (parallel tubes, forks: no wall between them) */
  inOther(x, z, y, not) {
    const l = this.grid.get(Math.floor(x / CELLQ) * 100003 + Math.floor(z / CELLQ));
    if (l) for (const code of l) {
      const w = this.ways[code >> 16]; if (w === not) continue;
      const i = code & 65535, [ax, az] = w.P[i], [bx, bz] = w.P[i + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < w.hw - 0.4 && Math.abs(w.Y[i] + (w.Y[i + 1] - w.Y[i]) * t - y) < 2.5) return true;
    }
    return false;
  }
  /** pseudo road records for traffic.js (P = x,z pairs ~4 m apart, Y floor heights) */
  roads() {
    return this.ways.filter(w => w.P.length >= 4 && w.w >= 4.4).map(w => { const P = new Float32Array(w.P.length * 2); w.P.forEach((p, i) => { P[2 * i] = p[0]; P[2 * i + 1] = p[1]; });
      const cx = (w.P[0][0] + w.P[w.P.length - 1][0]) / 2, cz = (w.P[0][1] + w.P[w.P.length - 1][1]) / 2;
      return { P, Y: w.Y, n: w.P.length, w: w.w, ow: false, drive: true, cls: 'tunnel', u: 0, tier: 1, spec: [0, 0], cx, cz, rad: w.L / 2 }; });
  }
  // ------------------------------------------------------------------ queries
  /** nearest way segment containing (x,z) whose floor is within `tol` of yRef (yRef null: deepest/any). Returns {y, way} or null */
  near(x, z, yRef, tol = 2.2) {
    const l = this.grid.get(Math.floor(x / CELLQ) * 100003 + Math.floor(z / CELLQ)); let best = null, bd = 1e9;
    if (l) for (const code of l) {
      const w = this.ways[code >> 16], i = code & 65535, [ax, az] = w.P[i], [bx, bz] = w.P[i + 1], dx = bx - ax, dz = bz - az, ll2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ll2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d > w.hw) continue;
      const y = w.Y[i] + (w.Y[i + 1] - w.Y[i]) * t, dy = yRef == null ? 0 : Math.abs(y - yRef);
      if (dy > tol || d + dy * 0.1 >= bd) continue;
      bd = d + dy * 0.1; best = { y, way: w, t, i };
    }
    return best;
  }
  hallAt(x, z, yRef, tol = 2.2) {
    for (const h of this.halls) { if (x < h.bb[0] || x > h.bb[1] || z < h.bb[2] || z > h.bb[3]) continue; if ((yRef != null && Math.abs(h.Y0 - yRef) > tol) || !pip(h.poly, x, z)) continue; return h; }
    return null;
  }
  /** underground walking/driving surface height at (x,z) near yRef, or null */
  floor(x, z, yRef) {
    const n = this.near(x, z, yRef), h = this.hallAt(x, z, yRef);
    if (h && (!n || Math.abs(h.Y0 - yRef) < Math.abs(n.y - yRef))) return h.Y0;
    return n ? n.y : null;
  }
  /** is the body below the visible ground (so the surface buildings and the ground must be ignored)? */
  under(x, z, y) { return y < this.hf.height(x, z) - 0.8; }
  pillar(h, x, z) { const dx = x - h.o[0], dz = z - h.o[1], u = dx * h.u[0] + dz * h.u[1], v = -dx * h.u[1] + dz * h.u[0], m = 9, a = ((u % m) + m) % m, b = ((v % m) + m) % m; return Math.min(a, m - a) < 0.45 && Math.min(b, m - b) < 0.45; }
  /** collision for a point below the ground: solid unless inside a tube / hall (pillars are solid) */
  blocks(x, z, y) {
    if (this.pit?.(x, z)) return false;   // metro stairwell (metro.js): open air below the pavement
    const h = this.hallAt(x, z, y, 3); if (h) return y > h.Y0 + h.H || this.pillar(h, x, z);
    const n = this.near(x, z, y, 4); return !n || y > n.y + n.way.T.H;
  }
  /** ceiling height above (x,z,y) if inside a tube / hall, else Infinity */
  ceil(x, z, y) { const h = this.hallAt(x, z, y, 3); if (h) return h.Y0 + h.H; const n = this.near(x, z, y, 3); return n ? n.y + n.way.T.H : Infinity; }

  // ------------------------------------------------------------------ meshes (built in sections near the camera)
  /** footprint of every tube / trench / hall within HOLE m of (cx,cz), rasterised at 1 m into a red mask the terrain shader discards with while the camera is
   *  below ground (from inside, the coarse DEM mesh sags through the ceiling; from outside the mask is off and the ground over the tubes is drawn as usual) */
  hole(cx, cz) {
    const N = 512, S = this.terrain.shared;
    if (!this._hc) { this._hc = document.createElement('canvas'); this._hc.width = this._hc.height = N; const t = new THREE.CanvasTexture(this._hc); t.flipY = false; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; S.ugHole.value = t; }
    const g = this._hc.getContext('2d'), x0 = Math.round(cx) - N / 2, z0 = Math.round(cz) - N / 2, X = x => x - x0, Z = z => z - z0;
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.strokeStyle = g.fillStyle = '#f00'; g.lineCap = g.lineJoin = 'round';
    for (const w of this.ways) { if (w.P.every(p => Math.abs(p[0] - cx) > N / 2 + 20 || Math.abs(p[1] - cz) > N / 2 + 20)) continue;
      g.lineWidth = 2 * w.hw + 1; g.beginPath(); w.P.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke(); }
    for (const h of this.halls) { g.lineWidth = 2; g.beginPath(); h.poly.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.closePath(); g.fill(); g.stroke(); }
    S.ugHole.value.needsUpdate = true; S.ugRect.value.set(x0, z0, N, N); this._hk = [cx, cz];
  }
  update(cam) {
    if (this.terrain) {   // the hole is on only while the camera is below the ground
      const on = cam.y < this.hf.height(cam.x, cam.z) - 0.2; this.terrain.shared.ugOn.value = on ? 1 : 0;
      if (on && (!this._hk || Math.hypot(cam.x - this._hk[0], cam.z - this._hk[1]) > 150)) this.hole(cam.x, cam.z);
    }
    if (this._c && Math.hypot(cam.x - this._c[0], cam.z - this._c[1]) < 8) return; this._c = [cam.x, cam.z];   // scanning every way each frame cost ~0.4 ms in Madrid
    { const s = window.__sim, ro = o => { o.renderOrder = PUNCH + 2; };   // whatever can be inside a trench is drawn after the depth punch, else the ground hides it
      if (s) { for (const o of [s.car, s.heli, s.walker]) o?.group?.traverse(ro); for (const f of s.traffic?.fleets || []) ro(f.im); if (s.npcs?.mesh) ro(s.npcs.mesh); } }
    const R2 = SHOW * SHOW, need = new Set();
    for (const w of this.ways) {
      for (let a = 0; a < w.P.length - 1; a += SECT) {
        const p = w.P[Math.min(a + SECT / 2, w.P.length - 1)], dx = p[0] - cam.x, dz = p[1] - cam.z;
        if (dx * dx + dz * dz > R2 + 5000) continue; const key = w.id + ':' + a; need.add(key);
        if (!this.sect.has(key)) { const m = this.buildSection(w, a, Math.min(a + SECT, w.P.length - 1)); this.sect.set(key, m); if (m) this.grp.add(m); }
      }
    }
    for (const h of this.halls) { const key = 'h' + this.halls.indexOf(h), cx = (h.bb[0] + h.bb[1]) / 2 - cam.x, cz = (h.bb[2] + h.bb[3]) / 2 - cam.z; if (cx * cx + cz * cz > R2) continue; need.add(key); if (!this.sect.has(key)) { const m = this.buildHall(h); this.sect.set(key, m); if (m) this.grp.add(m); } }
    for (const [k, m] of this.sect) if (!need.has(k)) { if (m) { this.grp.remove(m); m.traverse(o => { o.geometry?.dispose(); }); } this.sect.delete(k); }
  }
  mats() {
    return this._m || (this._m = {
      // own light: the sun does not reach a tube, so the colour is mostly emissive (lamp-lit concrete) with a little of the scene light for shape
      floor: new THREE.MeshLambertMaterial({ color: 0x1c1d20, emissive: 0x1d1e21, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), wall: new THREE.MeshLambertMaterial({ color: 0x4a4842, emissive: 0x6a675e, side: THREE.DoubleSide }),
      roof: new THREE.MeshLambertMaterial({ color: 0x2a2927, emissive: 0x2c2b28, side: THREE.DoubleSide }), line: new THREE.MeshBasicMaterial({ color: 0xd8d8d0, side: THREE.DoubleSide }),
      edge: new THREE.MeshBasicMaterial({ color: 0xd8b53a, side: THREE.DoubleSide }), lamp: new THREE.MeshBasicMaterial({ color: 0xfff1c4, side: THREE.DoubleSide, fog: false }),
      pil: new THREE.MeshLambertMaterial({ color: 0x5a5852, emissive: 0x7a776e }),
      sign: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#0d7a3e'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#fff'; x.font = 'bold 40px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('↑ SALIDA', 128, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() }),
      mouth: new THREE.ShaderMaterial({ polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12, vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.05, 0.05, 0.06, 1.0); gl_FragDepth = 1.0; }' }),
    });
  }
  buildSection(w, a, b) {
    const M = this.mats(), B = () => ({ p: [], i: [] }), g = { floor: B(), wall: B(), roof: B(), line: B(), edge: B(), lamp: B(), mouth: B() };
    const quad = (G, A, Bq, C, D) => { const o = G.p.length / 3; G.p.push(...A, ...Bq, ...C, ...D); G.i.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const th = roofDepth(w.T.H), H = w.T.H;
    const side = i => { const P = w.P, j = Math.min(i + 1, P.length - 1), k = Math.max(i - 1, 0), tx = P[j][0] - P[k][0], tz = P[j][1] - P[k][1], l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; };
    let any = false; const n = w.P.length, rf = j => j >= 0 && j < n - 1 && w.dep[j] >= th && w.dep[j + 1] >= th, gy = p => this.hf.height(p[0], p[2]);
    for (let i = a; i < b; i++) {
      const [nx, nz] = side(i), [mx, mz] = side(i + 1), A = w.P[i], Bp = w.P[i + 1], y0 = w.Y[i], y1 = w.Y[i + 1], hw = w.hw, hl = w.w / 2;
      if (w.hall && pip(w.hall.poly, (A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2)) continue;   // the ramp's last metres are inside the hall: no tube walls / roof across the car park
      const roofed = rf(i), wall = (P0, P1, t0, t1) => { if (!this.inOther((P0[0] + P1[0]) / 2, (P0[2] + P1[2]) / 2, (y0 + y1) / 2, w)) quad(g.wall, P0, P1, [P1[0], t1, P1[2]], [P0[0], t0, P0[2]]); };
      const L0 = [A[0] + nx * hw, y0, A[1] + nz * hw], R0 = [A[0] - nx * hw, y0, A[1] - nz * hw], L1 = [Bp[0] + mx * hw, y1, Bp[1] + mz * hw], R1 = [Bp[0] - mx * hw, y1, Bp[1] - mz * hw];
      quad(g.floor, L0, R0, R1, L1); any = true;
      const up = (p, h) => [p[0], p[1] + h, p[2]];
      if (roofed) {
        wall(L0, L1, y0 + H, y1 + H); wall(R0, R1, y0 + H, y1 + H);
        for (const [on, Pl, Pr, k] of [[i > 0 && !rf(i - 1), L0, R0, i], [i < n - 2 && !rf(i + 1), L1, R1, i + 1]]) if (on) quad(g.wall, up(Pl, H), up(Pr, H), [Pr[0], w.G[k] + 0.9, Pr[2]], [Pl[0], w.G[k] + 0.9, Pl[2]]);   // portal headwall up to a parapet
        quad(g.roof, up(L0, H), up(L1, H), up(R1, H), up(R0, H));
        if (i % 2 === 0) { const c0 = [A[0], y0 + H - 0.04, A[1]], c1 = [Bp[0], y1 + H - 0.04, Bp[1]]; quad(g.lamp, [c0[0] + nx * 0.5, c0[1], c0[2] + nz * 0.5], [c1[0] + mx * 0.5, c1[1], c1[2] + mz * 0.5], [c1[0] - mx * 0.5, c1[1], c1[2] - mz * 0.5], [c0[0] - nx * 0.5, c0[1], c0[2] - nz * 0.5]); }
      }
      else if (Math.max(w.dep[i], w.dep[i + 1]) > 0.05) {   // open trench: depth-punched mouth at ground level + retaining walls growing into a 0.9 m parapet
        const c = [L0, L1, R1, R0].map(gy), pa = Math.min(0.9, w.dep[i]), pb = Math.min(0.9, w.dep[i + 1]);
        quad(g.mouth, [L0[0], c[0] + 0.06, L0[2]], [L1[0], c[1] + 0.06, L1[2]], [R1[0], c[2] + 0.06, R1[2]], [R0[0], c[3] + 0.06, R0[2]]);
        wall(L0, L1, c[0] + pa, c[1] + pb); wall(R0, R1, c[3] + pa, c[2] + pb);
      }
      // markings: continuous edge lines, dashed centre line (two-way roads), 0.03 above the floor
      const e = 0.12, y = 0.03;
      for (const sg of [1, -1]) { const o0 = (hl - 0.2) * sg, o1 = o0 + e * sg; quad(g.edge, [A[0] + nx * o0, y0 + y, A[1] + nz * o0], [Bp[0] + mx * o0, y1 + y, Bp[1] + mz * o0], [Bp[0] + mx * o1, y1 + y, Bp[1] + mz * o1], [A[0] + nx * o1, y0 + y, A[1] + nz * o1]); }
      if (w.w > 6.5 && i % 2 === 0) { const t0 = 0.1, t1 = 0.7, c = (t) => [A[0] + (Bp[0] - A[0]) * t, y0 + (y1 - y0) * t + y, A[1] + (Bp[1] - A[1]) * t]; const p0 = c(t0), p1 = c(t1), q = 0.07; quad(g.line, [p0[0] + nx * q, p0[1], p0[2] + nz * q], [p1[0] + nx * q, p1[1], p1[2] + nz * q], [p1[0] - nx * q, p1[1], p1[2] - nz * q], [p0[0] - nx * q, p0[1], p0[2] - nz * q]); }
    }
    for (const [on, i] of [[w.cap0 && a === 0, 0], [w.cap1 && b === w.P.length - 1, w.P.length - 1]]) if (on) {
      const [nx, nz] = side(i), P = w.P[i], y = w.Y[i], hw = w.hw; quad(g.wall, [P[0] + nx * hw, y, P[1] + nz * hw], [P[0] - nx * hw, y, P[1] - nz * hw], [P[0] - nx * hw, y + H, P[1] - nz * hw], [P[0] + nx * hw, y + H, P[1] + nz * hw]);
    }
    if (!any) return null;
    return this.pack(g, M);
  }
  pack(g, M) {
    const grp = new THREE.Group();
    for (const k in g) { const G = g[k]; if (!G.p.length) continue; const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(G.p, 3)); geo.setIndex(G.i); if (G.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); geo.computeVertexNormals(); const m = new THREE.Mesh(geo, M[k]); m.frustumCulled = false; m.renderOrder = k === 'mouth' ? PUNCH : PUNCH + 1; grp.add(m); }
    return grp;
  }
  buildHall(h) {
    const M = this.mats(), B = () => ({ p: [], i: [] }), g = { floor: B(), wall: B(), roof: B(), line: B(), lamp: B(), pil: B(), sign: { p: [], i: [], uv: [] } };
    const box = (G, x, y, z, sx, sy, sz) => { const o = G.p.length / 3; for (const dy of [0, sy]) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.p.push(x + a * sx / 2, y + dy, z + b * sz / 2); G.i.push(o, o + 1, o + 5, o, o + 5, o + 4, o + 1, o + 2, o + 6, o + 1, o + 6, o + 5, o + 2, o + 3, o + 7, o + 2, o + 7, o + 6, o + 3, o, o + 4, o + 3, o + 4, o + 7, o + 4, o + 5, o + 6, o + 4, o + 6, o + 7); };
    const poly = h.poly, tri = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [G, y] of [[g.floor, h.Y0], [g.roof, h.Y0 + h.H]]) { const o = G.p.length / 3; for (const [x, z] of poly) G.p.push(x, y, z); for (const t of tri) G.i.push(o + t[0], o + t[1], o + t[2]); }
    for (let i = 0; i < poly.length; i++) {   // perimeter wall in ~1 m panels, leaving out the ones the ramp passes through (was a solid wall across the entrance)
      const a = poly[i], b = poly[(i + 1) % poly.length], m = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let s = 0; s < m; s++) { const p = [a[0] + (b[0] - a[0]) * s / m, a[1] + (b[1] - a[1]) * s / m], q = [a[0] + (b[0] - a[0]) * (s + 1) / m, a[1] + (b[1] - a[1]) * (s + 1) / m];
        if (this.near((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, h.Y0, 1.5)?.way === h.ramp) continue;
        const o = g.wall.p.length / 3; g.wall.p.push(p[0], h.Y0, p[1], q[0], h.Y0, q[1], q[0], h.Y0 + h.H, q[1], p[0], h.Y0 + h.H, p[1]); g.wall.i.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    }
    { // green "SALIDA" sign hanging over the ramp mouth, facing into the hall
      const R = h.ramp.P, E = R[R.length - 1], D = R[R.length - 2], l = Math.hypot(E[0] - D[0], E[1] - D[1]) || 1, sx = -(E[1] - D[1]) / l * 1.1, sz = (E[0] - D[0]) / l * 1.1, y0 = h.Y0 + h.H - 0.75, y1 = h.Y0 + h.H - 0.2;
      g.sign.p.push(E[0] + sx, y0, E[1] + sz, E[0] - sx, y0, E[1] - sz, E[0] - sx, y1, E[1] - sz, E[0] + sx, y1, E[1] + sz); g.sign.uv.push(0, 0, 1, 0, 1, 1, 0, 1); g.sign.i.push(0, 1, 2, 0, 2, 3);
    }
    // pillars every 9 m, bay lines (2.6 m pitch, 5 m long, in rows 9 m apart), lamps over the aisles
    const [ux, uz] = h.u, inside = (x, z, m = 1) => pip(poly, x, z) && pip(poly, x + ux * m, z + uz * m) && pip(poly, x - ux * m, z - uz * m) && pip(poly, x - uz * m, z + ux * m) && pip(poly, x + uz * m, z - ux * m);
    const pt = (u, v) => [h.o[0] + ux * u - uz * v, h.o[1] + uz * u + ux * v], span = Math.hypot(h.bb[1] - h.bb[0], h.bb[3] - h.bb[2]);
    for (let u = -span; u <= span; u += 9) for (let v = -span; v <= span; v += 9) {
      const [x, z] = pt(u, v); if (!inside(x, z, 1.2)) continue; box(g.pil, x, h.Y0, z, 0.8, h.H, 0.8);
      const [lx, lz] = pt(u + 4.5, v + 4.5); if (inside(lx, lz, 1.2)) box(g.lamp, lx, h.Y0 + h.H - 0.1, lz, 2.4, 0.08, 0.35);
    }
    for (let u = -span; u <= span; u += 2.6) for (let v = -span; v <= span; v += 9) {
      const [x0, z0] = pt(u, v + 0.9), [x1, z1] = pt(u, v + 5.1); if (!pip(poly, x0, z0) || !pip(poly, x1, z1) || this.pillar(h, x0, z0) || this.pillar(h, x1, z1)) continue;
      const o = g.line.p.length / 3, q = 0.05; g.line.p.push(x0 - uz * 0 + ux * q, h.Y0 + 0.03, z0 + uz * q, x1 + ux * q, h.Y0 + 0.03, z1 + uz * q, x1 - ux * q, h.Y0 + 0.03, z1 - uz * q, x0 - ux * q, h.Y0 + 0.03, z0 - uz * q); g.line.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    return this.pack(g, M);
  }
}
