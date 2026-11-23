// Third-person orbit camera (pure, no THREE): mouse / right stick turn yaw+pitch around the player or vehicle, wheel zooms,
// the boom is shortened against a solid-height function (ground + building walls, see camera/solid.js) and, in a vehicle,
// swings back behind it after `recenterDelay` s without look input. Config: data/controls.json "camera" + "mouse".
// Angles: yaw 0 = camera south of the target looking north (-z), same convention as the car heading (camera behind = yaw h).
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

export class OrbitCam {
  constructor(c, m) { this.c = c; this.m = m; this.yaw = this.yawT = 0; this.pitch = this.pitchT = c.pitch; this.zoom = this.zoomS = 1; this.idle = 0; this.cd = null; this.pv = null; this.out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }; }
  /** snap behind heading h (on spawn / entering a vehicle) */
  reset(h) { this.yaw = this.yawT = h; this.pitch = this.pitchT = this.c.pitch; this.pv = null; this.cd = null; this.ceilS = Infinity; }
  /**
   * dt s · look { dx, dy, wheel } (mouse pixels, wheel notches) · stick { x, y } (-1..1) ·
   * t { x, y, z, h, v, car, ceil } (target position, heading, speed, in a vehicle?, roof over it) ·
   * W { floor(x, z) -> floor height, wall(ax, az, bx, bz, r, y0, y1) -> a wall spanning part of (y0, y1) passes within r of segment a-b } (see boomWorld)
   */
  update(dt, look, stick, t, W) {
    const c = this.c, m = this.m, iy = m.invertY ? -1 : 1, padK = (m.padLook ?? 2.6) * dt;
    const turned = look.dx || look.dy || stick.x || stick.y;
    this.yawT -= look.dx * m.sensitivity + stick.x * padK;
    this.pitchT = Math.max(c.minPitch, Math.min(c.maxPitch, this.pitchT + (look.dy * m.sensitivity + stick.y * padK) * iy));
    this.idle = turned ? 0 : this.idle + dt;
    if (t.car && this.idle > c.recenterDelay && Math.abs(t.v) > c.recenterMinSpeed) {   // drift back behind the vehicle
      const k = ease(c.recenterRate, dt); this.yawT += wrap(t.h - this.yawT) * k; this.pitchT += (c.pitch - this.pitchT) * k;
    }
    if (c.lookSmoothing > 0) { const ls = ease(c.lookSmoothing, dt); this.yaw += (this.yawT - this.yaw) * ls; this.pitch += (this.pitchT - this.pitch) * ls; }
    else { this.yaw = this.yawT; this.pitch = this.pitchT; }
    if (look.wheel) this.zoom = Math.max(c.zoomMin, Math.min(c.zoomMax, this.zoom * Math.exp(look.wheel * m.wheelZoom)));
    this.zoomS += (this.zoom - this.zoomS) * ease(c.zoomSmoothing, dt);

    const roof = t.ceil - t.y > 1.2 ? t.ceil : Infinity, ceil = this.roof(dt, roof - 0.3);   // under a roof (car park, tunnel, bridge); one at the feet (overlapping tunnel lanes) is none
    const py = Math.min(ceil, t.y + (t.car ? c.pivotCar : c.pivotFoot));
    if (!this.pv) this.pv = { x: t.x, y: py, z: t.z };
    const f = ease(c.follow, dt), P = this.pv; P.x += (t.x - P.x) * f; P.y += (py - P.y) * f; P.z += (t.z - P.z) * f;

    const d = (t.car ? c.distCar : c.distFoot) * this.zoomS, cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = Math.cos(this.yaw) * cp, R = c.radius ?? 0.35, gm = c.groundMargin;
    // does the boom between s0 and s1 m hit something? the exact walls (within r of that piece of boom, r as wide as the near plane,
    // narrower near the head), the floor at s1, the roof. A segment per step, not a point: a wall between two samples is never missed
    const hit = (s0, s1) => { const y0 = P.y + dy * s0, y1 = P.y + dy * s1; if (Math.max(y0, y1) > ceil) return true;
      const x = P.x + dx * s1, z = P.z + dz * s1; if (y1 < W.floor(x, z) + gm) return true;
      return W.wall(P.x + dx * s0, P.z + dz * s0, x, z, Math.max(0.05, R * Math.min(1, s1 / 2)), Math.min(y0, y1) - 0.25, Math.max(y0, y1) + 0.25); };
    let free = d, edge = d;   // march in 0.25 m steps, then bisect the first hit: the free length varies continuously instead of in steps (no shimmer)
    for (let a = 0, s = 0.25; a < d; a = s, s += 0.25) {
      let b = Math.min(s, d); if (!hit(a, b)) continue;
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (hit(a, m)) b = m; else a = m; }
      edge = a; free = Math.max(c.minDist ?? 0.2, a - c.wallMargin); break;   // backed against a wall: nearly over the shoulder, never in the wall
    }
    if (this.cd === null) this.cd = free;
    if (free >= this.cd) this.cd += Math.min((free - this.cd) * ease(c.pushOut, dt), (c.pushSpeed ?? 10) * dt);   // out slowly (<= pushSpeed m/s) once the obstacle has gone
    else {   // in: quick but continuous (<= pullSpeed m/s) inside the wall margin; never left behind the wall itself (it would show through)
      this.cd -= Math.min((this.cd - free) * ease(c.pullIn, dt), (c.pullSpeed ?? 30) * dt);
      if (this.cd > edge) this.cd = free;
    }
    // floor: the terrain / layer under the camera only (a wall top there is not a floor: lifting onto it was the big jump onto the roofs)
    const o = this.out; o.x = P.x + dx * this.cd; o.z = P.z + dz * this.cd; const fl = W.floor(o.x, o.z); o.y = Math.min(ceil, Math.max(P.y + dy * this.cd, fl < Infinity ? fl + gm : -Infinity));
    o.tx = P.x; o.ty = P.y; o.tz = P.z;
    return o;
  }
  /** the roof over the target, eased down when one appears (driving under a bridge / into a tunnel: the camera, still outside, slides under it) */
  roof(dt, c) {
    if (!isFinite(c)) return (this.ceilS = Infinity);
    const from = Math.max(c, Math.min(this.ceilS ?? Infinity, this.out.y + 0.01));   // a roof appears: start from the camera's height
    return (this.ceilS = from + (c - from) * ease(12, dt));
  }
  /** world direction of a stick/WASD input relative to the camera: mx right, my forward -> [x, z] */
  moveDir(mx, my) { const s = Math.sin(this.yaw), co = Math.cos(this.yaw); return [-s * my + co * mx, -co * my - s * mx]; }
}

/** what the boom collides with around target t ({ x, y, z }) -> { floor, wall } for OrbitCam.update. In the open: the terrain as floor and
 *  the exact building walls (camera/solid.js, the same ones the movers collide with); below the terrain (car park, tunnel): the mover's
 *  own layer of sim/ground.js as floor, no floor within reach there = a wall. ground: sim/ground.js Ground · solid: Solid · o: FOOT */
export function boomWorld(ground, solid, t, o) {
  // both faces: a wall between the camera and the target hides it whichever way the face points (the movers' Solid.hits is one-sided)
  const wall = (ax, az, bx, bz, r, y0, y1) => solid.near((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + r, (g, k, ox, oz) =>
    g[k + 5] > y0 && g[k + 4] < y1 && segDist2(ax, az, bx, bz, g[k] + ox, g[k + 1] + oz, g[k + 2] + ox, g[k + 3] + oz) < r * r);
  if ((ground.terrain(t.x, t.z)?.y ?? -1e9) <= t.y + 1) return { floor: (x, z) => ground.terrain(x, z)?.y ?? -Infinity, wall };
  const at = (x, z) => ground.at(x, z, t.y + 0.5, o);
  return { floor: (x, z) => { const r = at(x, z); return r.blocked ? Infinity : r.y; }, wall };
}

/** squared distance between 2D segments a-b and c-d */
export function segDist2(ax, az, bx, bz, cx, cz, dx, dz) {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz, den = ux * vz - uz * vx;
  if (den !== 0) { const t = (vx * wz - vz * wx) / den, u = (ux * wz - uz * wx) / den; if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0; }   // crossing
  const pt = (px, pz, qx, qz, lx, lz) => { const L = lx * lx + lz * lz, t = L ? Math.max(0, Math.min(1, ((px - qx) * lx + (pz - qz) * lz) / L)) : 0, ex = qx + lx * t - px, ez = qz + lz * t - pz; return ex * ex + ez * ez; };
  return Math.min(pt(ax, az, cx, cz, vx, vz), pt(bx, bz, cx, cz, vx, vz), pt(cx, cz, ax, az, ux, uz), pt(dx, dz, ax, az, ux, uz));
}
