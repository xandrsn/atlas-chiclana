// Arcade helicopter, fixed-step like the car (same interface for sim/play.js: place, step, pose, x/y/z/h/v). Heading 0 = north (-z).
// Controls: throttle = nose down and fly forward / back, steer = yaw, up / down = collective (Space / Shift). Hover is free (no stall,
// no torque); unoccupied it settles to the ground. ground(x, z, y) -> terrain height (number or { y }); wall(x, z) -> top of a building
// wall there (camera/solid.js), flying into one stops you. Shortcut: lands on the terrain only (roofs are not floors), upgrade with Phase 5.
export class Heli {
  constructor(p, ground, wall = () => -Infinity) { this.p = p; this.ground = ground; this.wall = wall; this.x = this.z = this.y = this.h = this.v = this.vy = 0; this.rotor = 0; this.spin = 0; this.roll = this.pitch = 0; this.landed = true; this.prev = null; this.save(); }
  place(x, z, h = 0) { this.x = x; this.z = z; this.h = h; this.v = this.vy = 0; const g = this.ground(x, z, Infinity); this.y = g?.y ?? g; this.landed = true; this.save(); }
  save() { this.prev = { x: this.x, y: this.y, z: this.z, h: this.h, roll: this.roll, pitch: this.pitch, spin: this.spin }; }
  get gy() { const g = this.ground(this.x, this.z, this.y + 0.5); return g?.y ?? g; }
  /** in: { throttle -1..1, steer -1..1, up 0/1, down 0/1, on (engine running: someone inside) } */
  step(dt, i) {
    this.save(); const p = this.p;
    this.rotor += ((i.on ? 1 : 0) - this.rotor) * Math.min(1, dt * (i.on ? 0.8 : 0.4));   // spool up / down
    this.spin += this.rotor * 28 * dt;
    const lift = this.rotor > 0.85, up = lift ? (i.up ? 1 : 0) - (i.down ? 1 : 0) : -1;
    this.vy += (up * p.climb - this.vy) * Math.min(1, dt * 2.5);
    if (lift && !this.landed) { this.v = Math.max(-p.maxSpeed * 0.4, Math.min(p.maxSpeed, this.v + (i.throttle * p.accel - this.v * p.drag * 0.85) * dt)); this.h += i.steer * p.yawRate * dt; }   // 0.85: the top speed is reached, not approached forever
    else this.v -= this.v * Math.min(1, dt * 3);   // on the ground: skids, no taxiing
    this.x -= Math.sin(this.h) * this.v * dt; this.z -= Math.cos(this.h) * this.v * dt; this.y += this.vy * dt;
    if (this.y < this.wall(this.x, this.z)) { this.x = this.prev.x; this.z = this.prev.z; this.v = 0; }   // building wall
    const g = this.ground(this.x, this.z, this.y + 0.5), gy = g?.y ?? g;
    if (this.y <= gy) { this.y = gy; if (this.vy < 0) this.vy = 0; this.landed = true; } else if (this.y > gy + 0.3) this.landed = false;
    this.y = Math.min(this.y, gy + p.ceiling);
    const ease = Math.min(1, dt * 3), air = this.landed ? 0 : 1;   // visual attitude: nose down when pushing forward, bank into the yaw
    this.pitch += (air * (i.throttle * 0.18 + this.v * 0.002) - this.pitch) * ease; this.roll += (air * -i.steer * 0.22 - this.roll) * ease;
  }
  pose(a) { const q = this.prev, l = (u, w) => u + (w - u) * a; return { x: l(q.x, this.x), y: l(q.y, this.y), z: l(q.z, this.z), h: l(q.h, this.h), roll: l(q.roll, this.roll), pitch: l(q.pitch, this.pitch), spin: l(q.spin, this.spin) }; }
}
