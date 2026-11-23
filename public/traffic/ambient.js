// Ambient vehicles: parked cars on real kerbside bays / car-park rows (data/parking/<map>.json from scripts/parking_data.mjs) and a light
// traffic that follows the street lanes at a constant speed per street and brakes for whatever is ahead (other traffic, the player, the
// player's vehicle). No AI beyond that: at the end of a way it takes a random connected way, turns round in a dead end, despawns far away.
// Draw cost: 2 draw calls for everything (one InstancedMesh per LOD over a "fleet" geometry holding every ambient model; the instance
// attribute aSel picks the model in the shared lowpoly.js shader, the instance colour paints it). CPU: parked placement is cached per 128 m
// cell and re-selected every few metres; traffic is O(n^2) over ~16 cars.
import * as THREE from 'three';
import { buildVehicle } from '../vehicles/carmesh.js';
import { Builder } from '../lowpoly.js';
import { CAR } from '../sim/ground.js';
import { hash, inBox, pickWeighted } from './park_math.js';
import { collide, contact, inertia } from '../sim/physics.js';

const LOD0 = 50, CAP0 = 160, CAP1 = 900, RESEL = 8;   // m: full-detail radius; instance capacities; re-select parked cars after moving this far

/** one geometry with every model (aModel = index) + a flat dark footprint under each (shadow); lod 0 / 1; build(spec, lod) -> geometry */
export function fleetGeometry(specs, lod, build = buildVehicle, shadow = true) {
  const parts = specs.map((s, m) => {
    const g = build(s, lod), B = new Builder(), hw = s.dims.width / 2 + 0.1, hl = s.dims.length / 2 + 0.1;
    B.style('#2a2b2c'); B.quad({ x: -hw, y: 0.03, z: -hl }, { x: hw, y: 0.03, z: -hl }, { x: hw, y: 0.03, z: hl }, { x: -hw, y: 0.03, z: hl }, { x: 0, y: -1, z: 0 });   // footprint shadow
    const sh = shadow && B.geometry(), n = g.attributes.position.count + (sh ? sh.attributes.position.count : 0);
    return { g, sh, n, m };
  });
  const N = parts.reduce((a, p) => a + p.n, 0), pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), col = new Float32Array(N * 3), paint = new Float32Array(N), model = new Float32Array(N);
  let o = 0;
  for (const { g, sh, n, m } of parts) {
    for (const x of shadow ? [sh, g] : [g]) { const c = x.attributes.position.count; pos.set(x.attributes.position.array, o * 3); nrm.set(x.attributes.normal.array, o * 3); col.set(x.attributes.color.array, o * 3); paint.set(x.attributes.aPaint.array, o); o += c; }
    model.fill(m, o - n, o);
  }
  const G = new THREE.BufferGeometry();
  G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); G.setAttribute('color', new THREE.BufferAttribute(col, 3));
  G.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1)); G.setAttribute('aModel', new THREE.BufferAttribute(model, 1));
  G.computeBoundingSphere(); return G;
}

export class Ambient {
  /** specs: full catalogue; data: parking json (or null: nothing); ground: sim/ground.js Ground; Q: quality preset */
  constructor({ scene, mat, specs, data, ground, Q }) {
    this.ground = ground; this.data = data;
    // the fleet geometry holds every road model (the player's car, whatever it is, can be parked here: park()); only some spawn
    this.fleet = specs.filter(s => s.kind !== 'heli').map((s, m) => ({ s, m, w: s.spawnWeight, hl: s.dims.length / 2, hw: s.dims.width / 2 }));
    this.models = this.fleet.filter(x => x.w > 0 && (x.s.kind === 'car' || x.s.kind === 'bike') && x.s.archetype !== 'patrulla');
    this.taken = new Set(); this.extra = [];   // parked slots the player drove away; cars the player left (park())
    this.parkModels = this.models.filter(x => x.s.dims.length < 5);   // buses and lorries do not park in the street bays
    this.luxModels = this.parkModels.filter(x => /deportivo|cabrio|todoterreno/.test(x.s.archetype));   // well-off zones (data.lux)
    const mk = (lod, cap) => {
      const g = fleetGeometry(this.fleet.map(x => x.s), lod), sel = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      g.setAttribute('aSel', sel); const lit = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); g.setAttribute('aLights', lit); const im = new THREE.InstancedMesh(g, mat, cap); im.setColorAt(0, new THREE.Color()); im.count = 0; im.frustumCulled = false;   // instances move: no stale bounds
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return { im, sel, lit, n: 0 };
    };
    this.L = [mk(0, CAP0), mk(1, CAP1)];
    this.parkR = Math.min(450, Q.treeDist * 0.75); this.nTraffic = data ? Math.round(Q.drawDist / 45) : 0;
    this.cache = new Map();   // cell key -> { m: Float32Array(16 * n), x, z, hl, hw, model, color } once its ground is resident
    this.at = null; this.parked = []; this.near = []; this.keep = []; this.t = 0; this.pending = false;
    this.closed = [];   // [x, z, r] circles closed to traffic (events/events.js): no car spawns or stays inside
    this.cars = []; this.stats = { parked: 0, traffic: 0, lod0: 0, lod1: 0, ms: 0 };
    if (data) this.indexLanes();
  }
  // ---- parked. Every slot info carries what it takes to drive that car away: spec (catalogue id), color (hex), x, z, y, h (heading)
  /** model of the parked car at (x, z) (id = its hash): in a data.lux zone [x, z, r, share] a share of them are sports / luxury models */
  pickPark(x, z, id) {
    for (const [lx, lz, r, sh] of this.data?.lux || []) if (Math.hypot(x - lx, z - lz) < r) { if (this.luxModels.length && hash(Math.floor(id * 1e9) + 7) < sh) return pickWeighted(this.luxModels, id); break; }
    return pickWeighted(this.parkModels, id);
  }
  slotInfo(x, z, h, y, id) {
    const md = this.pickPark(x, z, id), col = md.s.palette[Math.floor(hash(id * 1e9 + 3) * md.s.palette.length)];
    return { x, z, h, y, hl: md.hl, hw: md.hw, m: md.m, spec: md.s.id, color: col, c: new THREE.Color(col) };
  }
  cellSlots(key) {
    let c = this.cache.get(key); if (c) return c;
    const raw = this.data.slots[key]; if (!raw) { this.cache.set(key, c = { n: 0 }); return c; }
    const n = raw.length / 3, M = new Float32Array(n * 16), info = [], obj = new THREE.Object3D(), G = this.ground;
    for (let k = 0; k < n; k++) {
      const x = raw[k * 3], z = raw[k * 3 + 1], h = raw[k * 3 + 2], T = G.terrain(x, z);
      if (!T) return null;   // ground not resident yet: try again later (nothing cached)
      const r = G.at(x, z, T.y + 0.3, CAR); if (r.blocked || Math.abs(r.y - T.y) > 0.4) { info.push(null); continue; }   // ramp cut, pillar, raised level: no car
      const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), y = (q, s) => G.terrain(x + fx * q + rx * s, z + fz * q + rz * s)?.y ?? T.y;
      const sp = (y(1.6, 0) - y(-1.6, 0)) / 3.2, sr = (y(0, 0.75) - y(0, -0.75)) / 1.5;
      if (Math.abs(sp) > 0.14 || Math.abs(sr) > 0.14) { info.push(null); continue; }   // embankment, excavated DEM, steps: nobody parks there
      obj.position.set(x, T.y, z); obj.rotation.set(-Math.atan(sp), h + Math.PI, -Math.atan(sr), 'YXZ');   // follow the slope
      obj.updateMatrix(); obj.matrix.toArray(M, k * 16);
      info.push({ ...this.slotInfo(x, z, h, T.y, hash(Math.round(x * 7) * 31 + Math.round(z * 7))), k });
    }
    c = { n, M, info }; this.cache.set(key, c); return c;
  }
  /** re-select the parked cars around (x, z): cells in range, LOD by distance; skip = [[x, z, r]] (the parked helicopter) */
  selectParked(x, z, skip) {
    const S = this.data.cell, R = this.parkR, out = []; this.pending = false;
    for (let i = Math.floor((x - R) / S); i <= Math.floor((x + R) / S); i++) for (let j = Math.floor((z - R) / S); j <= Math.floor((z + R) / S); j++) {
      const key = i + ',' + j; if (!this.data.slots[key]) continue;
      const c = this.cellSlots(key); if (!c) { this.pending = true; continue; }
      for (const s of c.info || []) { if (!s || this.taken.has(s)) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < R && !skip.some(([a, b, r]) => Math.hypot(s.x - a, s.z - b) < r) && !this.extra.some(e => e.clear && Math.hypot(s.x - e.x, s.z - e.z) < e.clear)) out.push([d, s, c.M]); }
    }
    for (const s of this.underSlots()) { const d = Math.hypot(s.x - x, s.z - z); if (d < 70 && !this.taken.has(s)) out.push([d, s, this.under.M]); }   // underground car parks: only from close by (no culling below ground)
    for (const s of this.extra) { const d = Math.hypot(s.x - x, s.z - z); if (d < R) out.push([d, s, s.M]); }
    this.parked = out; this.near = out.filter(o => o[0] < 60).map(o => o[1]); this.at = { x, z };
  }
  /** parked cars in the underground car parks: levels.json places[].slots [x, z, heading, y] (scripts/bake/plugins/underground.mjs), flat on their floor */
  underSlots() {
    if (this.under) return this.under.info;
    const raw = (this.ground.L.places || []).flatMap(p => p.slots || []), n = raw.length / 4, M = new Float32Array(n * 16), info = [], obj = new THREE.Object3D();
    for (let k = 0; k < n; k++) {
      const [x, z, h, y] = raw.slice(k * 4, k * 4 + 4);
      obj.position.set(x, y, z); obj.rotation.set(0, h + Math.PI, 0); obj.updateMatrix(); obj.matrix.toArray(M, k * 16);
      info.push({ ...this.slotInfo(x, z, h, y, hash(Math.round(x * 7) * 31 + Math.round(z * 7) + Math.round(y))), k });
    }
    this.under = { M, info }; return info;
  }
  // ---- traffic
  indexLanes() {
    const G = 64, grid = this.grid = new Map();
    this.data.lanes.forEach((l, li) => { for (let q = 0; q < l.p.length; q += 2) { const k = Math.floor(l.p[q] / G) * 100003 + Math.floor(l.p[q + 1] / G); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(li, q / 2); } });
  }
  spawn(px, pz, rMin, rMax, seed) {
    const G = 64, cand = [];
    for (let i = Math.floor((px - rMax) / G); i <= Math.floor((px + rMax) / G); i++) for (let j = Math.floor((pz - rMax) / G); j <= Math.floor((pz + rMax) / G); j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (let k = 0; k < a.length; k += 2) { const l = this.data.lanes[a[k]], x = l.p[a[k + 1] * 2], z = l.p[a[k + 1] * 2 + 1], d = Math.hypot(x - px, z - pz); if (d >= rMin && d <= rMax) cand.push(a[k], a[k + 1]); }
    }
    for (let tries = 0; tries < 6 && cand.length; tries++) {
      const u = Math.floor(hash(seed * 7 + tries) * cand.length / 2) * 2, li = cand[u], q = cand[u + 1], l = this.data.lanes[li], nv = l.p.length / 2;
      let dir = l.ow || hash(seed * 13 + tries) < 0.5 ? 1 : -1; if (q === nv - 1 && dir > 0) { if (l.ow) continue; dir = -1; } if (q === 0 && dir < 0) dir = 1;
      const x = l.p[q * 2], z = l.p[q * 2 + 1]; if (this.closed.some(k => Math.hypot(k[0] - x, k[1] - z) < k[2]) || this.cars.some(c => Math.hypot(c.x - x, c.z - z) < 25)) continue;
      const md = pickWeighted(this.models, hash(seed * 3 + 1)), T = this.ground.terrain(x, z); if (!T) continue;
      const c = { li, q, s: 0, dir, v: 0, sp: l.sp * (0.85 + 0.25 * hash(seed * 5)), md, col: new THREE.Color(md.s.palette[Math.floor(hash(seed * 11) * md.s.palette.length)]), x, z, y: T.y, h: 0, rh: 0, stop: 0, ghost: 0, ox: 0, oz: 0, oh: 0, ko: null };
      this.place(c); c.rh = c.h; c.v = c.sp * 0.6; return c;
    }
    return null;
  }
  /** position from lane / vertex / distance into the segment, offset to the right lane */
  place(c) {
    const l = this.data.lanes[c.li], a = c.q * 2, b = (c.q + c.dir) * 2, ax = l.p[a], az = l.p[a + 1], dx = l.p[b] - ax, dz = l.p[b + 1] - az, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L, off = l.o[c.dir > 0 ? 0 : 1];
    c.x = ax + ux * c.s - uz * off; c.z = az + uz * c.s + ux * off; c.h = Math.atan2(-ux, -uz); c.segL = L;
  }
  /** at the end of a way: a random connected way (respecting one-ways), else turn round (two-way) or vanish */
  next(c, seed) {
    const l = this.data.lanes[c.li], end = c.dir > 0 ? l.e[1] : l.e[0], opts = [];
    for (const [l2, q2] of end) { const m = this.data.lanes[l2], nv = m.p.length / 2; if (q2 < nv - 1) opts.push([l2, q2, 1]); if (q2 > 0 && !m.ow) opts.push([l2, q2, -1]); }
    if (opts.length) { const [l2, q2, d] = opts[Math.floor(hash(seed) * opts.length)]; c.li = l2; c.q = q2; c.dir = d; c.s = 0; return true; }
    if (!l.ow) { c.dir = -c.dir; c.s = 0; return true; }   // dead end: U-turn on the other lane
    return false;
  }
  /** per frame. focus = the player's position; obstacles = [{ x, z, r }] the player and their vehicle; skip = areas without parked cars */
  update(dt, focus, obstacles, skip = []) {
    const t0 = performance.now(); if (!this.data) return;
    dt = Math.min(dt, 0.1); this.t += dt;
    if (!this.at || Math.hypot(focus.x - this.at.x, focus.z - this.at.z) > RESEL || this.pending && this.t > 0.5) { this.t = 0; this.selectParked(focus.x, focus.z, skip); }
    // traffic: keep n cars, despawn far ones
    const shut = (x, z) => this.closed.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2]);
    for (let i = this.cars.length - 1; i >= 0; i--) if (Math.hypot(this.cars[i].x - focus.x, this.cars[i].z - focus.z) > this.parkR + 80 || shut(this.cars[i].x, this.cars[i].z)) this.cars.splice(i, 1);
    const seed = Math.floor(performance.now());
    if (this.cars.length < this.nTraffic) { const c = this.spawn(focus.x, focus.z, this.cars.length ? 110 : 25, this.parkR, seed + this.cars.length * 977); if (c) this.cars.push(c); }
    for (const c of this.cars) this.drive(c, dt, obstacles, seed);
    this.write(focus);
    const ms = performance.now() - t0, s = this.stats; s.ms = s.ms * 0.95 + ms * 0.05; s.max = Math.max(s.max || 0, ms);   // EMA + worst, read by the benches
  }
  drive(c, dt, obstacles, seed) {
    if (c.ko) return this.reel(c, dt);
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h), look = 8 + c.v * 1.6; let gap = Infinity, byCar = false;
    const test = (x, z, r, car) => { const dx = x - c.x, dz = z - c.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); if (along > 0 && along < look && side < c.md.hw + r + 0.4) { const g = along - c.md.hl - r; if (g < gap) { gap = g; byCar = car; } } };
    for (const o of obstacles) test(o.x, o.z, o.r, false);
    if (c.ghost <= 0) for (const o of this.cars) if (o !== c) test(o.x, o.z, o.md.hw, true);
    const want = gap < 1.5 ? 0 : Math.min(c.sp, c.sp * (gap - 1.5) / 8);
    c.brake = want < c.v - 0.05 || c.v < 0.3 ? 1 : 0;   // brake lights
    c.v = want < c.v ? Math.max(want, c.v - 8 * dt) : Math.min(want, c.v + 2.5 * dt);
    c.stop = c.v < 0.3 && byCar ? c.stop + dt : 0; c.ghost -= dt; if (c.stop > 5) { c.ghost = 3; c.stop = 0; }   // two cars blocking each other at a junction: one lets go
    c.s += c.v * dt;
    for (let n = 0; c.s > c.segL && n < 4; n++) {
      c.s -= c.segL; c.q += c.dir; const l = this.data.lanes[c.li], nv = l.p.length / 2;
      if (c.q <= 0 && c.dir < 0 || c.q >= nv - 1 && c.dir > 0) { if (!this.next(c, seed + c.q)) { c.v = 0; c.s = 0; c.dead = true; break; } }
      this.place(c);
    }
    if (c.dead) return;
    this.place(c);
    if (c.ox || c.oz || c.oh) { const f = Math.max(0, 1 - dt * 0.7); c.ox *= f; c.oz *= f; c.oh *= f; if (Math.abs(c.ox) + Math.abs(c.oz) < 0.02) c.ox = c.oz = c.oh = 0; c.x += c.ox; c.z += c.oz; }   // knocked off its lane: eases back while driving on
    const r = this.ground.at(c.x, c.z, c.y + 0.5, CAR); if (!r.blocked && !r.id?.includes(':rampa')) c.y = r.y;   // a car-park ramp cut into the carriageway: traffic keeps to the street
    c.rh += Math.atan2(Math.sin(c.h - c.rh), Math.cos(c.h - c.rh)) * Math.min(1, dt * 8);   // rendered heading eases round the polyline corners
  }
  /** knocked by the player's car (bump): slides and spins to a stop off its lane, waits, then drives on (offsets ease back in drive()).
   *  shortcut: the slide ignores walls and kerbs (it only follows the ground height), fine for the few metres a knock gives */
  reel(c, dt) {
    const k = c.ko, sp = Math.hypot(k.vx, k.vz), f = sp ? Math.max(0, sp - 7 * dt) / sp : 0;
    k.vx *= f; k.vz *= f; k.w *= Math.max(0, 1 - 2.5 * dt); c.ox += k.vx * dt; c.oz += k.vz * dt; c.oh += k.w * dt; c.v = 0; c.brake = 1;
    if (sp < 0.2 && Math.abs(k.w) < 0.1 && (k.t += dt) > 2.5) c.ko = null;
    this.place(c); c.x += c.ox; c.z += c.oz; c.rh = c.h;
    const r = this.ground.at(c.x, c.z, c.y + 0.5, CAR); if (!r.blocked) c.y = r.y;
  }
  /** the player's car s (sim/car.js) against the traffic: push apart, then a mass impulse on both (sim/physics.js); -> number of cars hit */
  bump(s) {
    const p = s.p, A = { x: s.x, z: s.z, h: s.h, hl: p.halfL ?? 2.2, hw: p.halfW ?? 0.85 }; let n = 0;
    for (const c of this.cars) {
      if (Math.abs(c.x - s.x) > 12 || Math.abs(c.z - s.z) > 12 || Math.abs(c.y - s.y) > 2) continue;
      const B = { x: c.x, z: c.z, h: c.h + c.oh, hl: c.md.hl, hw: c.md.hw }, k = contact(A, B); if (!k) continue;
      const ma = p.mass ?? 1300, mb = c.md.s.handling?.mass ?? 1300, fa = mb / (ma + mb);
      s.x -= k.nx * k.d * fa; s.z -= k.nz * k.d * fa; c.ox += k.nx * k.d * (1 - fa); c.oz += k.nz * k.d * (1 - fa); c.x += k.nx * k.d * (1 - fa); c.z += k.nz * k.d * (1 - fa);
      A.x = s.x; A.z = s.z;
      const fx = -Math.sin(s.h), fz = -Math.cos(s.h), a = { m: ma, I: inertia(ma, A.hl, A.hw), x: s.x, z: s.z, vx: fx * s.v + s.sx, vz: fz * s.v + s.sz, w: s.spin };
      const b = c.ko ? { vx: c.ko.vx, vz: c.ko.vz, w: c.ko.w } : { vx: -Math.sin(c.h) * c.v, vz: -Math.cos(c.h) * c.v, w: 0 }; Object.assign(b, { m: mb, I: inertia(mb, B.hl, B.hw), x: c.x, z: c.z });
      const J = collide(a, b, k.px, k.pz, k.nx, k.nz, 0.3); if (!J) continue;
      s.v = a.vx * fx + a.vz * fz; s.sx = a.vx - fx * s.v; s.sz = a.vz - fz * s.v; s.spin = a.w;
      s.hit?.({ kind: 'car', dv: J / ma, px: k.px, pz: k.pz, nx: -k.nx, nz: -k.nz });
      if (this.onBump?.({ spec: c.md.s.id, color: '#' + c.col.getHexString(), x: c.x, y: c.y, z: c.z, h: c.h + c.oh, vx: b.vx, vz: b.vz, w: b.w }, J, k, mb)) { c.dead = true; n++; continue; }   // play.js: it becomes a damageable wreck
      c.ko = { vx: b.vx, vz: b.vz, w: b.w, t: 0 }; c.v = 0; n++;
    }
    return n;
  }
  write(focus) {
    this.cars = this.cars.filter(c => !c.dead);
    const [A, B] = this.L, M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    A.n = B.n = 0;
    for (const [d, s, Msrc] of this.parked) {
      const L = d < LOD0 ? A : B, i = L.n; if (i >= (L === A ? CAP0 : CAP1)) continue;
      L.im.instanceMatrix.array.set(Msrc.subarray(s.k * 16, s.k * 16 + 16), i * 16); L.sel.array[i] = s.m + 1; L.lit.array[i * 2] = -1; L.lit.array[i * 2 + 1] = 0; L.im.setColorAt(i, s.c); L.n++;
    }
    for (const c of this.cars) {
      const d = Math.hypot(c.x - focus.x, c.z - focus.z), L = d < LOD0 ? A : B, i = L.n; if (i >= (L === A ? CAP0 : CAP1)) continue;
      M.compose(p.set(c.x, c.y, c.z), q.setFromEuler(e.set(0, c.rh + c.oh + Math.PI, 0)), one); M.toArray(L.im.instanceMatrix.array, i * 16);
      L.sel.array[i] = c.md.m + 1; L.im.setColorAt(i, c.col); L.n++;
      const turn = Math.atan2(Math.sin(c.h - c.rh), Math.cos(c.h - c.rh));   // heading still easing round a corner: indicator (+ = left)
      L.lit.array[i * 2] = c.brake; L.lit.array[i * 2 + 1] = turn > 0.12 ? 1 : turn < -0.12 ? 2 : 0;
    }
    for (const L of this.L) { L.im.count = L.n; L.im.instanceMatrix.needsUpdate = true; L.im.instanceColor.needsUpdate = true; L.sel.needsUpdate = true; L.lit.needsUpdate = true; }
    const s = this.stats; s.parked = this.parked.length; s.traffic = this.cars.length; s.lod0 = A.n; s.lod1 = B.n;  }
  /** is (x, z) (a mover of radius r, feet at y if given) inside a parked or moving car? For the player's car / walker collisions */
  hit(x, z, r, y, traffic = true) {   // traffic false: parked cars only (the player's car meets the traffic with bump())
    for (const s of this.near) if ((y == null || Math.abs(s.y - y) < 2) && inBox(x, z, s.x, s.z, s.h, s.hl, s.hw, r)) return true;
    if (traffic) for (const c of this.cars) if (inBox(x, z, c.x, c.z, c.h + c.oh, c.md.hl, c.md.hw, r)) return true;
    return false;
  }
  // ---- the player takes a car: nearest() finds one within r of (x, z) (body edge), take() removes it and returns what the player's car becomes
  nearest(x, z, r) {
    let best = null, bd = r;
    for (const s of this.near) { if (this.taken.has(s)) continue; const d = Math.hypot(s.x - x, s.z - z) - s.hw; if (d < bd) { bd = d; best = s; } }
    for (const c of this.cars) { const d = Math.hypot(c.x - x, c.z - z) - c.md.hw; if (d < bd) { bd = d; best = c; } }
    return best && { o: best, d: bd };
  }
  /** -> { spec (id), color (hex), x, y, z, h, v, traffic } */
  take(o) {
    if (o.md) { this.cars = this.cars.filter(c => c !== o); return { spec: o.md.s.id, color: '#' + o.col.getHexString(), x: o.x, y: o.y, z: o.z, h: o.h, v: o.v, traffic: true }; }
    if (this.extra.includes(o)) this.extra = this.extra.filter(s => s !== o); else this.taken.add(o);
    this.near = this.near.filter(s => s !== o); this.at = null; return { spec: o.spec, color: o.color, x: o.x, y: o.y, z: o.z, h: o.h, v: 0, traffic: false };
  }
  /** a taken parked car goes back to its slot (its wreck was dropped) */
  release(o) { if (o.M) this.extra.push(o); else this.taken.delete(o); this.at = null; }
  /** leave the player's car parked here (kept until 30 more are left) */
  park(spec, color, x, y, z, h) {
    const md = this.fleet.find(f => f.s.id === spec); if (!md) return;
    let clear = 0, p;
    if (md.s.kind === 'dozer' && (p = this.yardSpot?.(x, z, md.hw, md.hl, h)) !== undefined) { if (!p) return; [x, z, y] = p; clear = 7; }   // a yard dozer (boot.js: undefined = not a yard): a free spot, and the parked cars within 7 m of it are not placed
    const M = new Float32Array(16); new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h + Math.PI, 0)), new THREE.Vector3(1, 1, 1)).toArray(M);
    this.extra.push({ x, z, h, y, hl: md.hl, hw: md.hw, m: md.m, spec, color, c: new THREE.Color(color), k: 0, M, clear }); if (this.extra.length > 30) this.extra.shift();
    this.at = null;
  }
}
