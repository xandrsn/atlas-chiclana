// Arcade car, fixed-step (data/v2.json physicsHz). Heading 0 = north (-z), positive = turning left. Building walls: the ground callback gets the heading too (sim/walls.js checks the body outline).
// Params: the legacy set { accel, brake, maxSpeed, reverse, turn, drag } (data/v2.json "car") or the catalogue set from
// sim/vehicles.js carParams(spec), which adds power (W/kg), wheelbase, steerMax/falloff, grip and a suspension (roll / pitch).
// Chassis: the 4 wheels sample the ground (pitch / roll on slopes, sprung), heave is ballistic off a crest or ramp taken fast (lands with a bounce).
import { G } from './physics.js';
import { startTumble, tumbleStep, right, liftOf } from './crash.js';
const NONE = { throttle: 0, steer: 0, brake: 0 };
const TOL = 2.4;   // m/s: the ground may fall away up to TOL * dt below the ballistic path in one step and the car still sticks to it
export class Car {
  // surf: the bare ground (no walls / cars) for the 4 wheel samples; play.js wraps this.ground, surf stays
  constructor(p, ground) { this.p = p; this.ground = this.surf = ground; this.x = 0; this.z = 0; this.y = 0; this.h = 0; this.v = 0; this.reset(); this.prev = null; this.save(); }
  reset() { this.roll = this.pitch = this.vr = this.vp = this.lat = this.vy = this.bob = this.vb = this.sx = this.sz = this.spin = 0; this.air = false; this.tum = null; this.lift = 0; this.wh = 0; this.st = 0; }
  // ground(x, z, yHint) -> height, or { y, blocked, ceil } from sim/ground.js (layered: decks, ramps, parkings). place() takes the top surface unless given a yHint.
  place(x, z, h = 0, yHint = Infinity) { this.x = x; this.z = z; this.h = h; this.v = 0; this.reset(); const g = this.ground(x, z, yHint); this.y = this.gy = g?.y ?? g; this.ceil = g?.ceil ?? Infinity; this.save(); }
  save() { this.prev = { x: this.x, y: this.y, z: this.z, h: this.h, roll: this.roll, pitch: this.pitch, bob: this.bob, lift: this.lift, wh: this.wh }; }
  /** a hit (wall, car, prop): this.onHit(car, { kind, dv (m/s lost / gained), px, pz (world contact), nx, nz (push on this body) }) set by sim/play.js */
  hit(e) { this.onHit?.(this, e); }
  /** roll over (w: roll rate, rad/s, + = left side up) or, for a bike, fall on its side */
  tumble(w) { if (!this.tum && !this.p.noRoll) this.tum = startTumble(w, this.roll); }
  /** put a rolled-over vehicle back on its wheels (key R) */
  unflip() { if (right(this.tum)) this.vy = 3; }
  /** ground height under the 4 wheels [front-left, front-right, rear-left, rear-right] (hint: the ground under the car now) */
  wheels() {
    const p = this.p, a = (p.wheelbase ?? 2.6) / 2, b = (p.halfW ?? 0.85) * 0.85, s = Math.sin(this.h), c = Math.cos(this.h);
    const at = (u, w) => { const g = this.surf(this.x - s * u + c * w, this.z - c * u - s * w, this.gy, this.h); return g?.y ?? g; };
    return [at(a, -b), at(a, b), at(-a, -b), at(-a, b)];
  }
  /** in: { throttle -1..1, steer -1..1, brake 0/1 } */
  step(dt, i) {
    this.save(); const p = this.p, v0 = this.v; if (this.tum) i = NONE;
    // keyboard steer is 0 / ±1: ease the wheel to it (full lock in ~0.3 s, back to centre faster) so taps don't snap the yaw and rock the body
    { const t = i.steer ?? 0, r = (t * this.st > 0 && Math.abs(t) > Math.abs(this.st) ? 3.5 : 6) * dt; this.st += Math.max(-r, Math.min(r, t - this.st)); i = { ...i, steer: this.st }; }
    let w = 0;
    if (!this.air) {   // in the air: no traction, no steering
      // engine: constant force at low speed, power-limited above it (W/kg over speed)
      const acc = p.power ? Math.min(p.accel, p.power / Math.max(1, Math.abs(this.v))) : p.accel;
      if (i.brake) this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), p.brake * dt);
      else if (i.throttle > 0) this.v += (this.v < 0 ? p.brake : acc) * i.throttle * dt;
      else if (i.throttle < 0) this.v -= (this.v > 0 ? p.brake : p.accel) * -i.throttle * dt;
      this.v -= this.v * p.drag * dt; this.v = Math.max(-p.reverse, Math.min(p.maxSpeed, this.v));
      if (p.wheelbase) {   // kinematic bicycle, steering angle shrinking with speed, yaw rate capped by the tyres (handbrake lets the rear slide: more yaw)
        const sp = Math.abs(this.v), d = i.steer * p.steerMax * (1 - p.falloff * Math.min(1, sp / p.maxSpeed)), cap = p.grip * 9.81 / Math.max(2, sp) * (i.brake ? 1.6 : 1);
        w = Math.max(-cap, Math.min(cap, this.v * Math.tan(d) / p.wheelbase));
      } else if (p.skid) w = i.steer * p.turn * (1 - 0.4 * Math.abs(this.v) / p.maxSpeed);   // tracks: turns on the spot
      else w = i.steer * p.turn * Math.max(-1, Math.min(1, this.v / 6));
      if (this.tum) this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), 6 * dt);   // sliding on the roof / side
    }
    // a knock (sim/physics.js collide): sideways slide and spin that the tyres scrub off
    const sl = Math.hypot(this.sx, this.sz), f = sl ? Math.max(0, sl - (this.air ? 0 : 9 * dt)) / sl : 0; this.sx *= f; this.sz *= f;
    this.spin *= this.air ? 1 : Math.max(0, 1 - 3 * dt);
    if (!this.tum && !this.air && !p.skid) {   // tyres trip on a hard sideways slide, or a hard turn of a tall body: it rolls
      const side = -this.sx * Math.cos(this.h) + this.sz * Math.sin(this.h);
      if (Math.abs(side) > 6.5) this.tumble(-Math.sign(side) * Math.min(11, 5 + Math.abs(side) * 0.5));
      else if (!p.lean && p.comH && Math.abs(this.lat) > 1.9 * 9.81 * (p.track ?? 1.5) / 2 / p.comH && Math.abs(this.v) > 14) this.tumble(Math.sign(this.lat) * 7);
    }
    this.h += (w + this.spin) * dt; this.lat = w * this.v;
    this.x += -Math.sin(this.h) * this.v * dt + this.sx * dt; this.z += -Math.cos(this.h) * this.v * dt + this.sz * dt;
    const g = this.ground(this.x, this.z, this.gy, this.h);
    // wall, building, pillar, parapet, parked car: back to the last free pose, small bounce (unless that pose is blocked too, e.g. after a
    // model change next to a wall: then it may drive out)
    let wh = null;
    if (g?.blocked && !this.ground(this.prev.x, this.prev.z, this.gy, this.prev.h)?.blocked) { this.x = this.prev.x; this.z = this.prev.z; this.h = this.prev.h; const dir = Math.sign(this.v) || 1, fx = -Math.sin(this.h) * dir, fz = -Math.cos(this.h) * dir, hl = p.halfL ?? 2.2, sp = Math.hypot(this.v, this.sx, this.sz);
    this.v *= -0.2; this.sx = this.sz = this.spin = 0;
    if (sp > 1.5) { this.hit({ kind: 'wall', dv: sp * 1.2, px: this.x + fx * hl, pz: this.z + fz * hl, nx: -fx, nz: -fz }); if (p.lean && sp > 7 && !this.tum) this.tumble((Math.random() < 0.5 ? -1 : 1) * 3); } }
    else {
      this.gy = g?.y ?? g; this.ceil = g?.ceil ?? Infinity;
      if (p.k || p.wheelbase) wh = this.wheels();
    }
    // chassis heave: ballistic between contacts; on the road it rides the higher of the centre and the 4 wheels' mean (a dip is bridged)
    const gc = wh ? Math.max(this.gy, (wh[0] + wh[1] + wh[2] + wh[3]) / 4) : this.gy, wb = p.wheelbase ?? 2.6, grade = wh ? (wh[0] + wh[1] - wh[2] - wh[3]) / 2 / wb : 0;
    this.vy -= G * dt; let y = this.y + this.vy * dt;
    if (!this.air && y < gc + TOL * dt) { y = gc; this.vy = this.v * grade; }   // stuck to the road (vy: the road's own climb rate)
    else if (y <= gc) {   // landing: never below the ground; a hard one bounces and squashes the springs
      const hit = -this.vy; y = gc; this.vb -= hit * 0.5;
      if (hit > 4) this.hit({ kind: 'land', dv: hit, px: this.x, pz: this.z, nx: 0, nz: 0 });
      if (hit > 7 && Math.abs(this.roll) > 0.3) this.tumble(Math.sign(this.roll) * -(4 + hit * 0.3));
      if (hit > 3) this.vy = hit * 0.25; else { this.vy = this.v * grade; this.air = false; }
    } else this.air = true;
    this.y = y;
    const k = p.k || 90, c = p.c || 12;
    this.vb += (-this.bob * k - this.vb * c) * dt; this.bob = Math.max(-0.12, Math.min(0.12, this.bob + this.vb * dt));
    // terrain attitude from the wheels (nose up = negative pitch, left side up = positive roll), plus the load transfer on the springs
    const tp = wh && !this.air ? -Math.atan(grade) : null, tr = wh && !this.air && !p.lean ? Math.atan((wh[0] + wh[2] - wh[1] - wh[3]) / 2 / (2 * (p.halfW ?? 0.85) * 0.85)) : 0;
    if (p.k) {   // damped spring towards terrain + load transfer (body roll out of the turn, squat / dive); bikes lean into the turn
      const ax = (this.v - v0) / dt, lr = p.lean ? -Math.min(0.6, Math.max(-0.6, Math.atan(this.lat / 9.81))) : Math.max(-0.12, Math.min(0.12, this.lat * p.rollK)), lp = Math.max(-0.08, Math.min(0.08, -ax * p.pitchK));
      if (this.air) this.vp += 0.6 * dt;   // airborne: no spring, the nose drops slowly
      else { this.vr += ((tr + lr - this.roll) * p.k - this.vr * Math.max(p.c, 1.6 * Math.sqrt(p.k))) * dt;   // roll near critically damped: no side-to-side rocking after a turn
        this.vp += ((tp + lp - this.pitch) * p.k - this.vp * p.c) * dt; }
      this.roll += this.vr * dt; this.pitch += this.vp * dt;
    } else if (tp != null) { this.pitch = tp; this.roll = tr; }
    if (p.lean) { const want = !this.air && !this.tum && i.throttle > 0.9 && !i.brake && this.v > 0.5 && this.v < 11 && p.accel > 6 ? 1 : 0; this.wh += (want - this.wh) * Math.min(1, (want ? 2.2 : 3.5) * dt); }   // wheelie on a hard pull away
    if (this.tum) {
      const t = this.tum; tumbleStep(t, dt, p.lean); this.roll = t.a; this.vr = 0; this.lift = liftOf(t.a, p.halfW ?? 0.85, p.height ?? 1.4);
      if (t.done) { this.tum = null; this.roll = this.lift = 0; }
    }
  }
  /** interpolated render pose between the last two physics steps */
  pose(a) {
    const q = this.prev, l = (u, w) => u + (w - u) * a, wh = l(q.wh, this.wh), th = 0.6 * wh, L = (this.p.wheelbase ?? 2) / 2, back = L * (1 - Math.cos(th)), h = l(q.h, this.h);   // wheelie: nose up about the rear wheel
    return { x: l(q.x, this.x) + Math.sin(h) * back, y: l(q.y, this.y) + l(q.bob, this.bob) + l(q.lift, this.lift) + L * Math.sin(th), z: l(q.z, this.z) + Math.cos(h) * back, h, roll: l(q.roll, this.roll), pitch: l(q.pitch, this.pitch) - th };
  }
}

/** one fixed step of a Car / Heli in substeps of < 0.5 m (the wall test samples a 1 m grid: sim/walls.js), interpolating over the whole step */
export function substep(s, h, i) {
  const n = Math.min(12, Math.max(1, Math.ceil(Math.abs(s.v) * h / 0.5))); let pv = null;
  for (let k = 0; k < n; k++) { s.step(h / n, i); pv ??= s.prev; }
  s.prev = pv; return n;
}

/** fixed-step driver: accumulates real time and runs whole steps; returns the interpolation factor */
export function fixedStep(hz) {
  const h = 1 / hz; let acc = 0;
  return (dt, step) => { acc += Math.min(dt, 0.25); let n = 0; while (acc >= h && n < 8) { step(h); acc -= h; n++; } if (n === 8) acc = 0; return acc / h; };
}
