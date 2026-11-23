import * as THREE from 'three';
import { toLocal } from './geo.js';

// Pedestrian NPCs, map-agnostic: everything comes from `data` (see loadNpcData) and from the `world` (roads / buildings / surf) it is given.
// One InstancedMesh draws every person (8 box parts each, per-part colour) and one more draws the terrace tables and chairs: 2 draw calls in total.
// Only people near the camera exist (spawn ring R_MIN..R_MAX, recycled beyond FAR). Behaviours:
//   walk   - along a street (on the pavement side) or a footway of the OSM road graph; turns back at road ends or when a building is in the way
//   sit    - on a chair at a table placed beside a bar / restaurant / cafe venue
//   bench  - on a bench (promenade OSM nodes + bench elements of data/places), facing the way the bench faces
//   stand  - near a house (address points), idle
//   wander - inside plazas / parks / fair grounds: random targets, stops to chat
// They never go through buildings (buildings.hit), stop for the player (<1.8 m) and for any car (<5 m), and are not solid for the player.
const NMAX = 56, FAR = 150, R_MIN = 16, R_MAX = 115, CELL = 64, PARTS = 8, FMAX = 900;
const SHIRT = [0x2f6fb0, 0xb5392c, 0xe6e2d6, 0x3b7d4f, 0xd9a52a, 0x6a4c93, 0x222831, 0xc76f9a, 0x8a9199, 0x1f8a8a, 0xe8e8e8, 0xd96a2b];
const PANTS = [0x2b2f3a, 0x3d4a63, 0x6b5a45, 0x1d1d1f, 0x7b8798, 0xcdbf9f, 0x4a5d3a];
const SKIN = [0xf0c8a0, 0xe0ac84, 0xc68a60, 0x9a6642, 0x6e4529];
const HAIR = [0x1a1410, 0x3a2a1c, 0x6b4a2b, 0xb89a62, 0x8a8a8a, 0x2a2a2a, 0xa5361f];
const WOOD = 0x7a5a3a, IRON = 0x2a2d31;
const pick = a => a[(Math.random() * a.length) | 0], rnd = (a, b) => a + Math.random() * (b - a);
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SIT_RE = /bar|restaur|cafe|helad|comida|taberna|pub|terraza|chiringuito/;
// [w,h,d, x,y,z, kind] kind: 0 body (shirt) 1 pants 2 skin 3 hair; limbs hang from their pivot (x,y,z)
const BODY = [[0.52, 0.66, 0.28, 0, 1.2, 0, 0], [0.52, 0.2, 0.28, 0, 0.9, 0, 1], [0.22, 0.24, 0.24, 0, 1.68, 0, 2], [0.24, 0.09, 0.26, 0, 1.82, 0, 3]];
const LIMBS = [[0.17, 0.85, 0.2, -0.12, 0.9, 0, 1], [0.17, 0.85, 0.2, 0.12, 0.9, 0, 1], [0.12, 0.62, 0.14, -0.3, 1.5, 0, 0], [0.12, 0.62, 0.14, 0.3, 1.5, 0, 0]];

/** Reads the map's data (through the map-aware fetch of maps.js) into the plain lists Npcs needs. Every file is optional. */
export async function loadNpcData() {
  const J = async p => { try { const r = await fetch(p); return r.ok ? await r.json() : null; } catch { return null; } };
  const [venues, prom, places, plazas, parks, addr] = await Promise.all(['venues', 'promenade_raw', 'places_all', 'plazas', 'parks_all', 'addresses'].map(n => J('/data/' + n + '.json')));
  const d = { venues: [], benches: [], crowds: [], homes: [] };
  for (const v of venues || []) if (SIT_RE.test(norm(v.t)) && isFinite(v.x)) d.venues.push({ x: v.x, z: v.z, n: v.n });
  for (const e of prom?.coast || []) if (e.type === 'node' && e.tags?.amenity === 'bench') { const [x, z] = toLocal(e.lon, e.lat), r = (e.id % 628) / 100; d.benches.push({ x, z, fx: Math.sin(r), fz: Math.cos(r) }); }
  for (const p of places?.places || []) {
    const els = p.design?.elements || [], fair = /feria|recinto-ferial/.test(p.slug || '');
    for (const e of els) if (e.kind === 'bench' && e.at) { const [x, z] = toLocal(...e.at), t = Math.PI - (e.rot || 0) * Math.PI / 180; d.benches.push({ x, z, fx: Math.sin(t), fz: Math.cos(t) }); }
    if (fair) { const pts = els.filter(e => e.at && /caseta|carousel|kiosk|tower/.test(e.kind)).map(e => toLocal(...e.at)); if (pts.length) d.crowds.push({ x: pts.reduce((a, q) => a + q[0], 0) / pts.length, z: pts.reduce((a, q) => a + q[1], 0) / pts.length, r: 45, w: 4 }); }
  }
  for (const p of plazas || []) if (p.area > 300 && p.poly) d.crowds.push({ x: p.c[0], z: p.c[1], poly: p.poly, w: Math.sqrt(p.area) / 12 });
  for (const p of parks || []) if (p.poly && p.ar > 600) d.crowds.push({ x: p.c[0], z: p.c[1], poly: p.poly, w: Math.sqrt(p.ar) / 14 });
  for (const a of addr || []) for (const k in a.a) if (Math.random() < 0.25) d.homes.push({ x: a.a[k][0], z: a.a[k][1] });
  return d;
}

const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };

export class Npcs {
  constructor(scene, world, data = {}) {
    this.w = world; this.dens = 1; this.on = true; this.list = []; this.free = Array.from({ length: NMAX }, (_, i) => NMAX - 1 - i); this.fn = 0;
    this.d = { venues: data.venues || [], benches: data.benches || [], crowds: data.crowds || [], homes: data.homes || [] };
    this.grid = { venue: new Map(), bench: new Map(), crowd: new Map(), home: new Map() };
    const add = (k, a) => { const key = Math.floor(a.x / CELL) + ',' + Math.floor(a.z / CELL); let l = this.grid[k].get(key); if (!l) this.grid[k].set(key, l = []); l.push(a); };
    for (const v of this.d.venues) { v.tables = null; add('venue', v); }
    for (const b of this.d.benches) { const ux = b.fz, uz = -b.fx; b.seats = [{ x: b.x + ux * 0.45, z: b.z + uz * 0.45, fx: b.fx, fz: b.fz, used: 0 }, { x: b.x - ux * 0.45, z: b.z - uz * 0.45, fx: b.fx, fz: b.fz, used: 0 }]; add('bench', b); }
    for (const c of this.d.crowds) { if (c.poly) { let a = 1e9, b = 1e9, e = -1e9, f = -1e9; for (const p of c.poly) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); e = Math.max(e, p[0]); f = Math.max(f, p[1]); } c.bb = [a, b, e, f]; } add('crowd', c); }
    for (const h of this.d.homes) add('home', h);
    // people: one instanced unit box, 8 instances per person; furniture: one more
    const box = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(box, mat, NMAX * PARTS); this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.furn = new THREE.InstancedMesh(box, mat, FMAX); this.furn.frustumCulled = false; this.furn.count = 0; this.nf = 0;
    const z = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(0xffffff);
    for (let i = 0; i < NMAX * PARTS; i++) { this.mesh.setMatrixAt(i, z); this.mesh.setColorAt(i, c); }
    for (let i = 0; i < FMAX; i++) this.furn.setColorAt(i, c);
    scene.add(this.mesh, this.furn);
    this._m = new THREE.Matrix4(); this._b = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler(); this._c = new THREE.Color();
    this._z = z;
  }
  setVisible(v) { this.on = v; this.mesh.visible = this.furn.visible = v; }
  ground(x, z, yRef) { return this.w.surf(x, z, yRef, true); }
  /** free spot: not inside a building (incl. a small margin), not on a carriageway, not in water, flat */
  okSpot(x, z, roadM = 1.2) {
    const w = this.w, b = w.buildings, y = w.hf.height(x, z);
    if (w.waterLevel && w.waterLevel(x, z) > -1e8) return false;
    if (b) for (const [a, c] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (b.hit(x + a, z + c, y + 0.4)) return false;
    if (w.road(x, z, y, roadM)) return false;
    return Math.abs(w.hf.height(x + 1, z) - y) < 0.35 && Math.abs(w.hf.height(x, z + 1) - y) < 0.35;
  }
  box(x, y, z, sx, sy, sz, rot, col) {   // static furniture box (centre x,y,z)
    if (this.nf >= FMAX) return;
    this._e.set(0, rot, 0); this._q.setFromEuler(this._e); this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    this.furn.setMatrixAt(this.nf, this._m); this.furn.setColorAt(this.nf, this._c.setHex(col)); this.nf++;
    this.furn.count = this.nf; this.furn.instanceMatrix.needsUpdate = true; this.furn.instanceColor.needsUpdate = true;
  }
  /** lazily lay out up to 3 tables (2-4 chairs each) around a venue */
  tablesOf(v) {
    if (v.tables) return v.tables;
    v.tables = [];
    for (let t = 0; t < 14 && v.tables.length < 3; t++) {
      const a = rnd(0, 6.283), r = rnd(3, 10), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (!this.okSpot(x, z, 1.6) || v.tables.some(q => Math.hypot(q.x - x, q.z - z) < 2.6)) continue;
      const y = this.w.hf.height(x, z), m = 2 + ((Math.random() * 3) | 0), a0 = rnd(0, 6.283), seats = [];
      for (let k = 0; k < m; k++) { const f = a0 + k * 6.283 / m, sx = x + Math.cos(f) * 0.78, sz = z + Math.sin(f) * 0.78; if (!this.okSpot(sx, sz, 1)) continue; seats.push({ x: sx, z: sz, fx: -Math.cos(f), fz: -Math.sin(f), used: 0 }); }
      if (!seats.length) continue;
      v.tables.push({ x, z, y, seats });
      if (this.nf + 2 + seats.length * 2 > FMAX) continue;
      this.box(x, y + 0.74, z, 0.8, 0.05, 0.8, 0, WOOD); this.box(x, y + 0.37, z, 0.07, 0.74, 0.07, 0, IRON);
      for (const s of seats) { const rot = Math.atan2(s.fx, s.fz); this.box(s.x, y + 0.45, s.z, 0.42, 0.05, 0.42, rot, WOOD); this.box(s.x - s.fx * 0.2, y + 0.7, s.z - s.fz * 0.2, 0.42, 0.45, 0.05, rot, WOOD); }
    }
    return v.tables;
  }
  near(kind, cam, rmin, rmax) {
    const out = [], g = this.grid[kind], c0 = Math.floor(cam.x / CELL), c1 = Math.floor(cam.z / CELL), n = Math.ceil(rmax / CELL);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) { const l = g.get((c0 + a) + ',' + (c1 + b)); if (l) for (const q of l) { const d = Math.hypot(q.x - cam.x, q.z - cam.z); if (d >= rmin && d <= rmax) out.push(q); } }
    return out;
  }
  look() { return { shirt: pick(SHIRT), pants: pick(PANTS), skin: pick(SKIN), hair: pick(HAIR), h: rnd(0.93, 1.06) }; }

  // ---- spawning: each returns an npc or null
  spawnWalk(cam) {
    const W = this.w, cx = Math.floor(cam.x / 512), cz = Math.floor(cam.z / 512), cs = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = W.cells.get((cx + a) + ',' + (cz + b)); if (c?.runs.length) cs.push(c); }
    if (!cs.length) return null;
    for (let t = 0; t < 14; t++) {
      const c = pick(cs), [r, i0, i1] = pick(c.runs), foot = /footway|path|pedestrian|cycleway/.test(r.cls);
      if (r.bridge || i1 - i0 < 1 || (!foot && (r.u || r.w < 3 || /motorway|trunk/.test(r.cls)))) continue;
      const s = rnd(i0, i1), i = Math.min(r.n - 2, s | 0), x = r.P[2 * i], z = r.P[2 * i + 1];
      if (Math.hypot(x - cam.x, z - cam.z) < R_MIN || Math.hypot(x - cam.x, z - cam.z) > R_MAX) continue;
      const n = { k: 'walk', r, s, dir: Math.random() < 0.5 ? 1 : -1, off: foot ? rnd(-0.6, 0.6) : (Math.random() < 0.5 ? 1 : -1) * (r.w / 2 + 1.1), v: rnd(1.1, 1.6), foot, blk: 0 };
      this.walkPos(n); n.y = this.ground(n.x, n.z, this.w.hf.height(n.x, n.z)); n.yaw = Math.atan2(-n.mx, -n.mz);
      if (this.w.buildings?.hit(n.x, n.z, n.y + 0.4) || (this.w.waterLevel && this.w.waterLevel(n.x, n.z) > -1e8)) continue;
      return n;
    }
    return null;
  }
  walkPos(n) {
    const r = n.r, P = r.P, i = Math.max(0, Math.min(r.n - 2, n.s | 0)), ax = P[2 * i], az = P[2 * i + 1], dx = P[2 * i + 2] - ax, dz = P[2 * i + 3] - az, len = Math.hypot(dx, dz) || 1, t = n.s - i;
    n.len = len; n.mx = dx / len * n.dir; n.mz = dz / len * n.dir;
    n.x = ax + dx * t - dz / len * n.off; n.z = az + dz * t + dx / len * n.off;
  }
  spawnSit(cam) {
    const vs = this.near('venue', cam, R_MIN, R_MAX); if (!vs.length) return null;
    const v = pick(vs), tb = this.tablesOf(v).filter(q => q.seats.some(s => !s.used)); if (!tb.length) return null;
    const t = pick(tb), s = pick(t.seats.filter(q => !q.used)); s.used = 1;
    return { k: 'sit', x: s.x, z: s.z, y: t.y, yaw: Math.atan2(-s.fx, -s.fz), seat: s, sy: 0.42 };
  }
  spawnBench(cam) {
    const bs = this.near('bench', cam, R_MIN, R_MAX); if (!bs.length) return null;
    const b = pick(bs), s = b.seats.find(q => !q.used); if (!s) return null; s.used = 1;
    return { k: 'sit', x: s.x, z: s.z, y: this.ground(s.x, s.z, this.w.hf.height(s.x, s.z)), yaw: Math.atan2(-s.fx, -s.fz), seat: s, sy: 0.4, bench: 1 };
  }
  spawnStand(cam) {
    const hs = this.near('home', cam, R_MIN, R_MAX); if (!hs.length) return null;
    const h = pick(hs);
    for (let t = 0; t < 8; t++) { const a = rnd(0, 6.283), r = rnd(2, 7), x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r; if (this.okSpot(x, z, 1.5)) return { k: 'stand', x, z, y: this.w.hf.height(x, z), yaw: rnd(0, 6.283), turn: rnd(2, 8) }; }
    return null;
  }
  crowdPoint(c) {
    for (let t = 0; t < 10; t++) {
      let x, z;
      if (c.poly) { x = rnd(c.bb[0], c.bb[2]); z = rnd(c.bb[1], c.bb[3]); if (!inPoly(x, z, c.poly)) continue; } else { const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * c.r; x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r; }
      if (this.okSpot(x, z, 0.8)) return [x, z];
    }
    return null;
  }
  spawnWander(cam) {
    const cs = this.near('crowd', cam, 0, R_MAX + 60); if (!cs.length) return null;
    let tot = 0; for (const c of cs) tot += c.w; let u = Math.random() * tot, c = cs[0]; for (const q of cs) { u -= q.w; if (u <= 0) { c = q; break; } }
    const p = this.crowdPoint(c); if (!p || Math.hypot(p[0] - cam.x, p[1] - cam.z) < R_MIN || Math.hypot(p[0] - cam.x, p[1] - cam.z) > R_MAX) return null;
    return { k: 'wander', c, x: p[0], z: p[1], y: this.w.hf.height(p[0], p[1]), yaw: rnd(0, 6.283), tgt: null, wait: rnd(0, 6), v: rnd(0.9, 1.4) };
  }
  spawn(cam) {
    const o = [['walk', 5], ['sit', 2.2], ['bench', 1.2], ['stand', 1.2], ['wander', 2.4]]; let tot = 0; for (const q of o) tot += q[1];
    const cap = { walk: 0.5, sit: 0.2, bench: 0.1, stand: 0.15, wander: 0.25 }, cnt = {}; for (const q of this.list) { const kk = q.k === 'sit' ? (q.bench ? 'bench' : 'sit') : q.k; cnt[kk] = (cnt[kk] || 0) + 1; }
    for (let t = 0; t < 4; t++) {
      let u = Math.random() * tot, k = 'walk'; for (const q of o) { u -= q[1]; if (u <= 0) { k = q[0]; break; } }
      if ((cnt[k] || 0) >= cap[k] * NMAX) continue;
      const n = k === 'walk' ? this.spawnWalk(cam) : k === 'sit' ? this.spawnSit(cam) : k === 'bench' ? this.spawnBench(cam) : k === 'stand' ? this.spawnStand(cam) : this.spawnWander(cam);
      if (!n) continue;
      Object.assign(n, this.look(), { ph: rnd(0, 6.283), id: this.fn++, slot: this.free.pop(), pause: 0 });
      this.list.push(n);
      for (let p = 0; p < PARTS; p++) { const kd = p < 4 ? BODY[p][6] : LIMBS[p - 4][6]; this.mesh.setColorAt(n.slot * PARTS + p, this._c.setHex([n.shirt, n.pants, n.skin, n.hair][kd])); }
      this.mesh.instanceColor.needsUpdate = true;
      return n;
    }
    return null;
  }
  kill(i) {
    const n = this.list[i]; if (n.seat) n.seat.used = 0;
    for (let p = 0; p < PARTS; p++) this.mesh.setMatrixAt(n.slot * PARTS + p, this._z);
    this.free.push(n.slot); this.list[i] = this.list[this.list.length - 1]; this.list.pop();
  }

  update(dt, cam, player, cars) {
    if (!this.on) return;
    dt = Math.min(dt, 0.1); const want = Math.round(NMAX * Math.min(1.5, this.dens)), b = this.w.buildings, L = this.list;
    for (let i = L.length - 1; i >= 0; i--) if (Math.hypot(L[i].x - cam.x, L[i].z - cam.z) > FAR || i >= want && L.length > want) this.kill(i);
    if (L.length < Math.min(NMAX, want) && this.free.length) this.spawn(cam);
    for (let i = L.length - 1; i >= 0; i--) {
      const n = L[i]; n.ph += dt * (n.k === 'walk' || (n.k === 'wander' && n.moving) ? n.v * 4.2 : 0.8);
      let moving = false;
      if (n.k === 'walk' || n.k === 'wander') {
        let stop = false;
        if (player && Math.hypot(player.x - n.x, player.z - n.z) < 1.8) stop = true;
        if (!stop && cars) for (const c of cars) if (c.x !== undefined && Math.abs(c.x - n.x) < 5 && Math.abs(c.z - n.z) < 5 && (n.k === 'wander' || !n.foot)) { stop = true; break; }
        if (stop) n.pause = 0.4; else if (n.pause > 0) n.pause -= dt;
        if (n.pause <= 0) {
          let nx, nz;
          if (n.k === 'walk') {
            const s0 = n.s, s1 = n.s + n.dir * n.v * dt / n.len; n.s = s1;
            if (n.s <= 0 || n.s >= n.r.n - 1) { n.s = Math.max(0, Math.min(n.r.n - 1, n.s)); n.dir = -n.dir; n.off = -n.off; }
            this.walkPos(n); nx = n.x; nz = n.z;
            if (b && b.hit(nx, nz, n.y + 0.4)) { n.s = s0; n.dir = -n.dir; n.off = -n.off; n.blk++; this.walkPos(n); if (n.blk > 3) { this.kill(i); continue; } }
          } else {
            if (n.wait > 0) n.wait -= dt;
            else if (!n.tgt) { const p = this.crowdPoint(n.c); if (p) n.tgt = p; else n.wait = 2; }
            if (n.tgt) {
              const dx = n.tgt[0] - n.x, dz = n.tgt[1] - n.z, d = Math.hypot(dx, dz);
              if (d < 0.6) { n.tgt = null; n.wait = rnd(2, 12); }
              else {
                nx = n.x + dx / d * n.v * dt; nz = n.z + dz / d * n.v * dt;
                if (b && b.hit(nx, nz, n.y + 0.4) || this.w.road(nx, nz, n.y, 0.4)) { n.tgt = null; n.wait = 1; } else { n.mx = dx / d; n.mz = dz / d; n.x = nx; n.z = nz; moving = true; }
              }
            }
          }
          if (n.k === 'walk') moving = true;
          if (moving) { const ty = Math.atan2(-n.mx, -n.mz); let da = ty - n.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); n.yaw += da * Math.min(1, dt * 6); }
        }
      } else if (n.k === 'stand') { n.turn -= dt; if (n.turn < 0) { n.turn = rnd(3, 10); n.yaw += rnd(-1, 1); } }
      n.moving = moving;
      if ((n.k === 'walk' || n.k === 'wander') && ((this.fn + n.id) & 3) === 0) n.y += (this.ground(n.x, n.z, n.y) - n.y) * Math.min(1, dt * 12);
    }
    this.draw();
  }

  draw() {
    const m = this._m, base = this._b, pos = this._p, q = this._q, sc = this._s, e = this._e;
    for (const n of this.list) {
      const sit = n.k === 'sit', drop = sit ? -n.sy : 0, sw = n.k === 'walk' || n.moving ? Math.sin(n.ph) * 0.6 : 0, idle = n.k === 'stand' || n.k === 'wander' ? Math.sin(n.ph * 0.6) * 0.05 : 0, bob = sw ? Math.abs(Math.cos(n.ph)) * 0.04 : 0;
      e.set(0, n.yaw, 0); q.setFromEuler(e); base.compose(pos.set(n.x, n.y + bob, n.z), q, sc.set(n.h, n.h, n.h));
      for (let p = 0; p < 4; p++) { const B = BODY[p]; m.compose(pos.set(B[3], B[4] + drop, B[5]), q.identity(), sc.set(B[0], B[1], B[2])); m.premultiply(base); this.mesh.setMatrixAt(n.slot * PARTS + p, m); }
      for (let p = 0; p < 4; p++) {
        const B = LIMBS[p], leg = p < 2, side = p & 1 ? -1 : 1;
        const a = sit ? (leg ? 1.4 : 0.6) : leg ? sw * side : -sw * side * 0.9 + idle * side;
        const cy = Math.cos(a), sy = Math.sin(a);
        e.set(a, 0, 0); q.setFromEuler(e);
        m.compose(pos.set(B[3], B[4] + drop - B[1] / 2 * cy, B[5] - B[1] / 2 * sy), q, sc.set(B[0], B[1], B[2])); m.premultiply(base);
        this.mesh.setMatrixAt(n.slot * PARTS + 4 + p, m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
