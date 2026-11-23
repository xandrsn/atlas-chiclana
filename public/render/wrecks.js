// Crash damage on top of the existing sim: crashFx() turns a hit into dents + sparks + glass + loose parts on any vehicle mesh (the player's
// car and the wrecks), Wrecks keeps the cars the player (or the bulldozer) has hit: an ambient car that takes a real knock leaves the
// traffic / parking fleet (traffic/ambient.js take()) and becomes a body with its own mesh (one draw call each, at most MAX at a time,
// none otherwise), the damaged skin (render/dent.js), a velocity that slides it to a stop (physics.js impulses), and rolls over when hit
// from the side (sim/crash.js). The player's car and the dozer meet it with bump(), like the traffic.
import * as THREE from 'three';
import { buildVehicle } from '../vehicles/carmesh.js';
import { Skin } from './dent.js';
import { collide, contact, inertia } from '../sim/physics.js';
import { inBox } from '../traffic/park_math.js';
import { startTumble, tumbleStep, liftOf } from '../sim/crash.js';

const MAX = 3, FAR = 260, HIT_GAP = 0.2, KEEP = 15;   // wrecks at once (each is a draw call: perf <= 45), drop distance (m), min seconds between dents of one wreck, a dropped wreck's parked car stays gone if its slot is this close to the vehicle
const world = (b, lx, lz) => [b.x - Math.cos(b.h) * lx - Math.sin(b.h) * lz, b.z + Math.sin(b.h) * lx - Math.cos(b.h) * lz];

/** one hit on a body b = { x, y, z, h, hl, hw } (its mesh skin sk, paint colour col): e = { kind, dv, px, pz (world contact), nx, nz (push on b) }.
 *  Dents the mesh, throws sparks / glass / the torn-off parts. -> the Skin.dent() result */
export function crashFx(fx, sk, b, e, col = '#888') {
  const dx = e.px - b.x, dz = e.pz - b.z, c = Math.cos(b.h), s = Math.sin(b.h), clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const lx = clamp(-c * dx + s * dz, b.hw), lz = clamp(-s * dx - c * dz, b.hl), n = Math.hypot(e.nx, e.nz) || 1, ix = (-c * e.nx + s * e.nz) / n, iz = (-s * e.nx - c * e.nz) / n;
  const r = sk.dent(lx, 0.65, lz, ix, iz, e.dv), y = b.y + 0.6;
  if (e.dv > 2.5) fx.sparks(e.px, y, e.pz, -e.nx / n, -e.nz / n, Math.min(8, e.dv * 0.7), Math.min(10, 2 + e.dv * 0.4));
  if (r.glass) { const [gx, gz] = world(b, 0, 0); fx.shards(gx, b.y + 1.1, gz, r.glass * 7); }
  for (const p of r.parts) {
    const [wx, wz] = world(b, 0, p.z), out = Math.sign(p.z), fz = -Math.cos(b.h) * out, fxx = -Math.sin(b.h) * out;
    if (p.part === 'bumper') fx.chunk(wx, b.y + p.y, wz, fxx * 3 + (Math.random() - 0.5) * 2, 2.5, fz * 3 + (Math.random() - 0.5) * 2, [p.w, 0.22, 0.2], '#26272a');
    else fx.chunk(wx, b.y + p.y + 0.3, wz, fxx * 2 + (Math.random() - 0.5) * 2, 6, fz * 2 + (Math.random() - 0.5) * 2, [p.w, 0.06, p.l], col);   // the bonnet pops up
  }
  return r;
}
/** engine smoke while a body is damaged: call every frame; st = { acc } of that body */
export function smokeTick(fx, sk, b, st, dt) {
  if (sk.dmg < 0.5) return;
  st.acc = (st.acc || 0) + dt * (4 + (sk.dmg - 0.5) * 14); const [vx, vy, vz] = sk.vent(), [wx, wz] = world(b, vx, vz);
  while (st.acc >= 1) { st.acc--; fx.smoke(wx, b.y + vy + 0.2, wz, Math.min(1, sk.dmg - 0.3)); }
}

export class Wrecks {
  /** groundAt(x, z, y) -> height | null; blocked(x, z, h, hw, hl, y) -> bool (building walls) */
  constructor({ scene, mat, fx, specs, groundAt, blocked = () => false, onDrop = () => {} }) {
    Object.assign(this, { scene, mat, fx, specs, groundAt, blocked, onDrop }); this.list = []; this.t = 0;
  }
  /** a car becomes a wreck: o = { spec (id), color, x, y, z, h, vx, vz, w, origin } */
  spawn(o) {
    const spec = this.specs.find(s => s.id === o.spec); if (!spec) return null;
    const geo = buildVehicle(spec, 0), im = new THREE.InstancedMesh(geo, this.mat, 1); im.setColorAt(0, new THREE.Color(o.color)); im.frustumCulled = false; this.scene.add(im);
    const m = spec.handling?.mass ?? 1300, hl = spec.dims.length / 2, hw = spec.dims.width / 2;
    const w = { spec, im, skin: new Skin(geo, spec), m, I: inertia(m, hl, hw), hl, hw, H: spec.dims.height, x: o.x, y: o.y, z: o.z, h: o.h, vx: o.vx || 0, vz: o.vz || 0, w: o.w || 0, tum: null, roll: 0, lift: 0, st: {}, last: -9, origin: o.origin, color: o.color, bike: spec.kind === 'bike' };
    this.list.push(w); while (this.list.length > MAX) this.drop(this.list[0]); this.pose(w); return w;
  }
  drop(w) {
    this.scene.remove(w.im); w.im.geometry.dispose(); w.im.dispose?.(); this.list = this.list.filter(l => l !== w);
    const f = this.focus, o = w.origin; if (o && f && Math.hypot(o.x - f.x, o.z - f.z) < KEEP) return;   // its slot is beside the vehicle: do not put the parked car back in its way
    this.onDrop(w);
  }
  clear() { for (const w of [...this.list]) this.drop(w); }
  pose(w) { w.im.position.set(w.x, w.y + w.lift, w.z); w.im.rotation.set(0, w.h + Math.PI, w.roll, 'YXZ'); }
  /** the body touches w with dv closing speed at (px, pz) pushed along (nx, nz): dents it (at most every HIT_GAP s) and rolls it over on a hard side hit */
  hurt(w, dv, px, pz, nx, nz, kind = 'car') {
    if (this.t - w.last < HIT_GAP) return; w.last = this.t;
    crashFx(this.fx, w.skin, w, { kind, dv, px, pz, nx, nz }, w.color);
    const side = -(w.vx * Math.cos(w.h)) + w.vz * Math.sin(w.h);
    if (!w.tum && (Math.abs(side) > 6.5 || dv > 11)) w.tum = startTumble(-Math.sign(side || Math.random() - 0.5) * Math.min(11, 5 + dv * 0.3), 0);
  }
  /** the vehicle s (player's car / dozer: { x, y, z, h, v, sx, sz, spin, p: { mass, halfL, halfW, crush }, hit() }) against the wrecks */
  bump(s) {
    const p = s.p, A = { x: s.x, z: s.z, h: s.h, hl: p.halfL ?? 2.2, hw: p.halfW ?? 0.85 }, ma = p.mass ?? 1300; let n = 0;
    for (const w of this.list) {
      if (Math.abs(w.x - s.x) > 14 || Math.abs(w.z - s.z) > 14 || Math.abs(w.y - s.y) > 2.5) continue;
      const B = { x: w.x, z: w.z, h: w.h, hl: w.hl, hw: w.hw }, k = contact(A, B); if (!k) continue;
      const fa = w.m / (ma + w.m); s.x -= k.nx * k.d * fa; s.z -= k.nz * k.d * fa; w.x += k.nx * k.d * (1 - fa); w.z += k.nz * k.d * (1 - fa); A.x = s.x; A.z = s.z;
      const fx = -Math.sin(s.h), fz = -Math.cos(s.h), a = { m: ma, I: inertia(ma, A.hl, A.hw), x: s.x, z: s.z, vx: fx * s.v + s.sx, vz: fz * s.v + s.sz, w: s.spin }, b = { m: w.m, I: w.I, x: w.x, z: w.z, vx: w.vx, vz: w.vz, w: w.w };
      const J = collide(a, b, k.px, k.pz, k.nx, k.nz, 0.25); if (!J) continue;
      s.v = a.vx * fx + a.vz * fz; s.sx = a.vx - fx * s.v; s.sz = a.vz - fz * s.v; s.spin = a.w; w.vx = b.vx; w.vz = b.vz; w.w = b.w; n++;
      s.hit?.({ kind: 'car', dv: J / ma, px: k.px, pz: k.pz, nx: -k.nx, nz: -k.nz });
      this.hurt(w, Math.max(J / w.m, p.crush ? Math.abs(s.v) * 1.3 + 2 : 0), k.px, k.pz, k.nx, k.nz);
    }
    return n;
  }
  /** wreck-to-wreck impulses (stacking: a pushed car hits the next) */
  pairs() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) continue;
      const k = contact(a, b); if (!k) continue;
      const fa = b.m / (a.m + b.m); a.x -= k.nx * k.d * fa; a.z -= k.nz * k.d * fa; b.x += k.nx * k.d * (1 - fa); b.z += k.nz * k.d * (1 - fa);
      const J = collide(a, b, k.px, k.pz, k.nx, k.nz, 0.25); if (!J) continue;
      this.hurt(a, J / a.m, k.px, k.pz, -k.nx, -k.nz); this.hurt(b, J / b.m, k.px, k.pz, k.nx, k.nz);
    }
  }
  /** slide, spin, roll, settle; drop the far ones; focus = { x, z } */
  update(dt, focus) {
    this.t += dt; this.focus = focus; if (dt <= 0) return; this.pairs();
    for (const w of [...this.list]) {
      if (Math.hypot(w.x - focus.x, w.z - focus.z) > FAR) { this.drop(w); continue; }
      const sp = Math.hypot(w.vx, w.vz), f = sp ? Math.max(0, sp - (w.tum ? 4 : 7) * dt) / sp : 0; w.vx *= f; w.vz *= f; w.w *= Math.max(0, 1 - 2.5 * dt);
      const px = w.x, pz = w.z, ph = w.h; w.x += w.vx * dt; w.z += w.vz * dt; w.h += w.w * dt;
      if (this.blocked(w.x, w.z, w.h, w.hw, w.hl, w.y)) { w.x = px; w.z = pz; w.h = ph; w.vx = w.vz = w.w = 0; }
      const g = this.groundAt(w.x, w.z, w.y + 0.5); if (g != null) w.y = g;
      if (w.tum) { tumbleStep(w.tum, dt, w.bike); w.roll = w.tum.a; w.lift = liftOf(w.tum.a, w.hw, w.H); if (w.tum.done) { w.tum = null; w.roll = w.lift = 0; } }
      smokeTick(this.fx, w.skin, w, w.st, dt); this.pose(w);
    }
  }
  /** an ambient parked car whose body the vehicle s (about to move) will touch: it becomes a wreck so the impulse model can shove it.
   *  amb: traffic/ambient.js; h: the step. -> number promoted */
  catchParked(amb, s, h) {
    const reach = Math.abs(s.v) * h * 2 + 0.6, hl = (s.p.halfL ?? 2.2) + reach / 2, hw = (s.p.halfW ?? 0.85) + 0.3, cx = s.x - Math.sin(s.h) * Math.sign(s.v || 1) * reach / 2, cz = s.z - Math.cos(s.h) * Math.sign(s.v || 1) * reach / 2; let n = 0;
    for (const o of [...amb.near]) {
      if (Math.abs(o.x - s.x) > 12 || Math.abs(o.z - s.z) > 12 || Math.abs(o.y - s.y) > 2 || amb.taken.has(o)) continue;
      if (!inBox(o.x, o.z, cx, cz, s.h, hl, hw, Math.min(o.hw, 1) * 0.9)) continue;
      const t = amb.take(o); this.spawn({ ...t, origin: o }); n++;
    }
    return n;
  }
}
