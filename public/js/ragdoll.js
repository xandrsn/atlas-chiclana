import * as THREE from 'three';
import { VEHICLES } from './vehicles.js';

// Knock-downs, arcade style (no gore): mannequin ragdolls for NPCs and the player on foot when a vehicle hits them, and trees that snap and fall.
// Ragdoll = 9 verlet points (head, shoulders, hips, hands, feet) + distance sticks; gravity, ground (terrain / deck under the hips), buildings and
// wall / trunk circles. At most MAXR at once, drawn by ONE InstancedMesh (8 boxes each, same proportions as npcs.js), nothing allocated per frame.
// The hit NPC is removed from npcs.js at once (its slot is recycled, npcs.js spawns another elsewhere); its body lies down for a few seconds then sinks away.
// The player gets up after LIFE_P seconds (main.js skips the walker physics while `player` is set). Multiplayer: purely local, each client shows its own.
// Trees: world.js tags trunk circles with {im, i, str}; collide.js tryBreak/smash decides, this file only animates (fall about the base, splinters + leaves).
const MAXR = 8, PARTS = 8, LIFE_N = 6, LIFE_P = 3.5, NEAR = 140, BODY_M = 70, H = 1 / 60, G = -16;
const REST = [[0, 1.68, 0], [-0.22, 1.48, 0], [0.22, 1.48, 0], [-0.12, 0.9, 0], [0.12, 0.9, 0], [-0.3, 0.88, 0], [0.3, 0.88, 0], [-0.12, 0.06, 0], [0.12, 0.06, 0]];
const STICKS = [[1, 2], [3, 4], [1, 3], [2, 4], [1, 4], [2, 3], [0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [2, 6], [3, 7], [4, 8]];
const KICK = [0.8, 0.9, 0.9, 1.1, 1.1, 1, 1, 1.25, 1.25];   // feet are swept out harder than the head: the body tips over onto the bonnet
const NP = REST.length, FALLMAX = 16, DEB = 64;

export class Ragdolls {
  constructor(scene, world, audio) {
    this.w = world; this.audio = audio; this.player = null; this.falls = []; this.nHit = 0; this.nTrees = 0;
    const box = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshLambertMaterial(), z = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(box, mat, MAXR * PARTS); this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.deb = new THREE.InstancedMesh(box, mat, DEB); this.deb.frustumCulled = false; this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAXR * PARTS; i++) { this.mesh.setMatrixAt(i, z); this.mesh.setColorAt(i, white); }
    for (let i = 0; i < DEB; i++) { this.deb.setMatrixAt(i, z); this.deb.setColorAt(i, white); }
    scene.add(this.mesh, this.deb); this._z = z;
    this.R = Array.from({ length: MAXR }, (_, k) => ({ k, on: false, P: new Float32Array(NP * 3), Q: new Float32Array(NP * 3), L: new Float32Array(STICKS.length), t: 0, life: 0, acc: 0, off: 0, h: 1 }));
    this.D = { p: new Float32Array(DEB * 3), v: new Float32Array(DEB * 3), life: new Float32Array(DEB), s: new Float32Array(DEB), n: 0 };
    this.H = Array.from({ length: 48 }, () => ({})); this.nh = 0;   // hitter pool, refilled every frame
    this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4(); this._m3 = new THREE.Matrix4(); this._c = new THREE.Color();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._zz = new THREE.Vector3(); this._s = new THREE.Vector3(); this._ax = new THREE.Vector3();
    this.P = {};   // tram pose scratch
    if (world.col) world.col.onBreak = (t, dx, dz, v) => this.fell(t, dx, dz, v);
  }

  // ---------------------------------------------------------------- hitters: everything moving that can knock a person down
  hit(x, y, z, vx, vz, psi, L, W, m, obj) { if (this.nh >= this.H.length) return; Object.assign(this.H[this.nh++], { x, y, z, vx, vz, fx: -Math.sin(psi), fz: -Math.cos(psi), L, W, m, obj, v: Math.hypot(vx, vz) }); }
  collect(S) {
    this.nh = 0; const cam = S.cam, near = (x, z) => Math.abs(x - cam.x) < NEAR && Math.abs(z - cam.z) < NEAR, col = this.w.col;
    if (S.mode === 'car') { const c = S.car, s = c.spec; this.hit(c.pos.x, c.pos.y, c.pos.z, c.vx, c.vz, c.psi, s.L, s.W, s.mass, c); }
    else if (S.mode === 'heli') { const h = S.heli, fx = -Math.sin(h.psi), fz = -Math.cos(h.psi), vx = fx * h.vf - fz * h.vs, vz = fz * h.vf + fx * h.vs, alt = h.pos.y - h.groundY, v = Math.hypot(vx, vz);
      if (alt < 2.5) this.hit(h.pos.x, h.pos.y, h.pos.z, vx, vz, h.psi, 7, 2.6, 3000, h);
      if (alt < 9 && col) col.smash(h.pos.x, h.pos.z, 3, 3000, v, vx / (v || 1), vz / (v || 1)); }   // rotor / skids through the canopy
    for (const c of S.traffic?.cars || []) if (c.psi !== undefined && c.v > 2 && near(c.x, c.z)) { const s = VEHICLES[c.t] || VEHICLES[0]; this.hit(c.x, c.y ?? 0, c.z, -Math.sin(c.psi) * c.v, -Math.cos(c.psi) * c.v, c.psi, s.L, s.W, s.mass, c); }
    const T = S.tram, P = this.P;
    if (T) for (const tr of T.trams) { const c = tr.cur; if (!(c.v > 1)) continue;
      for (let k = 0; k < 5; k++) { T.pose(c.s, c.w, k, P); if (!near(P.x, P.z)) continue; const vx = P.tx * c.v * c.dir, vz = P.tz * c.v * c.dir;
        this.hit(P.x, P.y, P.z, vx, vz, Math.atan2(-vx, -vz), 6.6, 2.7, 40000, null); col?.smash(P.x, P.z, 1.6, 40000, c.v, vx / c.v, vz / c.v); } }
    for (const r of S.net?.remotes?.values() || []) { if (!r.seen || (r.mode !== 'car' && r.mode !== 'heli') || !near(r.pos.x, r.pos.z)) continue;
      const heli = r.mode === 'heli', s = VEHICLES[r.veh] || VEHICLES[0], v = Math.hypot(r.vel.x, r.vel.z), m = heli ? 3000 : s.mass;
      if (!heli || r.pos.y - this.w.hf.height(r.pos.x, r.pos.z) < 2.5) this.hit(r.pos.x, r.pos.y, r.pos.z, r.vel.x, r.vel.z, r.yaw, heli ? 7 : s.L, heli ? 2.6 : s.W, m, null);
      if (v > 2 && col && (!heli || r.pos.y - this.w.hf.height(r.pos.x, r.pos.z) < 9)) col.smash(r.pos.x, r.pos.z, heli ? 3 : 0.8 + s.W * 0.3, m, v, r.vel.x / v, r.vel.z / v); }
  }
  /** first hitter whose footprint (+0.3 m) covers (x,y,z) while moving faster than 3 m/s */
  hitBy(x, y, z) {
    for (let i = 0; i < this.nh; i++) { const h = this.H[i]; if (h.v < 3 || Math.abs(y - h.y) > 2.5) continue;
      const dx = x - h.x, dz = z - h.z; if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      const a = dx * h.fx + dz * h.fz, b = dx * -h.fz + dz * h.fx; if (Math.abs(a) < h.L / 2 + 0.3 && Math.abs(b) < h.W / 2 + 0.3) return h; }
    return null;
  }

  // ---------------------------------------------------------------- ragdolls
  /** start a ragdoll from a standing pose (feet at x,y,z, facing yaw as npcs.js draws it), knocked by hitter h; cols = [shirt, pants, skin, hair] */
  launch(x, y, z, yaw, scale, cols, h, player) {
    let r = this.R.find(q => !q.on);
    if (!r) { r = this.R.filter(q => q !== this.player?.r).sort((a, b) => b.t - a.t)[0]; if (!r) return null; }   // full: recycle the oldest NPC body
    const k = (1.3 * h.m) / (h.m + BODY_M), vx = h.vx * k, vz = h.vz * k, sp = Math.hypot(vx, vz), cap = sp > 24 ? 24 / sp : 1, vy = 1.5 + 0.3 * Math.min(sp, 24);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < NP; i++) { const [lx, ly, lz] = REST[i], j = i * 3, f = KICK[i] * cap, rx = (Math.random() - 0.5) * 1.6, rz = (Math.random() - 0.5) * 1.6;
      r.P[j] = x + (lx * c + lz * s) * scale; r.P[j + 1] = y + ly * scale; r.P[j + 2] = z + (-lx * s + lz * c) * scale;
      r.Q[j] = r.P[j] - (vx * f + rx) * H; r.Q[j + 1] = r.P[j + 1] - vy * (2 - KICK[i]) * H; r.Q[j + 2] = r.P[j + 2] - (vz * f + rz) * H; }
    STICKS.forEach(([a, b], i) => { r.L[i] = Math.hypot(r.P[a * 3] - r.P[b * 3], r.P[a * 3 + 1] - r.P[b * 3 + 1], r.P[a * 3 + 2] - r.P[b * 3 + 2]); });
    Object.assign(r, { on: true, t: 0, life: player ? LIFE_P : LIFE_N, acc: 0, h: scale, sink: 0 });
    for (let p = 0; p < PARTS; p++) this.mesh.setColorAt(r.k * PARTS + p, this._c.set(cols[[0, 1, 2, 3, 1, 1, 0, 0][p]]));
    this.mesh.instanceColor.needsUpdate = true; this.nHit++;
    const mag = Math.min(1, Math.hypot(h.vx, h.vz) / 20); if (this.audio?.ctx) this.audio.thud(0.25 + mag * 0.6);
    if (h.obj && h.obj.bump !== undefined) h.obj.bump = Math.max(h.obj.bump, 0.2);   // the player's car feels it
    return r;
  }
  step(r, b, col) {
    const P = r.P, Q = r.Q, hf = this.w.hf;
    for (let j = 0; j < NP * 3; j += 3) { const vx = (P[j] - Q[j]) * 0.995, vy = (P[j + 1] - Q[j + 1]) * 0.995, vz = (P[j + 2] - Q[j + 2]) * 0.995; Q[j] = P[j]; Q[j + 1] = P[j + 1]; Q[j + 2] = P[j + 2]; P[j] += vx; P[j + 1] += vy + G * H * H; P[j + 2] += vz; }
    for (let it = 0; it < 4; it++) STICKS.forEach(([a, c], i) => { a *= 3; c *= 3; const dx = P[c] - P[a], dy = P[c + 1] - P[a + 1], dz = P[c + 2] - P[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6, f = (d - r.L[i]) / d * 0.5;
      P[a] += dx * f; P[a + 1] += dy * f; P[a + 2] += dz * f; P[c] -= dx * f; P[c + 1] -= dy * f; P[c + 2] -= dz * f; });
    for (let j = 0; j < NP * 3; j += 3) {
      if (b && b.hit(P[j], P[j + 2], P[j + 1])) { const mx = P[j] - Q[j], mz = P[j + 2] - Q[j + 2]; P[j] = Q[j]; P[j + 2] = Q[j + 2]; Q[j] = P[j] + mx * 0.3; Q[j + 2] = P[j + 2] + mz * 0.3; }   // bounce off the wall
      const hc = col?.resolve(P[j], P[j + 2], 0.1, 0.5, P[j + 1]); if (hc) { P[j] = hc.x; P[j + 2] = hc.z; }
      const g = hf.height(P[j], P[j + 2]) + r.off + 0.06 - r.sink;
      if (P[j + 1] < g) { const vy = P[j + 1] - Q[j + 1]; P[j + 1] = g; Q[j + 1] = g + vy * 0.3; Q[j] = P[j] - (P[j] - Q[j]) * 0.55; Q[j + 2] = P[j + 2] - (P[j + 2] - Q[j + 2]) * 0.55; }   // small bounce + ground friction
    }
  }
  /** hips centre into out (x,y,z) */
  hips(r, out) { const P = r.P; return out.set((P[9] + P[12]) / 2, (P[10] + P[13]) / 2, (P[11] + P[14]) / 2); }
  draw(r) {
    const P = r.P, m = this._m, X = this._x, Y = this._y, Z = this._zz, A = this._a, B = this._b, S = this._s, base = r.k * PARTS, h = r.h;
    const pt = (i, v) => v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const side = this._ax; pt(2, side).sub(pt(1, A));   // shoulder line = body's right
    const put = (p, cx, cy, cz, w, l, d) => {   // Y already set: build an orthonormal frame with X ~ side
      X.copy(side).addScaledVector(Y, -side.dot(Y)); if (X.lengthSq() < 1e-6) X.set(1, 0, 0); X.normalize(); Z.crossVectors(X, Y);
      m.makeBasis(X, Y, Z).scale(S.set(w * h, l * h, d * h)).setPosition(cx, cy, cz); this.mesh.setMatrixAt(base + p, m); };
    // torso (shirt) + hips (pants): from the hips centre up to the shoulders centre
    pt(1, A).add(pt(2, B)).multiplyScalar(0.5); const sx = A.x, sy = A.y, sz = A.z; pt(3, A).add(pt(4, B)).multiplyScalar(0.5);
    Y.set(sx - A.x, sy - A.y, sz - A.z).normalize();
    put(0, (sx + A.x) / 2, (sy + A.y) / 2, (sz + A.z) / 2, 0.52, 0.66, 0.28); put(1, A.x, A.y, A.z, 0.52, 0.2, 0.28);
    pt(0, A); Y.set(A.x - sx, A.y - sy, A.z - sz).normalize(); put(2, A.x, A.y, A.z, 0.22, 0.24, 0.24); put(3, A.x + Y.x * 0.15 * h, A.y + Y.y * 0.15 * h, A.z + Y.z * 0.15 * h, 0.24, 0.09, 0.26);
    const limb = (p, i0, i1, w, l, d) => { pt(i0, A); pt(i1, B); Y.subVectors(A, B).normalize(); put(p, (A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2, w, l, d); };
    limb(4, 3, 7, 0.17, 0.85, 0.2); limb(5, 4, 8, 0.17, 0.85, 0.2); limb(6, 1, 5, 0.12, 0.62, 0.14); limb(7, 2, 6, 0.12, 0.62, 0.14);
  }
  free(r) { r.on = false; for (let p = 0; p < PARTS; p++) this.mesh.setMatrixAt(r.k * PARTS + p, this._z); if (this.player?.r === r) this.player = null; }

  // ---------------------------------------------------------------- trees
  /** collide.js onBreak: tip the instance over about its base towards (dx,dz), then shrink it away; splinters + leaves */
  fell(t, dx, dz, v) {
    this.nTrees++; const im = t.im; if (!im) return;
    const M0 = new THREE.Matrix4(); im.getMatrixAt(t.i, M0);   // one small object per broken tree (not per frame)
    if (this.falls.length >= FALLMAX) { im.setMatrixAt(t.i, this._z); im.instanceMatrix.needsUpdate = true; } else this.falls.push({ im, i: t.i, M0, ax: dx || dz ? new THREE.Vector3(dz, 0, -dx).normalize() : new THREE.Vector3(1, 0, 0), t: 0, sp: 2 + Math.min(4, v * 0.15) });
    const D = this.D, x = M0.elements[12], y = M0.elements[13], z = M0.elements[14], sc = Math.hypot(M0.elements[4], M0.elements[5], M0.elements[6]) || 1;
    for (let n = 0; n < 14; n++) { const i = D.n++ % DEB, leaf = n >= 6, j = i * 3, up = leaf ? (2.5 + Math.random() * 3) * sc : 0.4 + Math.random();
      D.p[j] = x + (Math.random() - 0.5) * 1.2; D.p[j + 1] = y + up; D.p[j + 2] = z + (Math.random() - 0.5) * 1.2;
      D.v[j] = dx * v * 0.25 + (Math.random() - 0.5) * 4; D.v[j + 1] = 2 + Math.random() * 4; D.v[j + 2] = dz * v * 0.25 + (Math.random() - 0.5) * 4;
      D.life[i] = 1.2 + Math.random() * 0.8; D.s[i] = leaf ? 0.22 + Math.random() * 0.2 : 0.1 + Math.random() * 0.08;
      this.deb.setColorAt(i, this._c.setHex(leaf ? [0x4f7a32, 0x6a8f3c, 0x3d6427][n % 3] : [0xb08a5a, 0x8a6a44][n & 1])); }
    this.deb.instanceColor.needsUpdate = true;
  }
  updateTrees(dt) {
    const m = this._m, m2 = this._m2, m3 = this._m3;
    for (let k = this.falls.length - 1; k >= 0; k--) { const f = this.falls[k]; f.t += dt;
      const e = f.M0.elements, ang = Math.min(1.45, 0.5 * f.sp * f.t * f.t), sh = f.t < 2.2 ? 1 : Math.max(0, 1 - (f.t - 2.2) / 0.6);
      m.makeTranslation(e[12], e[13], e[14]).multiply(m2.makeRotationAxis(f.ax, ang)).multiply(m3.makeScale(sh, sh, sh)).multiply(m2.makeTranslation(-e[12], -e[13], -e[14])).multiply(f.M0);
      f.im.setMatrixAt(f.i, sh > 0 ? m : this._z); f.im.instanceMatrix.needsUpdate = true;
      if (sh <= 0) { this.falls[k] = this.falls[this.falls.length - 1]; this.falls.pop(); } }
    const D = this.D; let any = false;
    for (let i = 0; i < DEB; i++) { if (D.life[i] <= 0) continue; any = true; const j = i * 3; D.life[i] -= dt;
      D.v[j + 1] += G * 0.6 * dt; D.p[j] += D.v[j] * dt; D.p[j + 1] += D.v[j + 1] * dt; D.p[j + 2] += D.v[j + 2] * dt;
      const g = this.w.hf.height(D.p[j], D.p[j + 2]); if (D.p[j + 1] < g) { D.p[j + 1] = g; D.v[j] *= 0.5; D.v[j + 2] *= 0.5; D.v[j + 1] = 0; }
      const s = D.life[i] > 0 ? D.s[i] * Math.min(1, D.life[i] * 2) : 0;
      this.deb.setMatrixAt(i, s > 0 ? m.makeRotationY(i + D.life[i] * 5).scale(this._s.set(s, s, s)).setPosition(D.p[j], D.p[j + 1], D.p[j + 2]) : this._z); }
    if (any || this._debOn) this.deb.instanceMatrix.needsUpdate = true; this._debOn = any;
  }

  // ---------------------------------------------------------------- per frame (main.js)
  /** S = { mode, car, heli, walker, traffic, tram, net, npcs, cam } */
  update(dt, S) {
    dt = Math.min(dt, 0.1); this.updateTrees(dt);
    this.collect(S);
    const W = S.walker;
    if (this.player && S.mode !== 'walker') this.free(this.player.r);   // switched to a vehicle (V / E / R): drop the body, the walker is hidden anyway
    if (this.nh) {
      const N = S.npcs;
      if (N?.on) for (let i = N.list.length - 1; i >= 0; i--) { const n = N.list[i], h = this.hitBy(n.x, n.y, n.z); if (!h) continue;
        if (this.launch(n.x, n.y - (n.k === 'sit' ? n.sy : 0), n.z, n.yaw, n.h, [n.shirt, n.pants, n.skin, n.hair], h, false)) N.kill(i); }
      if (S.mode === 'walker' && !this.player && !S.tram?.rider && W.group.visible) { const h = this.hitBy(W.pos.x, W.pos.y, W.pos.z);
        if (h) { const ch = W.body.children, r = this.launch(W.pos.x, W.pos.y, W.pos.z, W.psi, 1, [0, 1, 2, 3].map(q => ch[q].material.color.getHex()), h, true);
          if (r) { this.player = { r }; W.group.visible = false; W.vx = W.vz = W.vy = 0; } } }
    }
    const b = this.w.buildings, col = this.w.col, A = this._a;
    let drawn = false;
    for (const r of this.R) { if (!r.on) continue; drawn = true; r.t += dt;
      if (r !== this.player?.r && (Math.abs(r.P[0] - S.cam.x) > NEAR * 1.5 || Math.abs(r.P[2] - S.cam.z) > NEAR * 1.5)) { this.free(r); continue; }
      this.hips(r, A); const sf = this.w.surf(A.x, A.z, A.y + 0.5, true), off = sf - this.w.hf.height(A.x, A.z); r.off = Number.isFinite(off) ? off : 0;   // deck / pavement height under the hips
      if (r !== this.player?.r && r.t > r.life - 0.8) r.sink = (r.t - r.life + 0.8) * 0.6;   // the body sinks away at the end
      r.acc += dt; let n = 0; while (r.acc >= H && n++ < 6) { this.step(r, b, col); r.acc -= H; }
      const bad = !r.P.every(Number.isFinite);   // safety net: never draw / follow a NaN body
      if (bad || r.t >= r.life) {
        if (this.player?.r === r) { if (!bad) { this.hips(r, A); W.place(A.x, A.z, W.psi); } W.group.visible = true; }   // get up where the body lies
        this.free(r); continue; }
      this.draw(r);
      if (this.player?.r === r) { this.hips(r, A); W.pos.set(A.x, Math.max(A.y - 0.9, this.w.hf.height(A.x, A.z) + r.off), A.z); }   // the camera follows the body
    }
    if (drawn || this._on) this.mesh.instanceMatrix.needsUpdate = true; this._on = drawn;
  }
  get active() { return this.R.filter(r => r.on).length; }
}
