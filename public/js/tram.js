import * as THREE from 'three';

// Tranvía de la Bahía de Cádiz, línea L1 (Chiclana: Pelagatos ⇄ Pinar de los Franceses). Geometry and stops from OSM (scripts/tram_build.mjs -> data/tram/tram.json).
// Two Alstom Citadis 302-style trams (cream body, green band/doors, as in the Commons photos) run a deterministic timetable (pure function of the clock):
// northbound on track A, southbound on track B; they pass each other only inside the real double-track sections. On foot, E boards a tram that is
// stopped at a station with its doors open; the walker then rides inside (position follows the module) and E gets off at the next open-door stop.
// The module hooks are step()/draw() in main.js (fixed physics step + per-frame interpolation), so the rider is perfectly in sync.
const ROOF = 3.36, MOD = 6.5, NMOD = 5, HALF = 16.25, STEP = 2, RAIL = 0.13, FLOOR = 0.42;
const ACC = 1.0, VMAX = 13.5, DWELL = 26, TDWELL = 70, DOOR_RAMP = 3;
const hex = c => new THREE.Color(c);

class Boxes {   // merged, vertex-coloured box soup -> one draw call
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  add(cx, cy, cz, sx, sy, sz, color, yaw = 0, rx = 0) {
    const col = hex(color), cy0 = Math.cos(yaw), sy0 = Math.sin(yaw), cx0 = Math.cos(rx), sx0 = Math.sin(rx);
    const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
    const rot = (x, y, z) => { const y1 = y * cx0 - z * sx0, z1 = y * sx0 + z * cx0; return [x * cy0 + z1 * sy0, y1, -x * sy0 + z1 * cy0]; };
    for (const [nn, vs] of F) {
      const b = this.p.length / 3, nr = rot(...nn);
      for (const v of vs) { const r = rot(v[0] * sx / 2, v[1] * sy / 2, v[2] * sz / 2); this.p.push(cx + r[0], cy + r[1], cz + r[2]); this.n.push(...nr); this.c.push(col.r, col.g, col.b); }
      this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return this;
  }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i); g.computeBoundingSphere(); return g; }
}
const LAM = new THREE.MeshLambertMaterial({ vertexColors: true });
const GLASS = new THREE.MeshLambertMaterial({ color: 0x15202b, transparent: true, opacity: 0.42, depthWrite: false });

/** Citadis-like module geometry: module(cab) -> nose toward local -z. Local frame: x right, y up (0 = rail top), z along (+z = increasing s for the rear cab handled by rotation). */
function moduleGeos(cab) {
  const B = new Boxes(), G = new Boxes(), D = new Boxes(), CREAM = '#e9e4d6', GREEN = '#2f9d46', LIME = '#8ed13f', GREY = '#d8dbde', DARK = '#2c3036';
  B.add(0, 0.34, 0, 2.4, 0.16, 6.3, '#7d8085').add(0, 0.2, 0, 2.2, 0.3, 6.0, DARK);              // floor + underframe
  B.add(0, 3.2, 0, 2.3, 0.16, 6.3, GREY).add(0, 3.36, -1.1, 1.4, 0.18, 2.0, '#575b61').add(0, 3.36, 1.5, 1.4, 0.18, 1.6, '#575b61');   // roof + AC pods
  for (const s of [-1, 1]) {
    const x = s * 1.16;
    B.add(x, 2.75, 0, 0.08, 0.7, 6.3, GREEN);                                                       // green band
    B.add(x, 0.875, 0, 0.08, 0.75, 2.8, CREAM);                                                     // sill between the doors
    B.add(x, 1.41, -2.925, 0.08, 1.98, 0.45, CREAM).add(x, 1.41, 2.925, 0.08, 1.98, 0.45, CREAM);   // end posts
    B.add(x, 1.82, 0, 0.1, 1.15, 0.07, '#9aa0a6');                                                   // window pillar
    G.add(s * 1.19, 1.82, 0, 0.03, 1.15, 2.8, '#0b1118');                                            // window glass
    G.add(s * 1.19, 1.8, -2.05, 0.03, 0.95, 1.0, '#0b1118').add(s * 1.19, 1.8, 2.05, 0.03, 0.95, 1.0, '#0b1118');   // door windows
    for (const z of [-2.05, 2.05]) D.add(s * 1.2, 1.41, z, 0.07, 1.98, 1.3, LIME).add(s * 1.2, 1.9, z, 0.08, 0.9, 0.9, '#10202a');   // closed door leaves
    // seats along the side walls between the doors
    B.add(s * 0.9, 0.62, -0.55, 0.45, 0.14, 1.0, '#3b5f8c').add(s * 1.06, 0.95, -0.55, 0.1, 0.5, 1.0, '#3b5f8c').add(s * 0.9, 0.62, 0.55, 0.45, 0.14, 1.0, '#3b5f8c').add(s * 1.06, 0.95, 0.55, 0.1, 0.5, 1.0, '#3b5f8c');
    B.add(s * 0.2, 1.8, -1.2, 0.04, 2.8, 0.04, '#c9ccd0').add(s * 0.2, 1.8, 1.2, 0.04, 2.8, 0.04, '#c9ccd0');   // grab poles
  }
  B.add(0, 2.97, 3.27, 2.1, 0.3, 0.2, DARK).add(-1.0, 1.7, 3.27, 0.15, 2.4, 0.2, DARK).add(1.0, 1.7, 3.27, 0.15, 2.4, 0.2, DARK);   // bellows frame (rear joint)
  if (cab) {
    B.add(0, 1.0, -3.35, 2.3, 1.2, 0.4, CREAM).add(0, 0.55, -3.5, 2.2, 0.35, 0.3, GREEN);        // nose
    B.add(0, 2.15, -3.28, 2.25, 1.3, 0.08, '#101820', 0, -0.32);                                   // windscreen
    B.add(0, 3.0, -3.25, 2.3, 0.5, 0.5, GREEN, 0, 0.35).add(0, 1.7, -2.4, 2.2, 2.7, 0.08, '#6c7076');   // roof nose + cab bulkhead
    B.add(-0.8, 0.8, -3.58, 0.28, 0.14, 0.05, '#fff7d6').add(0.8, 0.8, -3.58, 0.28, 0.14, 0.05, '#fff7d6');
  } else B.add(0, 2.97, -3.27, 2.1, 0.3, 0.2, DARK).add(-1.0, 1.7, -3.27, 0.15, 2.4, 0.2, DARK).add(1.0, 1.7, -3.27, 0.15, 2.4, 0.2, DARK);
  return { body: B.geo(), glass: G.geo(), doors: D.geo() };
}

class Track {   // resampled polyline (2 m) with a smoothed height profile; at(s) -> x,y,z + tangent
  constructor(pts, hf, bridges, scaleToA) {
    let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.len = len; const n = Math.ceil(len / STEP) + 1; this.n = n; this.X = new Float32Array(n); this.Z = new Float32Array(n); this.Y = new Float32Array(n);
    for (let k = 0, j = 1; k < n; k++) {
      const s = Math.min(len, k * STEP); while (j < pts.length - 1 && cum[j] < s) j++;
      const t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); this.X[k] = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t; this.Z[k] = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t;
    }
    const raw = Float32Array.from(this.X, (x, k) => hf.height(x, this.Z[k]));
    for (const [b0, b1] of bridges || []) {   // viaduct: straight line between the abutments instead of the river bed
      const i0 = Math.max(0, Math.floor(b0 * scaleToA / STEP) - 2), i1 = Math.min(n - 1, Math.ceil(b1 * scaleToA / STEP) + 2);
      for (let k = i0; k <= i1; k++) raw[k] = raw[i0] + (raw[i1] - raw[i0]) * (k - i0) / ((i1 - i0) || 1);
    }
    for (let k = 0; k < n; k++) { let a = 0, c = 0; for (let d = -5; d <= 5; d++) { const q = k + d; if (q >= 0 && q < n) { a += raw[q]; c++; } } this.Y[k] = a / c + RAIL; }
  }
  at(s, o) {
    s = Math.max(0, Math.min(this.len, s)); const f = s / STEP, i = Math.min(this.n - 2, Math.floor(f)), t = f - i;
    o.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t; o.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; o.y = this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t;
    const i0 = Math.max(0, i - 1), i1 = Math.min(this.n - 1, i + 2); let tx = this.X[i1] - this.X[i0], tz = this.Z[i1] - this.Z[i0]; const l = Math.hypot(tx, tz) || 1; o.tx = tx / l; o.tz = tz / l; return o;
  }
}

/** Deterministic timetable. Stops are the tram CENTRE positions along A (m). legs: move/dwell, cycle T. state(t) -> {s,dir,w,doors,st,next,v} */
function makeSchedule(S) {
  const segs = []; let t = 0; const n = S.length;
  const move = (s0, s1, dir) => { const d = Math.abs(s1 - s0), v = d >= VMAX * VMAX / ACC ? VMAX : Math.sqrt(d * ACC), dur = d >= VMAX * VMAX / ACC ? d / VMAX + VMAX / ACC : 2 * Math.sqrt(d / ACC); segs.push({ t0: t, t1: t + dur, s0, s1, dir, type: 'move', v }); t += dur; };
  const dwell = (s, dir, st, long, w0, w1) => { const dur = long ? TDWELL : DWELL; segs.push({ t0: t, t1: t + dur, s0: s, s1: s, dir, type: 'dwell', st, w0, w1 }); t += dur; };
  for (let i = 0; i < n - 1; i++) { dwell(S[i], 1, i, i === 0, i === 0 ? 1 : 0, 0); move(S[i], S[i + 1], 1); }
  dwell(S[n - 1], -1, n - 1, true, 0, 1);
  for (let i = n - 1; i > 0; i--) { move(S[i], S[i - 1], -1); if (i > 1) dwell(S[i - 1], -1, i - 1, false, 1, 1); }
  const T = t; const last = segs.at(-1);   // arrival at the first station closes the cycle: its dwell is the first segment
  void last;
  const sm = x => x * x * (3 - 2 * x);
  const out = { T, segs, state(tt, o = {}) {
    tt = ((tt % T) + T) % T; let g = segs[0];
    for (let i = 0; i < segs.length; i++) if (tt >= segs[i].t0 && tt < segs[i].t1) { g = segs[i]; break; }
    const tau = tt - g.t0, dur = g.t1 - g.t0; o.dir = g.dir; o.doors = 0; o.st = -1; o.v = 0;
    if (g.type === 'dwell') {
      o.s = g.s0; o.st = g.st; o.doors = Math.min(1, tau / DOOR_RAMP, (dur - tau) / DOOR_RAMP);
      const long = dur > DWELL + 1, k = long ? Math.max(0, Math.min(1, (tau - 14) / (dur - 28))) : 1;   // sideways shift A<->B in the middle of a terminus dwell
      o.w = long ? g.w0 + (g.w1 - g.w0) * sm(k) : g.w0; if (g.dir < 0 && !long) o.w = 1; o.doors = Math.max(0, o.doors); o.next = g.st;
    } else {
      const d = Math.abs(g.s1 - g.s0), a = ACC, v = g.v, ta = v / a, flat = d >= v * v / a, tf = flat ? (d - v * v / a) / v : 0; let x, sp;
      if (tau < ta) { x = 0.5 * a * tau * tau; sp = a * tau; } else if (flat && tau < ta + tf) { x = v * v / (2 * a) + v * (tau - ta); sp = v; } else { const r = dur - tau; x = d - 0.5 * a * r * r; sp = a * r; }
      o.s = g.s0 + Math.sign(g.s1 - g.s0) * x; o.w = g.dir > 0 ? 0 : 1; o.v = sp;
    }
    return o;
  } };
  return out;
}

const Z = { x: 0, y: 0, z: 0, tx: 0, tz: 0 }, Z2 = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

export class Tram {
  constructor(scene, world, walker, data) {
    this.world = world; this.hf = world.hf; this.walker = walker; this.data = data; this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'tram'; scene.add(this.group);
    const sc = data.A ? 1 : 1; void sc;
    this.A = new Track(data.A, this.hf, data.bridges, 1); this.B = new Track(data.B, this.hf, data.bridges, 1); this.k = this.B.len / this.A.len;
    this.stations = data.stations.map(s => ({ ...s, c: Math.max(18, s.sA) }));   // terminus: the tram centre sits half a tram from the end of the track
    this.sched = makeSchedule(this.stations.map(s => s.c));
    this.trams = [];
    const offs = this.pickOffsets(data.zones);
    for (const off of offs) this.trams.push(this.makeTram(off));
    this.t0 = (Date.now() / 1000) % this.sched.T; this.clock = 0; this.rider = null; this._last = null;
    this.buildGates(); this.buildStatic(); this.prompt = this.makePrompt(); this.cache = {};
    for (const tr of this.trams) { this.stateOf(tr, 0, tr.cur); tr.prev = { ...tr.cur }; }
    window.__tram = this;
  }
  inZone(s, margin) { for (const [a, b] of this.data.zones) if (s >= a + margin && s <= b - margin) return true; return false; }
  /** time offset of the 2nd tram so that every meeting happens inside a double-track section (centres >= 20 m from where the tracks merge) */
  pickOffsets(zones) {
    void zones; const T = Math.floor(this.sched.T), arr = new Array(T), tmp = {};
    for (let t = 0; t < T; t++) { this.sched.state(t, tmp); arr[t] = [tmp.s, tmp.dir]; }
    let best = null;
    for (let d = 60; d < T - 60; d += 2) {
      let ok = true, margin = 1e9;
      for (let t = 0; t < T && ok; t++) {
        const a = arr[t], b = arr[(t + d) % T];
        if (Math.abs(a[0] - b[0]) < 45) { const m = Math.min(this.zoneMargin(a[0]), this.zoneMargin(b[0])); if (m < 20) ok = false; else margin = Math.min(margin, m); }
      }
      if (ok && (!best || Math.abs(d - T / 2) < Math.abs(best - T / 2))) best = d;
    }
    return best == null ? [0] : [0, best];
  }
  zoneMargin(s) { let m = -1e9; for (const [a, b] of this.data.zones) m = Math.max(m, Math.min(s - a, b - s)); return m; }
  makeTram(off) {
    const geos = { cab: moduleGeos(true), mid: moduleGeos(false) }, g = new THREE.Group(), mods = [];
    for (let k = 0; k < NMOD; k++) {
      const gg = geos[k === 0 || k === NMOD - 1 ? 'cab' : 'mid'], m = new THREE.Group();
      const body = new THREE.Mesh(gg.body, LAM), glass = new THREE.Mesh(gg.glass, GLASS), doors = new THREE.Mesh(gg.doors, LAM);
      glass.renderOrder = 2; m.add(body, glass, doors); m.userData.doors = doors; m.userData.flip = k === NMOD - 1; g.add(m); mods.push(m);
    }
    g.visible = false; this.group.add(g);
    return { off, g, mods, cur: {}, prev: {} };
  }
  stateOf(tr, dt, o) { return this.sched.state(this.t0 + this.clock + tr.off + dt, o); }
  /** pose of module k at (s, w): world position/tangent of the +s direction */
  pose(s, w, k, out) {
    const sk = s + (k - (NMOD - 1) / 2) * MOD;
    this.A.at(sk, Z); if (w > 0) { this.B.at(sk * this.k, Z2); const l = 1 - w; Z.x = Z.x * l + Z2.x * w; Z.z = Z.z * l + Z2.z * w; Z.y = Z.y * l + Z2.y * w; Z.tx = Z.tx * l + Z2.tx * w; Z.tz = Z.tz * l + Z2.tz * w; const q = Math.hypot(Z.tx, Z.tz) || 1; Z.tx /= q; Z.tz /= q; }
    out.x = Z.x; out.y = Z.y; out.z = Z.z; out.tx = Z.tx; out.tz = Z.tz; return out;
  }

  // ---------------------------------------------------------------- level crossings: every drivable road that crosses the track gets a signal; world.gates is read by traffic.js
  buildGates() {
    const roads = this.world.roads?.roads || [], gates = [], grid = new Map(), C = 12, o = {}, zones = this.data.zones, put = (T, k, s0, s1) => { for (let s = s0; s <= s1; s += 2) { T.at(s, o); const key = Math.floor(o.x / C) + ',' + Math.floor(o.z / C); (grid.get(key) || grid.set(key, []).get(key)).push([o.x, o.z, o.tx, o.tz, s / k]); } };
    put(this.A, 1, 0, this.A.len); for (const [a, b] of zones) put(this.B, this.k, a * this.k, Math.min(this.B.len, b * this.k));
    const nearAx = (x, z) => { let best = null, bd = 1.8; for (let i = Math.floor(x / C) - 1; i <= Math.floor(x / C) + 1; i++) for (let j = Math.floor(z / C) - 1; j <= Math.floor(z / C) + 1; j++) for (const p of grid.get(i + ',' + j) || []) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = p; } } return best; };
    for (const r of roads) { if (!r.drive || r.bridge || r.w < 4.4 || /footway|path|cycleway|steps|pedestrian|track|bridleway|motorway/.test(r.cls)) continue;
      for (let i = 0; i + 1 < r.n; i++) { const ax = r.P[2 * i], az = r.P[2 * i + 1], bx = r.P[2 * i + 2], bz = r.P[2 * i + 3], L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let q = 0; q < L; q += 1.5) { const p = nearAx(ax + ux * q, az + uz * q); if (!p || Math.abs(ux * p[2] + uz * p[3]) > 0.6) continue;
          if (this.onBridge(p[4])) break;   // roads under the viaduct do not cross the rails
          if (gates.some(g => g.r === r && Math.hypot(g.x - p[0], g.z - p[1]) < 14)) break;
          gates.push({ x: p[0], z: p[1], s: p[4], ux, uz, hw: r.w / 2 + 1.5, closed: false, r }); break; } } }
    this.gates = gates; if (this.world.roads) this.world.roads.gates = gates;
  }
  updateGates() {
    for (const g of this.gates) { let closed = false;
      for (const tr of this.trams) { const c = tr.cur, d = (g.s - c.s) * c.dir; if (d > -28 && d < 110 && !(c.st >= 0 && c.doors > 0 && d > 45)) { closed = true; break; } }
      if (closed !== g.closed) { g.closed = closed; this.lampsDirty = true; } }
    if (this.lampsDirty && this.lamps) { this.lampsDirty = false; const col = new THREE.Color(); this.gates.forEach((g, i) => { for (let k = 0; k < 4; k++) this.lamps.setColorAt(i * 4 + k, col.set(g.closed ? 0xff2a1a : 0x2a2e30)); }); this.lamps.instanceColor.needsUpdate = true; }
  }
  // ---------------------------------------------------------------- per fixed step: clock, boarding, rider
  step(dt, mode, keys) {
    this.clock += dt; if (this.gates && ((this._gi = (this._gi || 0) + 1) & 7) === 0) this.updateGates();
    for (const tr of this.trams) { const p = tr.prev; Object.assign(p, tr.cur); this.stateOf(tr, 0, tr.cur); }
    const w = this.walker, r = this.rider;
    if (r) {
      const tr = r.tr, P = {}, c = tr.cur;
      if (mode !== 'walker' || Math.hypot(w.pos.x - r.x, w.pos.z - r.z) > 3) { this.rider = null; return; }   // switched vehicle / teleported (R, Enter)
      this.pose(c.s, c.w, r.k, P); const tx = P.tx, tz = P.tz, rx = -tz, rz = tx;
      // the walker moved by its own physics this step: carry that motion into the module frame (tram motion is applied by re-anchoring)
      const dx = w.pos.x - r.x, dz = w.pos.z - r.z; r.a += dx * r.tx + dz * r.tz; r.b += dx * r.rx + dz * r.rz;
      if (r.a > MOD / 2 && r.k < NMOD - 1) { r.k++; r.a -= MOD; } else if (r.a < -MOD / 2 && r.k > 0) { r.k--; r.a += MOD; }
      r.b = Math.max(-0.95, Math.min(0.95, r.b));
      const lim = r.roof ? 3.1 : 2.1;   // the roof runs over the whole module; inside, the cab bulkheads stop you
      r.a = Math.max(r.k === 0 ? -lim : -MOD / 2 + 0.2, Math.min(r.k === NMOD - 1 ? lim : MOD / 2 - 0.2, r.a));
      this.pose(c.s, c.w, r.k, P); r.tx = P.tx; r.tz = P.tz; r.rx = -P.tz; r.rz = P.tx;
      r.x = P.x + P.tx * r.a + r.rx * r.b; r.z = P.z + P.tz * r.a + r.rz * r.b;
      w.pos.set(r.x, P.y + (r.roof ? ROOF : FLOOR), r.z); w.vy = 0; w.air = false; w.jumps = 0; w.jbuf = 0;
      if (this.wantRoof) { this.wantRoof = false; if (r.roof) this.alight(); }
      if (this.want) { this.want = false; if (r.roof || c.doors > 0.95) this.alight(); }
    } else {
      if (this.wantRoof) { this.wantRoof = false; if (mode === 'walker') this.climb(); }
      if (this.want) { this.want = false; if (mode === 'walker') this.board(); }
    }
  }
  /** nearest stopped tram with open doors to the walker (within 4.5 m laterally of a module) */
  nearBoardable() {
    const w = this.walker.pos; let best = null, bd = 1e9, P = {};
    for (const tr of this.trams) { const c = tr.cur; if (c.doors < 0.95) continue;
      for (let k = 0; k < NMOD; k++) { this.pose(c.s, c.w, k, P); const dx = w.x - P.x, dz = w.z - P.z, a = dx * P.tx + dz * P.tz, b = dx * -P.tz + dz * P.tx;
        if (Math.abs(a) < MOD / 2 + 1 && Math.abs(b) < 4.6 && Math.abs(w.y - P.y) < 2.2) { const d = Math.hypot(a * 0.3, b); if (d < bd) { bd = d; best = { tr, k, a, b }; } } } }
    return best;
  }
  board() {
    const n = this.nearBoardable(); if (!n) return; const c = n.tr.cur, P = {}; this.pose(c.s, c.w, n.k, P);
    const a = Math.max(n.k === 0 ? -2.1 : -2.6, Math.min(n.k === NMOD - 1 ? 2.1 : 2.6, n.a)), b = Math.sign(n.b || 1) * 0.8;
    this.rider = { tr: n.tr, k: n.k, a, b, x: 0, z: 0, tx: P.tx, tz: P.tz, rx: -P.tz, rz: P.tx };
    const r = this.rider; r.x = P.x + P.tx * a + r.rx * b; r.z = P.z + P.tz * a + r.rz * b; this.walker.pos.set(r.x, P.y + FLOOR, r.z); this.walker.vx = this.walker.vz = 0; this.walker.vy = 0; this.walker.air = false;
  }
  /** any tram module within reach of the walker (ladder rungs on the side): returns {tr,k,a,b} */
  nearTram() {
    const w = this.walker.pos; let best = null, bd = 1e9, P = {};
    for (const tr of this.trams) { const c = tr.cur; for (let k = 0; k < NMOD; k++) { this.pose(c.s, c.w, k, P); const dx = w.x - P.x, dz = w.z - P.z, a = dx * P.tx + dz * P.tz, b = dx * -P.tz + dz * P.tx;
      if (Math.abs(a) < MOD / 2 + 1.5 && Math.abs(b) < 4.8 && Math.abs(w.y - P.y) < 2.2) { const d = Math.hypot(a * 0.3, b); if (d < bd) { bd = d; best = { tr, k, a, b }; } } } }
    return best;
  }
  onBridge(s) { return (this.data.bridges || []).some(([a, b]) => s >= a - 6 && s <= b + 6); }
  climb() {
    const n = this.nearTram(); if (!n) return; const c = n.tr.cur, P = {}; this.pose(c.s, c.w, n.k, P);
    const a = Math.max(-2.6, Math.min(2.6, n.a)), b = Math.max(-0.8, Math.min(0.8, n.b));
    this.rider = { tr: n.tr, k: n.k, a, b, roof: true, x: 0, z: 0, tx: P.tx, tz: P.tz, rx: -P.tz, rz: P.tx };
    const r = this.rider; r.x = P.x + P.tx * a + r.rx * b; r.z = P.z + P.tz * a + r.rz * b; this.walker.pos.set(r.x, P.y + ROOF, r.z); this.walker.vx = this.walker.vz = 0; this.walker.vy = 0; this.walker.air = false;
  }
  alight() {
    const r = this.rider, c = r.tr.cur, P = {}; this.pose(c.s, c.w, r.k, P);
    if (this.onBridge(c.s)) return;   // never step off over the river
    const side = r.b >= 0 ? 1 : -1, x = P.x + P.tx * r.a + (-P.tz) * side * 3.1, z = P.z + P.tz * r.a + P.tx * side * 3.1;
    this.rider = null; this.walker.place(x, z, this.walker.psi);
  }
  nextStation(tr) {   // for the HUD prompt: name of the station the tram is at or heading to
    const c = tr.cur, S = this.stations; if (c.st >= 0) return S[c.st].name;
    let best = null, bd = 1e9; for (let i = 0; i < S.length; i++) { const d = (S[i].c - c.s) * c.dir; if (d > 5 && d < bd) { bd = d; best = i; } } return best == null ? '' : S[best].name;
  }

  // ---------------------------------------------------------------- per frame: interpolated poses, visibility, prompt
  draw(alpha, cam) {
    const P = {};
    for (const tr of this.trams) {
      const c = tr.cur, p = tr.prev, s = p.s + (c.s - p.s) * alpha, w = p.w + (c.w - p.w) * alpha;
      this.pose(s, w, (NMOD - 1) / 2, P);
      const vis = !cam || Math.hypot(P.x - cam.x, P.z - cam.z) < 1100 || this.rider?.tr === tr; tr.g.visible = vis; if (!vis) continue;
      for (let k = 0; k < NMOD; k++) {
        this.pose(s, w, k, P); const m = tr.mods[k];
        m.position.set(P.x, P.y, P.z); m.rotation.y = Math.atan2(P.tx, P.tz) + (m.userData.flip ? Math.PI : 0);   // local -z toward decreasing s; the rear cab is turned round
        m.userData.doors.visible = c.doors < 0.5;
      }
    }
    this.updatePrompt();
  }
  makePrompt() {
    const el = document.createElement('div'); el.className = 'panel'; el.id = 'tramPrompt';
    el.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);padding:8px 16px;font-size:14px;z-index:15;display:none;text-align:center;pointer-events:none';
    document.body.appendChild(el); return el;
  }
  updatePrompt() {
    let html = '';
    const r = this.rider;
    if (r) {
      const nm = this.nextStation(r.tr), c = r.tr.cur, dest = c.dir > 0 ? this.stations.at(-1).name : this.stations[0].name;
      html = r.roof ? (this.onBridge(c.s) ? 'Sobre el techo · puente: no se puede bajar' : '<kbd>T</kbd> Bajar del techo (con cuidado)') : c.doors > 0.95 ? `<kbd>E</kbd> Bajar en <b>${nm}</b>` : `Tranvía L1 → ${dest} · próxima parada: <b>${nm}</b>`;
    } else if (this.walker.group.visible) {
      const n = this.nearBoardable(); if (n) html = `<kbd>E</kbd> Subir al tranvía L1 · <b>${this.nextStation(n.tr)}</b> · <kbd>T</kbd> Subir al techo`; else if (this.nearTram()) html = '<kbd>T</kbd> Subir al techo del tranvía';
    }
    if (html !== this._html) { this._html = html; this.prompt.innerHTML = html; this.prompt.style.display = html ? 'block' : 'none'; }
  }

  // ---------------------------------------------------------------- static scenery: track bed, rails, catenary, platforms, shelters, name boards
  ribbon(B, T, s0, s1, off, width, y0, color, h = 0.02) {   // flat strip along a track, from s0 to s1 (arc length of T), lateral offset `off`
    const n = Math.max(2, Math.ceil((s1 - s0) / STEP)), o = {}, col = hex(color); let prev = null;
    for (let k = 0; k <= n; k++) {
      T.at(s0 + (s1 - s0) * k / n, o); const rx = -o.tz, rz = o.tx, cx = o.x + rx * off, cz = o.z + rz * off, y = o.y + y0;
      const l = [cx - rx * width / 2, y, cz - rz * width / 2], r = [cx + rx * width / 2, y, cz + rz * width / 2];
      if (prev) { const b = B.p.length / 3; B.p.push(...prev[0], ...prev[1], ...r, ...l); for (let q = 0; q < 4; q++) { B.n.push(0, 1, 0); B.c.push(col.r, col.g, col.b); } B.i.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      prev = [l, r];
    }
    void h;
  }
  buildStatic() {
    const R = new Boxes(), C = new Boxes(), S = new Boxes(), o = {}, o2 = {}, zones = this.data.zones, hf = this.hf;
    const inB = s => zones.some(([a, b]) => s >= a - 4 && s <= b + 4);
    // track bed + rails: A everywhere; B only along the double-track zones
    const lay = (T, s0, s1) => { this.ribbon(R, T, s0, s1, 0, 3.0, -RAIL + 0.07, '#7a746b'); this.ribbon(R, T, s0, s1, -0.834, 0.1, 0.02, '#aeb3b9'); this.ribbon(R, T, s0, s1, 0.834, 0.1, 0.02, '#aeb3b9'); };
    lay(this.A, 0, this.A.len);
    for (const [a, b] of zones) lay(this.B, Math.max(0, (a - 4) * this.k), Math.min(this.B.len, (b + 4) * this.k));
    for (const ln of this.data.extra || []) { if (ln.length < 2) continue; const T = new Track(ln, hf, [], 1); lay(T, 0, T.len); }
    // catenary: poles on the outer side every 40 m, cross-arm over the track, contact wire as lines
    const wires = [], pole = (T, s, sd, dbl) => { T.at(s, o); const rx = -o.tz, rz = o.tx, px = o.x + rx * sd * 2.55, pz = o.z + rz * sd * 2.55, yb = o.y;
      C.add(px, yb + 3.1, pz, 0.16, 6.2, 0.16, '#3a3d42'); C.add(o.x + rx * sd * 1.25, yb + 5.9, o.z + rz * sd * 1.25, 0.1, 0.1, 2.7, '#3a3d42', Math.atan2(rx, rz) + Math.PI / 2 - Math.PI / 2 + Math.PI / 2 * 0).valueOf(); void dbl; };
    void pole; void wires;
    const track = (T, s0, s1, sd) => {   // sd = side of the poles (+1 right of travel / -1 left)
      let prev = null;
      for (let s = s0; s <= s1; s += 40) { T.at(s, o); const rx = -o.tz, rz = o.tx, px = o.x + rx * sd * 2.6, pz = o.z + rz * sd * 2.6, yaw = Math.atan2(o.tx, o.tz);
        C.add(px, o.y + 3.0, pz, 0.15, 6.0, 0.15, '#3a3d42'); C.add(o.x + rx * sd * 1.3, o.y + 5.75, o.z + rz * sd * 1.3, 0.09, 0.09, 2.6, '#3a3d42', yaw + Math.PI / 2 * 0 + 0).add(o.x, o.y + 5.55, o.z, 0.05, 0.05, 0.05, '#222');
        const cur = [o.x, o.y + 5.5, o.z]; if (prev && Math.hypot(cur[0] - prev[0], cur[2] - prev[2]) < 60) wires.push(...prev, ...cur); prev = cur; }
    };
    // arm orientation: boxes above are 2.6 m along local z; rotate to lie across the track -> use yaw = heading + 90°
    C.p.length = 0; C.n.length = 0; C.c.length = 0; C.i.length = 0; wires.length = 0;
    const trackFix = (T, s0, s1, sd) => {
      let prev = null;
      for (let s = s0; s <= s1; s += 40) { T.at(s, o); const rx = -o.tz, rz = o.tx, px = o.x + rx * sd * 2.6, pz = o.z + rz * sd * 2.6, yaw = Math.atan2(o.tx, o.tz) + Math.PI / 2;
        C.add(px, o.y + 3.0, pz, 0.15, 6.0, 0.15, '#3a3d42'); C.add(o.x + rx * sd * 1.3, o.y + 5.75, o.z + rz * sd * 1.3, 0.09, 0.09, 2.6, '#3a3d42', yaw);
        const cur = [o.x, o.y + 5.5, o.z]; if (prev && Math.hypot(cur[0] - prev[0], cur[2] - prev[2]) < 60) wires.push(...prev, ...cur); prev = cur; }
    };
    void track;
    trackFix(this.A, 20, this.A.len - 10, -1);
    for (const [a, b] of zones) { trackFix(this.B, Math.max(20, a * this.k), Math.min(this.B.len - 10, b * this.k), 1); }
    // viaduct slab, parapets and piers where the line crosses a river (bridges from tram.json)
    for (const [b0, b1] of this.data.bridges || []) for (const [T, k] of [[this.A, 1], [this.B, this.k]]) { if (T === this.B && !zones.some(([a, b]) => b0 >= a && b1 <= b)) continue;
      for (let s = b0 * k - 6; s <= b1 * k + 6; s += 3) { T.at(s, o); const yaw = Math.atan2(o.tx, o.tz); S.add(o.x, o.y - RAIL - 0.55, o.z, 4.6, 1.0, 3.2, '#a9a49a', yaw); for (const sd of [-1, 1]) S.add(o.x + -o.tz * sd * 2.2, o.y - RAIL + 0.35, o.z + o.tx * sd * 2.2, 0.15, 0.9, 3.2, '#8f8b82', yaw);
        if (Math.round(s / 3) % 6 === 0) { const g = hf.height(o.x, o.z), hh = o.y - RAIL - 1.05 - g; if (hh > 0.5) S.add(o.x, g + hh / 2, o.z, 1.6, hh, 1.6, '#9b968c', yaw); } } }
    // stations: platform on the outer side of each track (A: left of its direction when B is on the right, etc.), shelter, name board
    this.boards = new Boxes(); const names = this.stations.map(s => s.name.toUpperCase()), cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128 * names.length;
    { const g = cv.getContext('2d'); g.fillStyle = '#12503a'; g.fillRect(0, 0, cv.width, cv.height); g.textBaseline = 'middle';
      names.forEach((nm, i) => { g.fillStyle = '#12503a'; g.fillRect(0, i * 128, 1024, 128); g.fillStyle = '#fff'; g.font = 'bold 56px sans-serif'; g.fillText(nm.length > 24 ? nm.slice(0, 22) + '…' : nm, 150, i * 128 + 64); g.fillStyle = '#8ed13f'; g.beginPath(); g.arc(72, i * 128 + 64, 46, 0, 7); g.fill(); g.fillStyle = '#0d3a2a'; g.font = 'bold 54px sans-serif'; g.fillText('L1', 38, i * 128 + 66); }); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const bp = [], bu = [], bi = [];
    this.stations.forEach((st, si) => {
      for (const tk of [{ T: this.A, s: st.c, kk: 1 }, { T: this.B, s: st.c * this.k, kk: this.k }]) {
        const T = tk.T, other = T === this.A ? this.B : this.A, oc = T === this.A ? st.c * this.k : st.c;
        T.at(tk.s, o); other.at(oc, o2); const rx = -o.tz, rz = o.tx, dbl = Math.hypot(o2.x - o.x, o2.z - o.z) > 2.5, side = dbl ? -Math.sign((o2.x - o.x) * rx + (o2.z - o.z) * rz) : (T === this.A ? 1 : -1);
        if (!dbl && T === this.B) continue;                                    // single track: one platform only (on A's right)
        const L = 36, yaw = Math.atan2(o.tx, o.tz), pc = 2.75 * side, onBr = (this.data.bridges || []).some(([a, b]) => st.sA >= a - 8 && st.sA <= b + 8), gh = (px, pz) => onBr ? o.y - RAIL : hf.height(px, pz);
        for (let d = -L / 2; d < L / 2; d += 3) {
          T.at(tk.s + d + 1.5, o); const px = o.x + -o.tz * pc, pz = o.z + o.tx * pc, y = gh(px, pz) + 0.12, yw = Math.atan2(o.tx, o.tz);
          S.add(px, (y + o.y - RAIL) / 2 - 0.1, pz, 2.7, Math.abs(y - (o.y - RAIL)) + 0.5, 3.05, '#b9b5ac', yw);
          S.add(o.x + -o.tz * side * 1.5, y + 0.01, o.z + o.tx * side * 1.5, 0.4, 0.04, 3.05, '#f2c200', yw);   // yellow tactile strip
        }
        T.at(tk.s, o); const bx = o.x + -o.tz * side * 4.0, bz = o.z + o.tx * side * 4.0, by = gh(bx, bz) + 0.12;
        S.add(bx, by + 2.5, bz, 2.2, 0.1, 9, '#2c3036', yaw).add(bx + -o.tz * side * 1.0, by + 1.2, bz + o.tx * side * 1.0, 0.06, 2.3, 9, '#14202a', yaw);   // canopy + glass back
        S.add(bx, by + 0.45, bz, 0.5, 0.08, 3, '#8a8f95', yaw);                                                                                         // bench
        for (const dz of [-4.4, 4.4]) S.add(bx + o.tx * dz, by + 1.25, bz + o.tz * dz, 0.12, 2.5, 0.12, '#2c3036', yaw);
        // name board (textured quad) on the track-facing edge of the canopy, readable from the tram and from the platform
        const w = 5, h = 0.62, hx = o.tx * w / 2, hz = o.tz * w / 2, cx = o.x + -o.tz * side * 3.2, cz = o.z + o.tx * side * 3.2, cy = by + 3.2, b0 = bp.length / 3;
        bp.push(cx - hx, cy - h / 2, cz - hz, cx + hx, cy - h / 2, cz + hz, cx + hx, cy + h / 2, cz + hz, cx - hx, cy + h / 2, cz - hz);
        const v0 = 1 - (si + 1) / names.length, v1 = 1 - si / names.length; bu.push(0, v0, 1, v0, 1, v1, 0, v1); bi.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3, b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
        S.add(cx - hx * 0.9, cy - 1.5, cz - hz * 0.9, 0.08, 3.0, 0.08, '#2c3036').add(cx + hx * 0.9, cy - 1.5, cz + hz * 0.9, 0.08, 3.0, 0.08, '#2c3036');
      }
    });
    // signals: a pole with a lamp head on each side of the road, both approaches; lamps are one InstancedMesh recoloured by updateGates()
    const lampM = new THREE.Matrix4(), lampPos = [];
    for (const g of this.gates) for (const [sd, sg] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = -g.uz, nz = g.ux, px = g.x - g.ux * sd * 7 + nx * sg * (g.hw - 0.4), pz = g.z - g.uz * sd * 7 + nz * sg * (g.hw - 0.4), y = hf.height(px, pz); if (this.world.roads?.keep?.(px, pz, 0)) { lampPos.push(null); continue; }
      S.add(px, y + 1.6, pz, 0.14, 3.2, 0.14, '#3a3d42'); S.add(px, y + 3.35, pz, 0.34, 0.9, 0.3, '#1a1c1f', Math.atan2(g.ux, g.uz)); lampPos.push([px, y + 3.5, pz, Math.atan2(-g.ux * sd, -g.uz * sd)]); }
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.26, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampPos.length)); lamps.frustumCulled = false;
    lampPos.forEach((p, i) => { if (p) { lampM.makeRotationY(p[3]); lampM.setPosition(p[0] + Math.sin(p[3]) * 0.17, p[1], p[2] + Math.cos(p[3]) * 0.17); } else lampM.makeScale(0, 0, 0); lamps.setMatrixAt(i, lampM); lamps.setColorAt(i, new THREE.Color(0x2a2e30)); });
    this.lamps = lamps; this.group.add(lamps);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2)); bg.setIndex(bi); bg.computeVertexNormals(); bg.computeBoundingSphere();
    const mats = [new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), LAM, LAM];
    for (const [b, m] of [[R, mats[0]], [C, mats[1]], [S, mats[2]]]) { const me = new THREE.Mesh(b.geo(), m); me.frustumCulled = false; me.matrixAutoUpdate = false; this.group.add(me); }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1c20 })); wl.frustumCulled = false; this.group.add(wl);
    const bm = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); bm.frustumCulled = false; this.group.add(bm);
  }
}
