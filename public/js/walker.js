import * as THREE from 'three';
import { wallNormal } from './collide.js';

const JUMP = 11;   // m/s: 2.75 m per jump, 5.5 m with the double jump (still reaches a one-storey roof at 4.5 m); 16 made houses feel like toys
const NOPAD ={ thr: 0, steer: 0, f: 0, s: 0, yaw: 0, up: 0 };

// On-foot mode: procedural low-poly person with walk/run cycle. Same interface as Car/Heli (pos, psi, velocityKmh, group, place, update).
// Forward = (-sin psi, -cos psi). A/D turn, Q/E strafe, Shift sprint, Space jump. Collides with buildings; ground follows world.surf (roads, bridges, terrain).
const mat = c => new THREE.MeshLambertMaterial({ color: c });
function part(w, h, d, m, x, y, z) { const g = new THREE.BoxGeometry(w, h, d), me = new THREE.Mesh(g, m); me.position.set(x, y, z); return me; }
function limb(w, h, d, m, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); const me = part(w, h, d, m, 0, -h / 2, 0); p.add(me); return p; }   // pivot at the top

export class Walker {
  constructor(world) {
    this.world = world; this.group = new THREE.Group(); this.model = new THREE.Group(); this.group.add(this.model);
    this.pos = new THREE.Vector3(); this.psi = 0; this.vy = 0; this.jumps = 0; this.speed = 0; this.velocityKmh = 0; this.air = false; this.phase = 0; this.fp = false;
    this.vx = 0; this.vz = 0; this.jbuf = 0; this.airT = 0; this._n = [0, 0];
    const skin = mat(0xe0ac84), shirt = mat(0x2f6fb0), pants = mat(0x2b2f3a), shoe = mat(0x1a1a1a), hair = mat(0x3a2a1c);
    this.legs = [limb(0.17, 0.85, 0.2, pants, -0.12, 0.9, 0), limb(0.17, 0.85, 0.2, pants, 0.12, 0.9, 0)];
    this.arms = [limb(0.12, 0.62, 0.14, shirt, -0.3, 1.5, 0), limb(0.12, 0.62, 0.14, shirt, 0.3, 1.5, 0)];
    for (const l of this.legs) l.children[0].add(part(0.19, 0.1, 0.3, shoe, 0, -0.4, -0.04));
    for (const a of this.arms) a.children[0].add(part(0.11, 0.12, 0.13, skin, 0, -0.34, 0));
    this.body = new THREE.Group(); this.body.add(part(0.52, 0.66, 0.28, shirt, 0, 1.2, 0), part(0.52, 0.2, 0.28, pants, 0, 0.9, 0), part(0.22, 0.24, 0.24, skin, 0, 1.68, 0), part(0.24, 0.09, 0.26, hair, 0, 1.82, 0.01), ...this.legs, ...this.arms);
    this.model.add(this.body);
  }
  place(x, z, psi) { this.pos.set(x, this.world.surf(x, z, null, true), z); this.psi = psi ?? this.psi; this.vy = 0; this.vx = this.vz = 0; this.speed = 0; this.air = false; this.jumps = 0; this.sync(); }
  blocked(x, z, y) {
    const b = this.world.buildings; if (!b) return false;
    if (!(b.hit(x, z, y + 0.3) || b.hit(x + 0.3, z, y + 0.3) || b.hit(x - 0.3, z, y + 0.3) || b.hit(x, z + 0.3, y + 0.3) || b.hit(x, z - 0.3, y + 0.3))) return false;
    // Catastro footprints sometimes overlap the OSM street axis: a pedestrian standing on a street / footway at ground level is never "inside a building"
    const w = this.world; return !(y - w.hf.height(x, z) < 1.2 && (w.roads?.walkway?.(x, z, -0.3) || w.roads?.road?.(x, z, y, -0.3)));
  }
  /** highest rise (m) the feet may step up onto (x,z): 0.6 normally, 1.0 onto a road / footbridge deck end (abutments often sit up to a metre above the bank) */
  stepLim(x, z, y) { return this.air ? 0.3 : this.world.roads?.road?.(x, z, y + 0.9, 0.2, true) ? 1.0 : 0.6; }
  /** walkable height under (x,z) for a body at height y: road / footbridge / terrain, or a rooftop no more than 0.6 m above the feet */
  groundAt(x, z, y) {
    let g = this.world.surf(x, z, y, true);
    const rt = this.world.buildings?.topAt?.(x, z, y + 0.6); if (rt > g) g = rt;
    return g;
  }
  /** One fixed physics step. Velocity-based: accelerates / brakes on the ground, little control in the air, slides along walls by their normal,
   *  climbs kerbs and steps up to 0.6 m smoothly, treats anything higher as a wall (jump onto it), coyote time + jump buffering, double jump. */
  update(dt, k) {
    const pad = k.pad || NOPAD, c1 = v => v < -1 ? -1 : v > 1 ? 1 : v;
    const turn = c1((k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) + pad.yaw), fwd = c1((k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + pad.f), str = c1(pad.s), run = k.ShiftLeft || k.ShiftRight;
    this.psi += turn * dt * 2.4;
    const wl = this.world.waterLevel ? this.world.waterLevel(this.pos.x, this.pos.z) : -Infinity, wd = wl - this.groundAt(this.pos.x, this.pos.z, this.pos.y), swim = wd > 1.35 && this.pos.y < wl + 0.2 && !(this.air && this.vy > 0.5), wet = wd > 0.2 && this.pos.y < wl;   // wading slows you down, deep water makes you swim
    const vmax = (run ? 8 : 3) *(swim ? (run ? 0.3 : 0.45) : wet ? 1 - Math.min(0.5, wd * 0.35) : 1), ax = -Math.sin(this.psi), az = -Math.cos(this.psi), rx = -az, rz = ax;
    let wx = ax * fwd + rx * str, wz = az * fwd + rz * str; const l = Math.hypot(wx, wz), mag = Math.min(1, l);
    if (l > 0) { wx /= l; wz /= l; }
    const target = mag * (fwd < 0 ? vmax * 0.5 : vmax), kk = 1 - Math.exp(-dt * (this.air ? 2.2 : l > 0 ? 10 : 14));
    this.vx += (wx * target - this.vx) * kk; this.vz += (wz * target - this.vz) * kk;
    const b = this.world.buildings, y = this.pos.y, hit = b ? (x, z, yy) => b.hit(x, z, yy) : null;
    const sp = Math.hypot(this.vx, this.vz), nst = Math.max(1, Math.ceil(sp * dt / 0.25));   // sub-steps so fast movement cannot tunnel through thin props
    for (let i = 0; i < nst; i++) {
      const mx = this.vx * dt / nst, mz = this.vz * dt / nst, nx = this.pos.x + mx, nz = this.pos.z + mz;
      if (this.blocked(this.pos.x, this.pos.z, y)) {   // already inside a solid (spawned there): eject towards free space; walk freely only when completely enclosed
        const n = hit ? wallNormal(hit, this.pos.x, this.pos.z, y + 0.3, 0.6, this._n) : null;
        if (n) { const vn = this.vx * n[0] + this.vz * n[1]; if (vn < 0) { this.vx -= vn * n[0]; this.vz -= vn * n[1]; } this.pos.x += (this.vx + n[0] * 3) * dt / nst; this.pos.z += (this.vz + n[1] * 3) * dt / nst; }
        else { this.pos.x = nx; this.pos.z = nz; }
        continue;
      }
      const wall = this.blocked(nx, nz, y), ledge = !wall && this.groundAt(nx, nz, y) - y > this.stepLim(nx, nz, y);
      if (!wall && !ledge) { this.pos.x = nx; this.pos.z = nz; continue; }
      // blocked: cancel the velocity into the obstacle and slide along it
      let n = wall && hit ? wallNormal(hit, nx, nz, y + 0.3, 0.45, this._n) : null;
      if (!n) { const s = Math.hypot(mx, mz) || 1; n = this._n; n[0] = -mx / s; n[1] = -mz / s; }   // ledge / enclosed: push straight back
      const vn = this.vx * n[0] + this.vz * n[1]; if (vn < 0) { this.vx -= vn * n[0]; this.vz -= vn * n[1]; }
      const sx = this.pos.x + this.vx * dt / nst, sz = this.pos.z + this.vz * dt / nst;
      if (!this.blocked(sx, sz, y) && this.groundAt(sx, sz, y) - y <= this.stepLim(sx, sz, y)) { this.pos.x = sx; this.pos.z = sz; } else { this.vx = this.vz = 0; break; }
    }
    { const col = this.world.roads?.col, h = col && col.resolve(this.pos.x, this.pos.z, 0.22, 0.5, this.pos.y);   // parapets, walls, trunks, traffic
      if (h && !this.blocked(h.x, h.z, y)) { this.pos.x = h.x; this.pos.z = h.z; const vn = this.vx * h.nx + this.vz * h.nz; if (vn < 0) { this.vx -= vn * h.nx; this.vz -= vn * h.nz; } } }
    this.speed = Math.hypot(this.vx, this.vz);
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (k.Space) { this.jbuf = 0.14; k.Space = false; } else if (this.jbuf > 0) this.jbuf -= dt;      // jump buffering: a press just before landing still counts
    if (swim) { this.air = false; this.jumps = 0; this.vy = 0; this.pos.y += (wl - 1.1 - this.pos.y) * Math.min(1, dt * 5); if (this.jbuf > 0) { this.vy = 9; this.air = true; this.airT = 1; this.jumps = 1; this.jbuf = 0; } }   // float at the surface; Space hops out onto a bank
    else if (this.air) {
      this.airT += dt;
      if (this.jbuf > 0) {
        if (this.jumps === 0 && this.airT < 0.12) { this.vy = JUMP; this.jumps = 1; this.jbuf = 0; }        // coyote time: just walked off an edge
        else if (this.jumps < 2) { this.vy = JUMP; this.jumps = 2; this.jbuf = 0; }                        // double jump
      }
      this.vy -= 22 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= g && this.vy <= 0) { this.pos.y = g; this.vy = 0; this.air = false; this.jumps = 0; }
    } else {
      this.jumps = 0;
      if (g - this.pos.y > 1.0) this.pos.y = g;                                 // the ground itself rose (e.g. a place was just built under us)
      else this.pos.y += (g - this.pos.y) * Math.min(1, dt * 18);               // kerbs, steps, slopes
      if (this.pos.y - g > 0.5) { this.air = true; this.airT = 0; this.vy = 0; }   // walked off an edge
      if (this.jbuf > 0) { this.vy = JUMP; this.air = true; this.airT = 1; this.jumps = 1; this.jbuf = 0; }
    }
    this.velocityKmh = this.speed * 3.6;
    this.phase += dt * (3 + this.speed * 1.6);
    const sw = Math.min(1, this.speed / 5) * (run ? 0.95 : 0.55) + (this.speed > 0.2 ? 0.1 : 0), s = Math.sin(this.phase) * sw * (this.air ? 0.3 : 1);
    this.legs[0].rotation.x = s; this.legs[1].rotation.x = -s; this.arms[0].rotation.x = -s * 0.9; this.arms[1].rotation.x = s * 0.9;
    this.body.position.y = this.air ? 0 : Math.abs(Math.cos(this.phase)) * 0.05 * Math.min(1, this.speed / 3);
    this.body.rotation.x = -Math.min(0.25, this.speed * 0.03);
    this.sync();
  }
  sync() { this.group.position.copy(this.pos); this.model.rotation.y = this.psi; this.model.visible = !this.fp; }
}
