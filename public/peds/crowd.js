// Ambient pedestrians: a handful of people (Q.peds, by quality preset) walking the pavements, footways, pedestrian streets and paths of
// data/peds/<map>.json (scripts/peds_data.mjs) near the player. They spawn on a ring around the focus, despawn far away, follow their way
// at a stroll, take a random nearby way at its end (or turn round), stop now and then, and stop for the player. Every step is checked with
// the walker's own ground (sim/ground.js FOOT + building walls, sim/walls.js): blocked, a drop, water -> they turn round. They step aside
// for each other and for the player's car coming at them (startled), stumble when nudged at a crawl, and get up after being run over.
// Draw cost: 2 draw calls. Near (< LOD0): the skinned rig (peds/rig.js) instanced, one bone-texture row per person, posed on the CPU
// (gait with planted feet, startle, stumble, flying, lying, getting up). Far: the lowpoly mesh, aAnim drives its walk cycle in the shader.
// Both are one InstancedMesh over a merged geometry of K outfits (aSel picks the outfit, the instance colour repaints the top garment).
import * as THREE from 'three';
import { resolvePed, buildPed, makeLowpolyMaterial } from './pedmesh.js';
import { Rig, Animator, SLOTS, NB, boneTexture, makeSkinMaterial } from './rig.js';
import { Builder, rng, pick } from '../lowpoly.js';
import { inBox } from '../traffic/park_math.js';

const K = 8, LOD0 = 30, NEAR = 24, G = 32, JOIN = 4;   // outfits; skinned-rig radius (m) and how many at most (each one costs the vertices of all K outfits); spatial grid (m); max gap joining two ways (m)
const ATTRS = ['position', 'normal', 'color', 'aPaint', 'aBone', 'aPivot'], SKIN = ['position', 'normal', 'color', 'aPaint', 'skinIndex', 'skinWeight'];

/** one geometry with K outfits (aModel = index) + a flat dark footprint under each; rigs: skinned (the footprint on the identity slot) */
function crowdGeometry(recipes, lod, rigs) {
  const parts = recipes.map((r, m) => {
    const B = new Builder(); B.rig(0, [0, 0, 0]).style('#2a2b2c');
    B.quad({ x: -0.3, y: 0.03, z: -0.3 }, { x: 0.3, y: 0.03, z: -0.3 }, { x: 0.3, y: 0.03, z: 0.3 }, { x: -0.3, y: 0.03, z: 0.3 }, { x: 0, y: -1, z: 0 });
    const f = B.geometry({ rigged: true });
    if (rigs) { const c = f.attributes.position.count, I = new Float32Array(c * 4), W = new Float32Array(c * 4); for (let i = 0; i < c; i++) { I[i * 4] = NB; W[i * 4] = 1; } f.setAttribute('skinIndex', new THREE.BufferAttribute(I, 4)); f.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4)); }
    return [f, rigs ? rigs[m].geometry(r) : buildPed(r, lod)];
  });
  const n = parts.flat().reduce((a, g) => a + g.attributes.position.count, 0), out = new THREE.BufferGeometry(), model = new Float32Array(n);
  for (const name of rigs ? SKIN : ATTRS) {
    const w = parts[0][1].attributes[name].itemSize, arr = new Float32Array(n * w); let o = 0;
    parts.forEach((gs, m) => { for (const g of gs) { const a = g.attributes[name]; arr.set(a.array, o * w); if (name === 'position') model.fill(m, o, o + a.count); o += a.count; } });
    out.setAttribute(name, new THREE.BufferAttribute(arr, w));
  }
  const index = []; let o = 0;
  for (const g of parts.flat()) { const c = g.attributes.position.count, I = g.index?.array; for (let i = 0; i < (I ? I.length : c); i++) index.push(o + (I ? I[i] : i)); o += c; }
  out.setIndex(index); out.setAttribute('aModel', new THREE.BufferAttribute(model, 1)); out.computeBoundingSphere(); return out;
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Crowd {
  /** db: data/peds.json; data: data/peds/<map>.json or null (no pedestrians); walk(x, z, y) -> sim ground result (FOOT + walls); Q: preset */
  constructor({ scene, db, data, walk, Q, seed = 1, spacing = 8 }) {
    this.space = spacing;   // min distance between a new ped and the others (events: dense crowds)
    this.walk = walk; this.cap = Math.max(1, Q.peds ?? 24); this.max = 0; this.R = Math.min(Q.treeDist > 400 ? 180 : 90, Q.treeDist * 0.4); this.peds = []; this.r = rng(seed);
    this.stats = { peds: 0, lod0: 0, ms: 0 };
    const styles = db.styles.flatMap(s => Array(Math.max(1, Math.round(s.weight * 4))).fill(s.id));
    this.recipes = Array.from({ length: K }, (_, m) => resolvePed(db, pick(this.r, styles), 101 + m * 37));
    this.tops = this.recipes.map(p => { const s = db.styles.find(x => x.id === p.style).top.palette; return Array.isArray(s) ? s : db.palettes[s]; });
    this.mat = makeLowpolyMaterial({ anim: true });
    const cap = this.cap;
    this.rigs = this.recipes.map(r => new Rig(r)); this.tex = boneTexture(cap); this.smat = makeSkinMaterial(this.tex);
    this.L = [0, 1].map(lod => {
      const g = crowdGeometry(this.recipes, lod, lod ? null : this.rigs), sel = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1), anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      g.setAttribute('aSel', sel); g.setAttribute('aAnim', anim);
      const im = new THREE.InstancedMesh(g, lod ? this.mat : this.smat, cap); im.setColorAt(0, new THREE.Color()); im.count = 0; im.frustumCulled = false;   // instances move: no stale bounds
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return { im, sel, anim };
    });
    this.setData(data);
  }
  /** the walk network (null: no pedestrians) */
  setData(data) {
    this.data = data; this.max = data ? this.cap : 0; if (!data) return;
    const grid = this.grid = new Map();
    this.data.ways.forEach((w, wi) => { for (let q = 0; q < w.length; q += 2) { const k = Math.floor(w[q] / G) * 100003 + Math.floor(w[q + 1] / G); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(wi, q / 2); } });
  }
  /** way vertices (wi, q) within [r0, r1] of (x, z) */
  around(x, z, r0, r1, fn) {
    for (let i = Math.floor((x - r1) / G); i <= Math.floor((x + r1) / G); i++) for (let j = Math.floor((z - r1) / G); j <= Math.floor((z + r1) / G); j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (let k = 0; k < a.length; k += 2) { const w = this.data.ways[a[k]], q = a[k + 1], d = Math.hypot(w[q * 2] - x, w[q * 2 + 1] - z); if (d >= r0 && d <= r1) fn(a[k], q, d); }
    }
  }
  /** feet on valid open ground at (x, z) coming from height y (null: blocked, a drop of more than a step, water, ground not resident) */
  foot(x, z, y) {
    const g = this.walk(x, z, y + 0.4);
    return !g || g.blocked || g.layer === 'none' || y - g.y > 0.6 || g.y < 0.3 && g.layer === 'terrain' ? null : g.y;
  }
  spawn(fx, fz, fy, r0) {
    const cand = []; this.around(fx, fz, r0, this.R, (wi, q) => cand.push(wi, q));
    for (let t = 0; t < 4 && cand.length; t++) {
      const u = Math.floor(this.r() * cand.length / 2) * 2, wi = cand[u], q = cand[u + 1], w = this.data.ways[wi], nv = w.length / 2;
      const x = w[q * 2], z = w[q * 2 + 1];
      if (this.peds.some(p => Math.hypot(p.x - x, p.z - z) < this.space)) continue;   // spread out: no queues
      // start on the player's level band: terrain under a footbridge / car park the player is not on is fine, a deck far above is not
      const g = this.walk(x, z, fy + 3), y = g && !g.blocked ? this.foot(x, z, g.y) : null; if (y == null || Math.abs(y - fy) > 12) continue;
      const m = Math.floor(this.r() * K), p = { wi, q, dir: q === nv - 1 ? -1 : q === 0 ? 1 : this.r() < 0.5 ? 1 : -1, s: 0, x, z, y, h: 0, rh: 0,
        v: 1.05 + 0.45 * this.r(), side: 0, side0: (this.r() - 0.5) * 0.8, sideT: 0, avoid: 0, act: null, an: null, m, col: new THREE.Color(pick(this.r, this.tops[m])), ph: this.r() * 6.28, wait: 0, stuck: 0, gait: 1 };
      if (this.recipes[m].build.id === 'old') p.v *= 0.7;
      p.side = p.sideT = p.side0; this.seg(p); p.rh = p.h; return p;
    }
    return null;
  }
  /** segment q -> q + dir of the ped's way: direction, length, heading */
  seg(p) {
    const w = this.data.ways[p.wi], a = p.q * 2, b = (p.q + p.dir) * 2, dx = w[b] - w[a], dz = w[b + 1] - w[a + 1], L = Math.hypot(dx, dz) || 1;
    p.ux = dx / L; p.uz = dz / L; p.L = L; p.ax = w[a]; p.az = w[a + 1]; p.h = Math.atan2(-p.ux, -p.uz);
  }
  /** at the end of the way: a random way vertex within JOIN m (another way, or this one's other end region), else turn round */
  next(p) {
    const w = this.data.ways[p.wi], ex = w[p.q * 2], ez = w[p.q * 2 + 1], opts = [];
    this.around(ex, ez, 0, JOIN, (wi, q) => { if (wi !== p.wi) opts.push(wi, q); });
    if (opts.length) {
      const u = Math.floor(this.r() * opts.length / 2) * 2, nv = this.data.ways[opts[u]].length / 2;
      p.wi = opts[u]; p.q = opts[u + 1]; p.dir = p.q === nv - 1 ? -1 : p.q === 0 ? 1 : this.r() < 0.5 ? 1 : -1;
    } else p.dir = -p.dir;
    p.s = 0; this.seg(p);
  }
  /** per frame. focus: { x, y, z } (the player or its vehicle); obstacles [{ x, z, r }]: people stop rather than walk into them;
   *  mover: the player's car sim (x, z, h, v) or null: people in its path step aside, startled */
  update(dt, focus, obstacles = [], mover = null) {
    const t0 = performance.now(); if (!this.max || !dt) return;
    dt = Math.min(dt, 0.1); this.mat.userData.time.value += dt;
    const fy = focus.y ?? 0;
    this.peds = this.peds.filter(p => !p.dead && Math.hypot(p.x - focus.x, p.z - focus.z) < this.R + 20);
    if (this.peds.length < this.max) { const p = this.spawn(focus.x, focus.z, fy, this.peds.length < this.max / 2 ? 6 : this.R * 0.6); if (p) this.peds.push(p); }
    this.avoid(dt, mover);
    for (const p of this.peds) this.stepPed(p, dt, obstacles);
    this.write(focus, dt);
    const ms = performance.now() - t0, s = this.stats; s.ms = s.ms * 0.95 + ms * 0.05; s.peds = this.peds.length;
  }
  /** lateral avoidance on the way (sideT, eased in stepPed): two people about to meet both keep to their right; a car heading at
   *  someone within 1.3 s makes them jump aside away from its path (startle), or freeze when their way runs across the car's path */
  avoid(dt, c) {
    const P = this.peds, cv = c ? Math.abs(c.v) : 0, vx = c ? -Math.sin(c.h) * c.v : 0, vz = c ? -Math.cos(c.h) * c.v : 0;
    for (const p of P) {
      if (p.ko) continue;
      if ((p.avoid -= dt) <= 0) p.sideT = p.side0;
      if (cv > 2) {
        const rx = p.x - c.x, rz = p.z - c.z, tc = (rx * vx + rz * vz) / (cv * cv), mx = rx - vx * tc, mz = rz - vz * tc;   // closest approach: time, miss vector
        if (tc > 0 && tc < 1.3 && Math.hypot(mx, mz) < 2 && Math.abs(p.y - c.y) < 2) {
          const nx = -p.uz, nz = p.ux, eff = (nx * vz - nz * vx) / cv, cr = rx * vz - rz * vx;
          if (!p.act) p.act = { k: 'startle', t: 0 };
          if (Math.abs(eff) > 0.5) { p.sideT = p.side + Math.sign(cr || 1) * Math.sign(eff) * 2.2; p.avoid = 2.5; } else p.wait = Math.max(p.wait, 1.2);
          continue;
        }
      }
      if (p.avoid > 0 || p.gait < 0.5) continue;
      const fx = -Math.sin(p.rh), fz = -Math.cos(p.rh);
      for (const o of P) {
        if (o === p || o.ko) continue;
        const dx = o.x - p.x, dz = o.z - p.z, al = dx * fx + dz * fz, lat = dx * fz - dz * fx;
        if (al > 0 && al < 1.8 && Math.abs(lat) < 0.6) { p.sideT = p.side0 + (p.ux * fx + p.uz * fz > 0 ? 0.75 : -0.75); p.avoid = 1.5; break; }   // keep right
      }
    }
  }
  /** the player's car s (sim/car.js) runs people over: each one hit is thrown along its motion (tumble()); at a crawl they stumble aside; -> number thrown */
  knock(s) {
    const sp = Math.abs(s.v); if (sp < 0.4 || !this.max) return 0;
    const soft = sp < (s.p.skid ? 0.6 : 2.5);   // the bulldozer shoves people at a walking pace
    const hl = s.p.halfL ?? 2.2, hw = s.p.halfW ?? 0.85, vx = -Math.sin(s.h) * s.v, vz = -Math.cos(s.h) * s.v; let n = 0;
    for (const p of this.peds) if (!p.ko && Math.abs(p.y - s.y) < 2 && inBox(p.x, p.z, s.x, s.z, s.h, hl, hw, 0.3)) {
      if (soft) { if (p.act?.k !== 'stumble') { p.act = { k: 'stumble', t: 0 }; p.sideT = p.side + Math.sign((p.x - s.x) * -p.uz + (p.z - s.z) * p.ux || 1) * 1.2; p.avoid = 2; } continue; }
      p.act = null; p.ko = { vx: vx * 0.9 + (this.r() - 0.5) * 2, vz: vz * 0.9 + (this.r() - 0.5) * 2, vy: 1.5 + sp * 0.22, w: (this.r() < 0.5 ? -1 : 1) * (3 + sp * 0.3), t: 0, land: false, up: -1 }; p.tilt = 0; n++;
    }
    return n;
  }
  /** a person who was hit: one rigid body flying (gravity), tumbling, landing with a bounce, sliding to a stop lying down, getting up after
   *  2.6 s (1.6 s) and walking on from the nearest point of the way */
  tumble(p, dt) {
    const k = p.ko, px = p.x, pz = p.z; p.gait = 0; k.t += dt;
    if (k.up >= 0) {   // getting up: the far mesh rights itself, the near rig plays getup()
      p.tilt += (0 - p.tilt) * Math.min(1, dt * 3);
      if ((k.up += dt) > 1.6) {
        p.ko = null; p.tilt = 0; const dx = p.x - p.ax, dz = p.z - p.az;
        p.s = Math.max(0, Math.min(p.L, dx * p.ux + dz * p.uz)); p.side = Math.max(-4, Math.min(4, dx * -p.uz + dz * p.ux)); p.sideT = p.side0; p.avoid = 0;   // shortcut: snaps onto the way within 4 m, a long throw pops back; path-find back when it shows
      }
      return;
    }
    k.vy -= 9.81 * dt; p.x += k.vx * dt; p.z += k.vz * dt; p.y += k.vy * dt;
    const g = this.walk(p.x, p.z, p.y + 0.5); if (g?.blocked) { p.x = px; p.z = pz; k.vx = k.vz = 0; }   // a wall: drops down it
    const gy = g && !g.blocked && g.layer !== 'none' ? g.y : -Infinity;
    if (gy === -Infinity && k.t > 6) { p.dead = true; return; }   // off the resident ground: gone
    if (p.y > gy) { p.tilt += k.w * dt; return; }
    p.y = gy; k.vy = k.vy < -3 ? -k.vy * 0.3 : 0; k.w *= 0.5; k.land = true;
    const sp = Math.hypot(k.vx, k.vz), f = sp ? Math.max(0, sp - 8 * dt) / sp : 0; k.vx *= f; k.vz *= f;
    const lie = Math.round((p.tilt - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; p.tilt += (lie - p.tilt) * Math.min(1, dt * 8);   // flat on the back or the front
    if (k.t > 2.6 && !sp && !k.vy) { k.face = Math.sin(lie) > 0 ? 1 : -1; p.tilt = wrap(p.tilt); k.up = 0; }
  }
  stepPed(p, dt, obstacles) {
    if (p.ko) return this.tumble(p, dt);
    if (p.act && (p.act.t += dt) > (p.act.k === 'stumble' ? 0.75 : 0.9)) p.act = null;
    if (p.wait > 0) { p.wait -= dt; p.gait = Math.max(0, p.gait - dt * 3); return; }
    const fx = -Math.sin(p.rh), fz = -Math.cos(p.rh);
    for (const o of obstacles) { const dx = o.x - p.x, dz = o.z - p.z, al = dx * fx + dz * fz; if (al > 0 && al < o.r + 1.2 && Math.abs(dx * fz - dz * fx) < o.r + 0.5) { p.gait = Math.max(0, p.gait - dt * 4); return; } }
    if (this.r() < dt * 0.02) { p.wait = 2 + 6 * this.r(); p.fid = Math.floor(this.r() * 4); }   // a pause every ~50 s: look at a shop window
    p.gait = Math.min(p.act?.k === 'startle' ? 1.6 : 1, p.gait + dt * 2);   // startled: hurry
    const ds = p.sideT - p.side, side = p.side + Math.sign(ds) * Math.min(Math.abs(ds), dt * (p.act ? 3.5 : 0.9));   // sidestep: quick when startled
    const s = p.s + p.v * dt * p.gait, at = sd => { const x = p.ax + p.ux * s - p.uz * sd, z = p.az + p.uz * s + p.ux * sd; return [x, z, this.foot(x, z, p.y)]; };
    let [x, z, y] = at(side); if (y == null && side !== p.side) { p.sideT = p.side; [x, z, y] = at(p.side); } else p.side = side;   // no room to the side: stay in line
    if (y == null) { p.dir = -p.dir; p.q -= p.dir; p.s = Math.max(0, p.L - p.s); p.side = -p.side; p.sideT = -p.sideT; this.seg(p); if ((p.stuck += 1) > 6) p.dead = true; return; }   // wall, kerb drop, water: back the way it came
    p.stuck = Math.max(0, p.stuck - dt); p.s = s; p.x = x; p.z = z; p.y = y;
    if (p.s >= p.L) {
      p.s -= p.L; p.q += p.dir; const nv = this.data.ways[p.wi].length / 2;
      if (p.q <= 0 && p.dir < 0 || p.q >= nv - 1 && p.dir > 0) this.next(p); else this.seg(p);
    }
    p.rh += Math.atan2(Math.sin(p.h - p.rh), Math.cos(p.h - p.rh)) * Math.min(1, dt * 6);   // ease round corners
  }
  /** near person k: the rig pose for its state (crossfaded) -> skinning matrices into bone-texture row k */
  pose(p, k, dt) {
    const r = this.rigs[p.m], an = p.an ||= new Animator(), T = an.T, ko = p.ko, a = p.act; let key, fade = 0.2;
    p.t = (p.t ?? this.r() * 9) + dt;
    if (ko) {
      if (ko.up >= 0) { r.getup(T, Math.min(1, ko.up / 1.6), ko.face); key = 'getup'; fade = 0.1; }
      else if (ko.land) { r.lie(T, Math.sin(p.tilt) > 0 ? 1 : -1); key = 'lie'; fade = 0.25; }
      else { r.air(T, { vy: ko.vy, fall: 1, t: p.t }); key = 'air'; fade = 0.1; }
    } else if (a?.k === 'stumble') { r.stumble(T, a.t / 0.75); key = 'stumble'; fade = 0.1; }
    else if (a?.k === 'startle' && a.t < 0.45) { T.set(r.key('startle')); key = 'startle'; fade = 0.1; }
    else {
      const v = p.wait > 0 ? 0 : p.v * p.gait, A = v < 0.05 ? 0 : (0.22 + 0.07 * v) * Math.min(1, v / 0.8) * (p.stride ??= (0.93 + 0.14 * this.r()) * this.recipes[p.m].build.height / 1.76), run = Math.max(0, p.gait - 1);
      if (A > 0) p.sp = (p.sp ?? p.ph) + Math.PI * (0.6 - 0.2 * run) / A * v * dt;   // stride phase from the distance walked: feet stay planted
      r.loco(T, { ph: p.sp ?? 0, A, walk: Math.min(1, p.gait), run, t: p.t, seed: p.ph, fid: p.fid }); key = 'loco';
    }
    r.matrices(an.update(dt, key, fade), this.tex.image.data, k * SLOTS * 16);
  }
  write(focus, dt = 0) {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), n = [0, 0];
    for (const p of this.peds) p.d = Math.hypot(p.x - focus.x, p.z - focus.z);
    this.peds.sort((a, b) => a.d - b.d);   // the closest people get the rig
    for (const p of this.peds) {
      const near = p.d < LOD0 && n[0] < NEAR, L = this.L[near ? 0 : 1], k = n[near ? 0 : 1]++;
      q.setFromAxisAngle(up, p.rh + Math.PI); if (p.ko && (!near || !p.ko.land)) q.multiply(qt.setFromAxisAngle(ax, p.tilt));   // flying (and far): tipped about the feet; near and down: the rig lies / gets up
      M.compose(v.set(p.x, p.y, p.z), q, one); M.toArray(L.im.instanceMatrix.array, k * 16);
      L.sel.array[k] = p.m + 1; L.im.setColorAt(k, p.col);
      if (near) this.pose(p, k, dt); else { L.anim.array[k * 2] = Math.min(1, p.gait); L.anim.array[k * 2 + 1] = p.ph; p.an = null; }
    }
    this.L.forEach((L, i) => { L.im.count = n[i]; L.im.instanceMatrix.needsUpdate = true; L.im.instanceColor.needsUpdate = true; L.sel.needsUpdate = true; L.anim.needsUpdate = true; });
    if (n[0]) this.tex.needsUpdate = true;
    this.stats.lod0 = n[0];
  }
  /** time-of-day light (render/world.js TimeCycle state) */
  light(rgb) { if (rgb) { this.mat.color.setRGB(...rgb); this.smat.color.setRGB(...rgb); } }
}
