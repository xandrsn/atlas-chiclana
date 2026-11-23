// Chiclana tram: the real line (data/tram/tram.json from scripts/tram_build.mjs, OSM ODbL: tracks A and B, double-track zones, 7 stops)
// with its rails drawn on the streets and two own-design trams (2 cars, pantograph, lamps, doors; no logos) that run a deterministic
// timetable between the termini, stopping at every station with the doors open. The timetable and the "meet only inside a double-track
// zone" offset are the v1 ones (public/js/tram.js). Northbound (+s) on A, southbound on B; at each terminus the tram slides across to the
// other track during its long dwell.
// Draw cost: 1 draw call. One InstancedMesh over a geometry holding 4 car models (pantograph or not x doors closed / open) and the whole
// track (model 4, world space, filled per chunk once its cells' ground is resident); aSel picks the model per instance (lowpoly.js).
// Player hooks (sim/play.js): near() to board, the tram objects are ridable vehicles ({ x, y, z, h, v, pose(a) }), hit() for collisions.
import * as THREE from 'three';
import { Builder, LAMP } from '../lowpoly.js';
import { inBox } from './park_math.js';

const STEP = 3, CAR = 16, HL = 7.9, HW = 1.3, BOGIE = 5.2, HALF = CAR + 0.15;   // m: track sample spacing, car pitch, car half length / width, bogie offset, half tram
const ACC = 1.0, VMAX = 15, DWELL = 18, TDWELL = 45, DOOR_RAMP = 2.5, LIFT = 0.25, SMOOTH = 5;   // timetable (m/s, s); rails over the height grid (asphalt is +0.22)
const WHITE = '#ecebe6', DARK = '#26282b', GLASS = '#22303b', BED = '#77746d', RAIL = '#b9bdc2', LIVERY = '#1f8a7a';

/** a beam from a to b ([y, z] in the car's side plane) of half width w across x and thickness t */
function beam(B, a, b, w, t) {
  const dy = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dy, dz) || 1, ny = -dz / l * t / 2, nz = dy / l * t / 2, k = [];
  for (let i = 0; i < 8; i++) { const p = i & 4 ? b : a, s = i & 2 ? 1 : -1; k.push(new THREE.Vector3(i & 1 ? w : -w, p[0] + s * ny, p[1] + s * nz)); }
  B.hexa(k);
}
/** one car, cab at +z, articulation bellows at -z. Origin on the rails at the car centre. */
export function buildTramCar({ pant, open }) {
  const B = new Builder();
  B.style(DARK).box(-1.15, 1.15, 0.12, 0.42, -HL + 0.3, HL - 0.3);
  for (const z of [-BOGIE, BOGIE]) B.style('#1b1c1e').box(-1.05, 1.05, 0, 0.5, z - 1.3, z + 1.3);
  B.style(LIVERY, true).box(-HW, HW, 0.42, 1.02, -HL, HL);                 // skirt in the livery colour (instance colour)
  B.style(GLASS, LAMP.glass).box(-HW + 0.02, HW - 0.02, 1.02, 2.42, -HL, HL);   // window band
  B.style(WHITE).box(-HW, HW, 2.42, 3.12, -HL, HL);
  B.style('#c9cbcd').box(-1.12, 1.12, 3.12, 3.28, -HL + 0.4, HL - 0.4);
  B.style('#8a8d91').box(-0.7, 0.7, 3.28, 3.6, -4.6, -2.2); B.box(-0.6, 0.6, 3.28, 3.5, 2.8, 4.4);   // roof equipment
  for (let z = -HL + 0.6; z < HL - 0.5; z += 1.55) if (Math.abs(Math.abs(z) - 3.4) > 1.0) B.style(WHITE).box(-HW - 0.01, HW + 0.01, 1.02, 2.42, z - 0.08, z + 0.08);   // window pillars
  for (const zd of [-3.4, 3.4]) {   // a double door on each side: closed = livery leaves with windows, open = the dark doorway
    if (open) B.style('#18191b').box(-HW - 0.015, HW + 0.015, 0.42, 2.38, zd - 0.68, zd + 0.68);
    else { B.style(LIVERY, true).box(-HW - 0.015, HW + 0.015, 0.42, 2.38, zd - 0.68, zd + 0.68); B.style(GLASS, LAMP.glass).box(-HW - 0.03, HW + 0.03, 1.15, 2.2, zd - 0.6, zd + 0.6); B.style(DARK).box(-HW - 0.04, HW + 0.04, 0.42, 2.38, zd - 0.02, zd + 0.02); }
  }
  // cab: raked nose, windscreen, head / tail lamps, a blank destination display
  const v = (x, y, z) => new THREE.Vector3(x, y, z), nose = [v(-HW, 0.42, HL), v(HW, 0.42, HL), v(-HW, 3.12, HL), v(HW, 3.12, HL), v(-1.1, 0.42, HL + 0.75), v(1.1, 0.42, HL + 0.75), v(-1.05, 3.12, HL + 0.25), v(1.05, 3.12, HL + 0.25)];
  B.style(WHITE).hexa(nose, f => f === 'z+' ? null : undefined);
  const lerp = (a, b, t) => a.clone().lerp(b, t), f0 = [nose[4], nose[5], nose[7], nose[6]], at = (u, y) => { const a = lerp(f0[0], f0[3], y), b = lerp(f0[1], f0[2], y); return lerp(a, b, u).add(v(0, 0, 0.012)); };
  B.style(LIVERY, true).quad(at(0, 0), at(1, 0), at(1, 0.3), at(0, 0.3), v(0, 1, HL));
  B.style(GLASS, LAMP.glass).quad(at(0.06, 0.38), at(0.94, 0.38), at(0.92, 0.86), at(0.08, 0.86), v(0, 1, HL));
  B.style('#f0b030').quad(at(0.25, 0.89), at(0.75, 0.89), at(0.75, 0.97), at(0.25, 0.97), v(0, 1, HL));
  for (const [u0, code] of [[0.06, LAMP.head], [0.2, LAMP.tail], [0.72, LAMP.tail], [0.84, LAMP.head]]) B.style('#fff3cc', code).quad(at(u0, 0.12), at(u0 + 0.1, 0.12), at(u0 + 0.1, 0.2), at(u0, 0.2), v(0, 1, HL));
  B.style(DARK).box(-1.15, 1.15, 0.45, 3.0, -HL - 0.16, -HL);   // bellows
  if (pant) {   // diamond pantograph over the middle of the roof
    B.style('#3a3c40').box(-0.5, 0.5, 3.28, 3.42, -0.8, 0.8);
    B.style('#55585c'); beam(B, [3.42, -0.7], [4.25, 0.35], 0.35, 0.06); beam(B, [4.25, 0.35], [4.95, -0.35], 0.3, 0.05);
    B.style('#2b2d30').box(-0.95, 0.95, 4.95, 5.02, -0.42, -0.28);
  }
  return B.geometry();
}

/** resampled polyline with lazily filled, smoothed heights: at(s) -> { x, y, z, tx, tz } (y NaN while its cells are not resident) */
class Track {
  constructor(pts, bridges, k) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.len = cum.at(-1); const n = this.n = Math.ceil(this.len / STEP) + 1; this.X = new Float32Array(n); this.Z = new Float32Array(n); this.R = new Float32Array(n).fill(NaN); this.Y = new Float32Array(n).fill(NaN);
    for (let i = 0, j = 1; i < n; i++) {
      const s = Math.min(this.len, i * STEP); while (j < pts.length - 1 && cum[j] < s) j++;
      const t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); this.X[i] = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t; this.Z[i] = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t;
    }
    this.bridges = (bridges || []).map(([a, b]) => [Math.max(0, Math.floor(a * k / STEP) - 2), Math.min(n - 1, Math.ceil(b * k / STEP) + 2)]);
  }
  /** sample the terrain where it is resident (T(x, z) -> y | null), then heights: smoothed raw, straight across a bridge (no deck baked for it) */
  fill(T, fx, fz, r) {
    let changed = false;
    for (let i = 0; i < this.n; i++) if (Number.isNaN(this.R[i]) && Math.abs(this.X[i] - fx) < r && Math.abs(this.Z[i] - fz) < r) { const y = T(this.X[i], this.Z[i]); if (y != null) { this.R[i] = y; changed = true; } }
    if (!changed) return false;
    const R = this.R, n = this.n;
    for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let d = -SMOOTH; d <= SMOOTH; d++) { const q = i + d; if (q >= 0 && q < n) { if (Number.isNaN(R[q])) { c = -1; break; } a += R[q]; c++; } } this.Y[i] = c > 0 ? a / c + LIFT : NaN; }
    for (const [i0, i1] of this.bridges) for (let i = i0; i <= i1; i++) this.Y[i] = this.Y[i0] + (this.Y[i1] - this.Y[i0]) * (i - i0) / ((i1 - i0) || 1);
    return true;
  }
  at(s, o) {
    s = Math.max(0, Math.min(this.len, s)); const f = s / STEP, i = Math.min(this.n - 2, Math.floor(f)), t = f - i;
    o.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t; o.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; o.y = this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t;
    const i0 = Math.max(0, i - 1), i1 = Math.min(this.n - 1, i + 2), tx = this.X[i1] - this.X[i0], tz = this.Z[i1] - this.Z[i0], l = Math.hypot(tx, tz) || 1; o.tx = tx / l; o.tz = tz / l; return o;
  }
}

/** deterministic timetable over the stop centres S (m along A): state(t) -> { s, dir, w (0 = track A .. 1 = B), doors 0..1, st (station index or -1), v } */
export function makeSchedule(S) {
  const segs = []; let t = 0; const n = S.length;
  const move = (s0, s1, dir) => { const d = Math.abs(s1 - s0), full = d >= VMAX * VMAX / ACC, v = full ? VMAX : Math.sqrt(d * ACC), dur = full ? d / VMAX + VMAX / ACC : 2 * Math.sqrt(d / ACC); segs.push({ t0: t, t1: t + dur, s0, s1, dir, move: true, v }); t += dur; };
  const dwell = (s, dir, st, long, w0, w1) => { const dur = long ? TDWELL : DWELL; segs.push({ t0: t, t1: t + dur, s0: s, s1: s, dir, st, w0, w1, long }); t += dur; };
  for (let i = 0; i < n - 1; i++) { dwell(S[i], 1, i, i === 0, i === 0 ? 1 : 0, 0); move(S[i], S[i + 1], 1); }
  dwell(S[n - 1], -1, n - 1, true, 0, 1);
  for (let i = n - 1; i > 0; i--) { move(S[i], S[i - 1], -1); if (i > 1) dwell(S[i - 1], -1, i - 1, false, 1, 1); }
  const T = t, sm = x => x * x * (3 - 2 * x);
  return { T, state(tt, o = {}) {
    tt = ((tt % T) + T) % T; let g = segs[0];
    for (const x of segs) if (tt >= x.t0 && tt < x.t1) { g = x; break; }
    const tau = tt - g.t0, dur = g.t1 - g.t0; o.dir = g.dir; o.doors = 0; o.st = -1; o.v = 0;
    if (!g.move) {
      o.s = g.s0; o.st = g.st; o.doors = Math.max(0, Math.min(1, tau / DOOR_RAMP, (dur - tau) / DOOR_RAMP));
      o.w = g.long ? g.w0 + (g.w1 - g.w0) * sm(Math.max(0, Math.min(1, (tau - 10) / (dur - 20)))) : g.w0;   // terminus: slide across to the other track mid-dwell
    } else {
      const d = Math.abs(g.s1 - g.s0), a = ACC, v = g.v, ta = v / a, flat = d >= v * v / a, tf = flat ? (d - v * v / a) / v : 0; let x, sp;
      if (tau < ta) { x = 0.5 * a * tau * tau; sp = a * tau; } else if (flat && tau < ta + tf) { x = v * v / (2 * a) + v * (tau - ta); sp = v; } else { const r = dur - tau; x = d - 0.5 * a * r * r; sp = a * r; }
      o.s = g.s0 + Math.sign(g.s1 - g.s0) * x; o.w = g.dir > 0 ? 0 : 1; o.v = sp;
    }
    return o;
  } };
}

export class Trams {
  /** data: data/tram/tram.json; names: stop names (data/transit.json, people's names already replaced) or null; t0: clock start (s) */
  constructor({ scene, mat, data, names, t0 = 0 }) {
    this.data = data; this.A = new Track(data.A, data.bridges, 1); this.k = (() => { const B = new Track(data.B, [], 1); return B.len / this.A.len; })(); this.B = new Track(data.B, data.bridges, this.k);
    // a stop on a bridge (Remedios, over the river; no deck is baked there) moves to the nearer bridge end so riders step off onto land
    const offBridge = c => { for (const [a, b] of data.bridges || []) if (c > a - HALF - 2 && c < b + HALF + 2) return c - a < b - c ? a - HALF - 2 : b + HALF + 2; return c; };
    this.stations = data.stations.map((s, i) => ({ name: names?.[i] || s.name, c: Math.min(this.A.len - HALF, Math.max(HALF, offBridge(s.sA))) }));   // the tram centre stops here
    this.sched = makeSchedule(this.stations.map(s => s.c));
    this.clock = t0; this.trams = this.offsets().map(off => ({ off, cur: {}, prev: {}, x: 0, y: 0, z: 0, h: 0, v: 0, ceil: Infinity, pose: null, save() {} }));
    for (const tr of this.trams) { this.sched.state(this.clock + tr.off, tr.cur); Object.assign(tr.prev, tr.cur); tr.pose = a => this.ridePose(tr, a); }
    // geometry: 4 car models + the track (B only inside the double-track zones: elsewhere A and B are the same rails)
    const cars = [[1, 0], [1, 1], [0, 0], [0, 1]].map(([pant, open]) => buildTramCar({ pant, open }));
    this.runs = [[this.A, 0, this.A.n - 1]]; for (const [a, b] of data.zones) this.runs.push([this.B, Math.max(0, Math.floor(a * this.k / STEP)), Math.min(this.B.n - 1, Math.ceil(b * this.k / STEP))]);
    const QUADS = 4, segs = this.runs.reduce((n, [, a, b]) => n + b - a, 0), carV = cars.reduce((n, g) => n + g.attributes.position.count, 0), N = carV + segs * QUADS * 6;
    const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), col = new Float32Array(N * 3), paint = new Float32Array(N), model = new Float32Array(N);
    let o = 0; cars.forEach((g, m) => { const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); paint.set(g.attributes.aPaint.array, o); model.fill(m, o, o + c); o += c; });
    model.fill(4, o); this.trackAt = o;
    const G = this.geo = new THREE.BufferGeometry();
    for (const [k, a, n] of [['position', pos, 3], ['normal', nrm, 3], ['color', col, 3], ['aPaint', paint, 1], ['aModel', model, 1]]) G.setAttribute(k, new THREE.BufferAttribute(a, n));
    G.setAttribute('aSel', new THREE.InstancedBufferAttribute(new Float32Array([1, 3, 1, 3, 5]), 1)); G.setAttribute('aLights', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, -1, 0]), 2));
    const im = this.mesh = new THREE.InstancedMesh(G, mat, 5); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const livery = new THREE.Color(LIVERY); for (let i = 0; i < 5; i++) im.setColorAt(i, livery);
    scene.add(im); this.chunks = this.runs.map(() => new Set()); this.t = 1;
    this.M = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.P = {}; this.Q = {};
  }
  /** time offset of the 2nd tram so that every meeting happens inside a double-track zone (centres >= 20 m from where the tracks merge) */
  offsets() {
    const T = Math.floor(this.sched.T), arr = [], tmp = {}, margin = s => { let m = -1e9; for (const [a, b] of this.data.zones) m = Math.max(m, Math.min(s - a, b - s)); return m; };
    for (let t = 0; t < T; t++) { this.sched.state(t, tmp); arr.push(tmp.s); }
    let best = null;
    for (let d = 60; d < T - 60; d += 2) {
      let ok = true; for (let t = 0; t < T && ok; t++) { const a = arr[t], b = arr[(t + d) % T]; if (Math.abs(a - b) < 2 * HALF + 10 && Math.min(margin(a), margin(b)) < 20) ok = false; }
      if (ok && (best == null || Math.abs(d - T / 2) < Math.abs(best - T / 2))) best = d;
    }
    return best == null ? [0] : [0, best];
  }
  /** point at arc length s (along A) blended between A (w 0) and B (w 1) */
  at(s, w, o) {
    this.A.at(s, o); if (w > 0) { const q = this.B.at(s * this.k, this.Q), l = 1 - w; o.x = o.x * l + q.x * w; o.z = o.z * l + q.z * w; o.y = o.y * l + q.y * w; o.tx = o.tx * l + q.tx * w; o.tz = o.tz * l + q.tz * w; const m = Math.hypot(o.tx, o.tz) || 1; o.tx /= m; o.tz /= m; }
    return o;
  }
  /** car j (0 = the +s car) of a tram state: { x, y, z, yaw (model +z), pitch } or null while its ground is not in */
  car(c, j, out = {}) {
    const sc = c.s + (j ? -1 : 1) * CAR / 2, P = this.P, a = this.at(sc + BOGIE, c.w, P), ax = a.x, ay = a.y, az = a.z, b = this.at(sc - BOGIE, c.w, P);
    if (Number.isNaN(ay) || Number.isNaN(b.y)) return null;
    out.x = (ax + b.x) / 2; out.y = (ay + b.y) / 2; out.z = (az + b.z) / 2; out.yaw = Math.atan2(ax - b.x, az - b.z) + (j ? Math.PI : 0); out.pitch = Math.atan2(ay - b.y, 2 * BOGIE) * (j ? 1 : -1);
    return out;
  }
  /** fixed step: advance the clock, poses of the ridable objects (centre of the tram, heading = travel direction) */
  step(h) {
    this.clock += h;
    for (const tr of this.trams) {
      Object.assign(tr.prev, tr.cur); this.sched.state(this.clock + tr.off, tr.cur);
      const c = tr.cur, p = this.at(c.s, c.w, this.P); tr.x = p.x; tr.z = p.z; if (!Number.isNaN(p.y)) tr.y = p.y; tr.h = Math.atan2(-p.tx * c.dir, -p.tz * c.dir); tr.v = c.v;
    }
  }
  ridePose(tr, a) {
    const c = tr.cur, q = tr.prev, s = q.s + (c.s - q.s) * a, w = q.w + (c.w - q.w) * a, p = this.at(s, w, this.P);
    return { x: p.x, y: Number.isNaN(p.y) ? tr.y : p.y, z: p.z, h: Math.atan2(-p.tx * c.dir, -p.tz * c.dir), roll: 0, pitch: 0 };
  }
  /** per frame: fill the track where the ground came in (twice a second), write the 4 car instances at the interpolated state */
  update(dt, alpha, focus, T) {
    if ((this.t += dt) > 0.5) { this.t = 0; this.fillTrack(T, focus.x, focus.z); }
    const { M, q, e, p, one } = this, o = {};
    this.trams.forEach((tr, i) => {
      const c = tr.cur, pv = tr.prev, st = { s: pv.s + (c.s - pv.s) * alpha, w: pv.w + (c.w - pv.w) * alpha };
      for (let j = 0; j < 2; j++) {
        const k = i * 2 + j, r = this.car(st, j, o);
        if (r) M.compose(p.set(r.x, r.y, r.z), q.setFromEuler(e.set(r.pitch, r.yaw, 0, 'YXZ')), one); else M.makeScale(0, 0, 0);
        M.toArray(this.mesh.instanceMatrix.array, k * 16);
        this.geo.attributes.aSel.array[k] = (j ? 3 : 1) + (c.doors > 0.5 ? 1 : 0);   // models 0/1 front car (pantograph), 2/3 rear; +1 = doors open
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true; this.geo.attributes.aSel.needsUpdate = true;
  }
  /** track chunks (16 samples) whose heights are known get their quads written once: ballast bed + two rails */
  fillTrack(T, fx, fz, r = 700) {
    const pos = this.geo.attributes.position, col = this.geo.attributes.color, nrm = this.geo.attributes.normal, CH = 16; let base = this.trackAt, dirty = false;
    const bed = new THREE.Color(BED), rail = new THREE.Color(RAIL), grew = new Set([this.A, this.B].filter(tr => tr.fill(T, fx, fz, r)));
    this.runs.forEach(([tr, a, b], ri) => {
      if (grew.has(tr)) {
        for (let c0 = a; c0 < b; c0 += CH) {
          if (this.chunks[ri].has(c0)) continue; const c1 = Math.min(b, c0 + CH); let ok = true;
          for (let i = c0; i <= c1 && ok; i++) ok = !Number.isNaN(tr.Y[i]);
          if (!ok) continue; this.chunks[ri].add(c0); dirty = true;
          for (let i = c0; i < c1; i++) {
            let v = base + (i - a) * 24;
            const sx = (j, off, up) => { const x0 = tr.X[j], z0 = tr.Z[j], j0 = Math.max(0, j - 1), j1 = Math.min(tr.n - 1, j + 1), tx = tr.X[j1] - tr.X[j0], tz = tr.Z[j1] - tr.Z[j0], l = Math.hypot(tx, tz) || 1; return [x0 - tz / l * off, tr.Y[j] + up, z0 + tx / l * off]; };
            const quad = (o0, o1, up, c) => { for (const [j, off] of [[i, o0], [i, o1], [i + 1, o1], [i, o0], [i + 1, o1], [i + 1, o0]]) { pos.array.set(sx(j, off, up), v * 3); nrm.array.set([0, 1, 0], v * 3); col.array.set([c.r, c.g, c.b], v * 3); v++; } };
            quad(-1.25, 1.25, 0, bed); quad(-0.79, -0.71, 0.05, rail); quad(0.71, 0.79, 0.05, rail); quad(-0.1, 0.1, 0.01, bed);   // last: spare (keeps 24 vertices per segment)
          }
        }
      }
      base += (b - a) * 24;
    });
    if (dirty) { pos.needsUpdate = col.needsUpdate = nrm.needsUpdate = true; }
  }
  /** the tram (ridable object) whose body is within r of (x, z), or null */
  near(x, z, r) {
    const o = {}; let best = null, bd = Infinity;
    for (const tr of this.trams) for (let j = 0; j < 2; j++) { const c = this.car(tr.cur, j, o); if (c && inBox(x, z, c.x, c.z, c.yaw, HL + 0.8, HW, r)) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = tr; } } }
    return best;
  }
  /** a mover of radius r at (x, z) bumps into a tram car */
  hit(x, z, r) { return !!this.near(x, z, r); }
  /** obstacle points for the ambient traffic: 3 per car */
  points(out) { const o = {}; for (const tr of this.trams) for (let j = 0; j < 2; j++) { const c = this.car(tr.cur, j, o); if (c) for (const d of [-5, 0, 5]) out.push({ x: c.x + Math.sin(c.yaw) * d, z: c.z + Math.cos(c.yaw) * d, r: 1.4 }); } return out; }
  /** stop the tram is at (doors open) or heading to */
  nextStop(tr) { const c = tr.cur, S = this.stations; if (c.st >= 0) return S[c.st].name; let best = null, bd = Infinity; for (const s of S) { const d = (s.c - c.s) * c.dir; if (d > 5 && d < bd) { bd = d; best = s; } } return best?.name ?? ''; }
}
