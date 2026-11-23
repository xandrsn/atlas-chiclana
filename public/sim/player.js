// On-foot protagonist, fixed-step like the car (data/v2.json walker speeds + data/controls.json player). Heading 0 = facing north
// (-z), same as the car. Moves in a camera-relative world direction and turns smoothly towards it. Building walls come with the ground callback (sim/walls.js).
// this.act = scripted state (input ignored or damped): stumble (shoved / ran into a wall), roll (high drop while moving), lie, getup, knock (thrown).
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const SLIDE = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];   // radians, nearest to the wanted move first

export class Player {
  constructor(walker, p, ground) { this.w = walker; this.p = p; this.ground = ground; this.x = this.z = this.y = this.h = this.v = this.vy = 0; this.air = false; this.prev = null; this.sy = this.ph = this.lean = this.fl = this.slope = this.cr = this.pre = this.om = this.top = this.spin = 0; this.act = null; this.save(); }
  // ground(x, z, yHint) -> height, or { y, blocked, ceil } (sim/ground.js, layered); place() takes the top surface unless given a yHint
  place(x, z, h = 0, yHint = Infinity) { this.x = x; this.z = z; this.h = h; this.v = this.vy = this.pre = this.cr = 0; this.air = false; this.act = null; const g = this.ground(x, z, yHint); this.y = this.gy = this.sy = g?.y ?? g; this.save(); }
  save() { this.prev = { x: this.x, y: this.y, z: this.z, h: this.h, sy: this.sy, ph: this.ph, lean: this.lean, fl: this.fl }; }
  /** in: { dx, dz } world move direction (length 0..1), run 0/1, jump 0/1 */
  step(dt, i) {
    this.save(); const p = this.p;
    if (this.act && this.acting(dt)) return;
    const sh = this.act?.k === 'stumble' ? this.act : null, mag = Math.min(1, Math.hypot(i.dx, i.dz)) * (sh ? 0.3 : 1);   // stumbling: barely steerable
    const want = mag * (i.run ? this.w.run : this.w.speed);
    const v0 = this.v, h0 = this.h, ac = want < this.v ? p.decel ?? p.accel : p.accel;   // inertia: speeding up is slower than stopping
    this.v += Math.max(-ac * dt, Math.min(ac * dt, want - this.v));
    if (mag > 0.05) this.h += wrap(Math.atan2(-i.dx, -i.dz) - this.h) * (1 - Math.exp(-p.turnRate * dt));
    // move along the input direction (not the lagging heading) so control stays crisp while the body turns; a shove carries the body on
    const dir = mag > 0.05 ? Math.atan2(-i.dx, -i.dz) : this.h;
    const r = this.move(-Math.sin(dir) * this.v * dt + (sh?.vx || 0) * dt, -Math.cos(dir) * this.v * dt + (sh?.vz || 0) * dt);
    if (sh) { sh.t += dt; const f = Math.exp(-5 * dt); sh.vx *= f; sh.vz *= f; if (sh.t > 0.75) this.act = null; }
    else if (this.hitWall > 0.9 && v0 > 3.4 && !this.air) { this.act = { k: 'stumble', t: 0, vx: 0, vz: 0 }; this.v *= 0.35; }   // ran square into a wall: stumbles back
    const g = r?.blocked ? this.y : r?.y ?? r; this.gy = g; this.ceil = r?.ceil ?? Infinity;
    if (!this.air && g < this.y - 0.6) { this.air = true; this.vy = 0; this.top = this.y; }   // walked off an edge (cut, deck end): fall
    if (i.jump && !this.air && this.pre <= 0 && !sh) this.pre = 0.12;   // anticipation: crouch first, then push off
    if (this.pre > 0) { this.cr += (0.24 - this.cr) * (1 - Math.exp(-30 * dt)); if ((this.pre -= dt) <= 0 && !this.air) { this.vy = p.jumpSpeed; this.air = true; this.top = this.y; } }
    else this.cr *= Math.exp(-9 * dt);   // landing absorbs, then recovers
    if (this.air) {
      this.vy -= p.gravity * dt; this.y += this.vy * dt; this.top = Math.max(this.top, this.y); this.fall = this.vy < 0 ? (this.fall || 0) + dt : 0;
      if (this.y <= g) {   // landing: the knees absorb it; from high up a roll when moving, else flat on the face, then gets up
        const drop = this.top - g; this.cr = Math.min(0.3, Math.max(this.cr, -this.vy * 0.04)); this.y = g; this.vy = 0; this.air = false; this.fall = 0;
        if (drop > 3.2) this.act = this.v > 3.5 ? { k: 'roll', t: 0 } : { k: 'lie', t: 0, face: 1 };
        else if (drop > 1.6) this.v *= 0.5;
      }
    }
    else this.y = g;
    // procedural gait inputs: stride phase advances with the distance walked (feet stay planted), body lean from turning / accelerating,
    // ground slope under the feet (foot IK), smoothed height so kerbs and steps are climbed, not teleported
    const gt = this.gait, run = Math.max(0, gt - 1), d = 0.6 - 0.2 * run, turned = Math.abs(wrap(this.h - h0));
    this.spin = this.v < 0.6 && !this.air ? Math.min(1, turned / dt / 3) : 0;   // turning on the spot: small steps
    const A = this.stride;
    if (A > 0) this.ph += 2 * Math.PI * d / (2 * A) * Math.max(this.v, this.spin * 0.6) * dt;
    const k = 1 - Math.exp(-8 * dt), turn = wrap(this.h - h0) / dt;
    this.om += (turn - this.om) * k; const lm = p.leanMax ?? 0.06; this.lean += (Math.max(-lm, Math.min(lm, this.om * this.v * 0.01)) * run - this.lean) * k;   // lean into curves: a few degrees, running only
    this.fl += (Math.max(-0.03, Math.min(0.03, (this.v - v0) / dt * 0.002)) + 0.02 * run - this.fl) * k;
    const sx = Math.sin(this.h) * 0.35, sz = Math.cos(this.h) * 0.35, yh = this.y + 0.3, ys = q => { const r = this.ground(this.x + q * sx, this.z + q * sz, yh); return r?.blocked ? NaN : r?.y ?? r; };
    this.slope += (this.air ? 0 : Math.max(-0.9, Math.min(0.9, (ys(-1) - ys(1)) / 0.7 || 0)) - this.slope) * (1 - Math.exp(-12 * dt));
    this.sy += (this.y - this.sy) * (1 - Math.exp(-(this.air ? 40 : 16) * dt));
  }
  /** move by (dx, dz) against the walls: slide along a facade (the move turned up to 80 deg either way, shortened by the cosine), else stay
   *  put; already stuck there (spawned inside): walk out. Sets this.hitWall (0 free .. 1 head-on). -> ground result at the new spot */
  move(dx, dz) {
    const qx = this.x, qz = this.z; this.x += dx; this.z += dz; this.hitWall = 0;
    let r = this.ground(this.x, this.z, this.y);
    if (r?.blocked) {
      let free = false;
      for (const a of SLIDE) { const c = Math.cos(a), s = Math.sin(a), x = qx + (dx * c - dz * s) * c, z = qz + (dx * s + dz * c) * c, g = this.ground(x, z, this.y); if (!g?.blocked) { this.x = x; this.z = z; r = g; free = true; this.hitWall = Math.abs(a) / 1.4; break; } }
      if (!free) { this.hitWall = 1; if (!this.ground(qx, qz, this.y)?.blocked) { this.x = qx; this.z = qz; this.v = 0; } }
    }
    return r;
  }
  /** thrown by a vehicle / blast: ballistic (vx, vy, vz m/s), lands flat (on the face when thrown forwards), then gets up */
  knock(vx, vy, vz) {
    if (this.act?.k === 'knock') return;
    const fwd = -Math.sin(this.h) * vx - Math.cos(this.h) * vz;
    this.act = { k: 'knock', t: 0, vx, vy, vz, face: fwd > 0 ? 1 : -1 }; this.air = true; this.v = 0; this.pre = 0;
  }
  /** a shove (a passer-by, a slow car): stumbles along (vx, vz) m/s, recovers */
  push(vx, vz) { if (!this.act && !this.air) this.act = { k: 'stumble', t: 0, vx, vz }; }
  /** scripted states, input ignored: knock (flight), roll (carries on, slowing), lie, getup. -> true when it handled the step */
  acting(dt) {
    const a = this.act, p = this.p; if (a.k === 'stumble') return false;
    a.t += dt; this.cr *= Math.exp(-9 * dt); this.spin = 0;
    if (a.k === 'knock') {
      a.vy -= p.gravity * dt; const r = this.move(a.vx * dt, a.vz * dt); if (this.hitWall) { a.vx *= -0.2; a.vz *= -0.2; }
      const g = r?.blocked ? this.gy : r?.y ?? r; this.gy = g; this.y += a.vy * dt;
      if (this.y <= g && a.vy < 0) { this.y = g; this.air = false; this.act = { k: 'lie', t: 0, face: a.face }; }
    } else {
      if (a.k === 'roll') { this.v = Math.max(1.5, this.v - 5 * dt); this.ph += this.v * dt * 2; if (a.t > 0.95) this.act = null; }
      else { this.v = 0; if (a.k === 'lie' && a.t > 0.8) this.act = { k: 'getup', t: 0, face: a.face }; else if (a.k === 'getup' && a.t > 1.5) this.act = null; }
      const r = this.move(-Math.sin(this.h) * this.v * dt, -Math.cos(this.h) * this.v * dt), g = r?.blocked ? this.y : r?.y ?? r;
      this.gy = g; this.ceil = r?.ceil ?? Infinity;
      if (g < this.y - 0.6) { this.air = true; this.vy = 0; this.top = this.y; this.act = null; } else this.y = g;   // rolled off an edge: falls again
    }
    this.sy += (this.y - this.sy) * (1 - Math.exp(-30 * dt)); return true;
  }
  /** half stride (m) of the walk cycle: grows with speed, 0 at rest (the feet then stand together); small steps when turning on the spot */
  get stride() { return Math.max(this.v < 0.05 ? 0 : (0.22 + 0.07 * this.v) * Math.min(1, this.v / 0.8), 0.1 * this.spin); }
  /** 0 idle .. 1 walk .. 2 run (pedmesh animation blend) */
  get gait() { const v = this.v; return v < this.w.speed ? v / this.w.speed : 1 + Math.min(1, (v - this.w.speed) / (this.w.run - this.w.speed)); }
  pose(a) { const q = this.prev, l = (u, w) => u + (w - u) * a; return { x: l(q.x, this.x), y: l(q.sy, this.sy), z: l(q.z, this.z), h: q.h + wrap(this.h - q.h) * a, ph: l(q.ph, this.ph), lean: l(q.lean, this.lean), fl: l(q.fl, this.fl) }; }
}
