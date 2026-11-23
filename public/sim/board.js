// Getting into / out of the player's own road vehicle as a short animated sequence (instead of the instant swap):
//  car (a door piece, vehicles/door.js): walk to the driver's door, open it (it turns on its front hinge), turn and sit down sideways,
//  swing the legs in, close it; getting out is the same backwards (open, swing out and stand, close from outside).
//  bike / scooter: walk to its left side, swing the right leg over the seat, sit; getting off the same backwards. The rider stays visible.
// The protagonist is posed in the vehicle's model frame (x + = left, y up, z forward) through the vehicle mesh's world matrix, so the
// seated body follows the car's pitch / roll / bike lean. Other vehicles (tram, helicopter, convertibles, vans) keep the instant swap.
import * as THREE from 'three';
import { ss } from '../peds/rig.js';

const OPEN = 1.15, lerp = (a, b, t) => a + (b - a) * t, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

/** seat of a bike spec in its model frame (vehicles/carmesh.js bike(): scooter seat over the rear body, motorbike seat behind the tank) */
export function bikeSeat(spec) {
  const r = spec.dims.wheelRadius, z = spec.dims.wheelbase / 2;
  return spec.body?.scooter ? { x: 0, y: r + 0.47, z: -z + 0.22 } : { x: 0, y: r + 0.5, z: -z * 0.45 };
}

export class Board {
  constructor(player, avatar) { this.pl = player; this.av = avatar; this.seq = null; this.door = null; this.frameD = null; this.ang = 0; }
  get busy() { return !!this.seq; }
  /** the current car's door piece (vehicles/door.js cutDoor result + its mesh) or null */
  setDoor(mesh, cut) { this.door = mesh; this.frameD = cut?.frame ?? null; this.ang = 0; if (mesh) mesh.rotation.y = 0; }
  kind(v) { return v.kind !== 'car' ? null : v.spec.kind === 'bike' ? 'bike' : this.frameD && v.spec.kind === 'car' ? 'car' : null; }
  /** start getting in (true) or leave it to the instant swap (false) */
  in(v, done) {
    const k = this.kind(v); if (!k || Math.abs(v.sim.v) > 1 || this.seq) return false;
    this.seq = { dir: 1, k, v, ph: 'walk', t: 0, sp: this.spot(k, v), done }; return true;
  }
  /** start getting out (true) when the side is free, else false (play.js tries its other spots) */
  out(v, done) {
    const k = this.kind(v); if (!k || this.seq) return false;
    const sp = this.spot(k, v), s = v.sim, c = Math.cos(s.h), n = Math.sin(s.h), x = s.x - c * sp[0] - n * sp[1], z = s.z + n * sp[0] - c * sp[1];   // model (x left, z fwd) -> world
    if (this.pl.ground(x, z, s.y)?.blocked) return false;
    this.seq = { dir: -1, k, v, ph: k === 'car' ? 'open' : 'seat', t: 0, sp, done, wx: x, wz: z };
    this.pl.place(x, z, wrap(s.h - (k === 'car' ? Math.PI / 2 : 0)), s.y); return true;   // the walker (camera focus) waits at the spot, facing the car / forward
  }
  /** where the walker stands, model frame [x, z]: by the driver's door / on the bike's left */
  spot(k, v) { return k === 'car' ? [this.frameD.hw + 0.5, this.frameD.seat.z - 0.05] : [0.85, bikeSeat(v.spec).z]; }
  /** fixed step: -> the walker input while walking to the door, null while posed by the sequence (player.step not called) */
  step(h) {
    const q = this.seq; if (!q) return undefined; q.t += h;
    const s = q.v.sim, pl = this.pl;
    if (q.ph === 'walk') {
      const c = Math.cos(s.h), n = Math.sin(s.h), x = s.x - c * q.sp[0] - n * q.sp[1], z = s.z + n * q.sp[0] - c * q.sp[1], dx = x - pl.x, dz = z - pl.z, d = Math.hypot(dx, dz);
      if (d < 0.12 || q.t > 4 || Math.abs(s.v) > 1.5) { q.ph = Math.abs(s.v) > 1.5 ? 'abort' : q.k === 'car' ? 'open' : 'seat'; q.t = 0; q.wx = pl.x; q.wz = pl.z; q.wh = pl.h; if (q.ph === 'abort') this.seq = null; return null; }
      const m = Math.min(1, d / 0.6) * 0.75; return { dx: dx / d * m, dz: dz / d * m, run: 0, jump: 0 };
    }
    const L = { open: 0.5, seat: q.k === 'car' ? 1.1 : 1.0, close: 0.45 }[q.ph];
    if (q.t >= L) {
      q.t = 0; const order = q.dir > 0 ? (q.k === 'car' ? ['open', 'seat', 'close'] : ['seat']) : (q.k === 'car' ? ['open', 'seat', 'close'] : ['seat']);
      const i = order.indexOf(q.ph);
      if (i < order.length - 1) q.ph = order[i + 1];
      else { this.seq = null; q.done(); }
    }
    return null;
  }
  /** per frame: pose the protagonist in the vehicle frame (sequence, or riding a bike). vMesh: the vehicle's mesh. -> [key, fade] or null */
  frame(dt, inV, vMesh) {
    const q = this.seq, r = this.av.rig, T = this.av.anim.T, F = this.frameD, mesh = this.av.mesh;
    let key = null, fade = 0.25, x, y, z, yaw, door = 0;
    if (q && q.ph !== 'walk') {
      const u = Math.min(1, q.t / ({ open: 0.5, seat: q.k === 'car' ? 1.1 : 1.0, close: 0.45 }[q.ph])), w = q.dir > 0 ? u : 1 - u, [sx, sz] = q.sp;
      if (q.k === 'car') {
        const seat = F.seat, oy = seat.y - 0.07;
        if (q.ph === 'open') {   // in: standing at the door, right hand pulls it open; out: seated, left hand pushes it open
          door = OPEN * ss(0.15, 1, u);
          if (q.dir > 0) { [x, y, z, yaw] = this.from(q, vMesh, sx, sz, -Math.PI / 2, ss(0, 0.6, u)); T.set(r.key('reach')); key = 'reach'; }
          else { x = seat.x; y = oy; z = seat.z; yaw = 0; T.set(r.key('carClose')); key = 'carClose'; }
        } else if (q.ph === 'seat') {   // w 0 standing outside facing the car .. 1 seated facing forward
          door = OPEN;
          yaw = w < 0.3 ? lerp(-Math.PI / 2, Math.PI / 2, ss(0, 0.3, w)) : lerp(Math.PI / 2, 0, ss(0.62, 1, w));   // turn the back to the seat, sit, swing the legs in
          x = lerp(sx, seat.x + 0.08, ss(0.22, 0.6, w)) - 0.08 * ss(0.62, 1, w); y = lerp(0, oy, ss(0.3, 0.62, w)); z = lerp(sz, seat.z, ss(0.2, 0.6, w));
          r.seq(T, [[0, r.key('stand')], [0.3, r.key('stand')], [0.62, r.key('car')], [1, r.key('car')]], w); key = 'seat'; fade = 0.15;
        } else {   // close: in: seated, left hand pulls it shut; out: standing outside, pushes it shut
          door = OPEN * (1 - ss(0, 0.85, u));
          if (q.dir > 0) { x = seat.x; y = oy; z = seat.z; yaw = 0; T.set(r.key('carClose')); key = 'carClose'; }
          else { x = sx; y = 0; z = sz; yaw = -Math.PI / 2; T.set(r.key('reach')); key = 'reach'; }
        }
      } else {   // bike: w 0 standing on its left side facing forward .. 1 seated
        const b = bikeSeat(q.v.spec);
        [x, , z, yaw] = q.dir > 0 && u < 0.35 ? this.from(q, vMesh, sx, sz, 0, ss(0, 0.35, u)) : [sx, 0, sz, 0];
        x = lerp(x, b.x, ss(0.4, 0.9, w)); y = lerp(0, b.y, ss(0.45, 0.95, w)); z = lerp(z, b.z, ss(0.4, 0.9, w));
        r.seq(T, [[0, r.key('stand')], [0.15, r.key('stand')], [0.5, r.key('mount')], [1, r.key('bike')]], w); key = 'mount'; fade = 0.15;
      }
    } else if (!q && inV && this.kind(inV) === 'bike') {   // riding: seated, hands on the bars
      const b = bikeSeat(inV.spec); x = b.x; y = b.y; z = b.z; yaw = 0; T.set(r.key('bike')); key = 'bike';
    }
    if (this.door) { this.ang += (door - this.ang) * Math.min(1, dt * 30); this.door.rotation.y = -this.ang; }
    if (key === null) return null;
    vMesh.updateMatrixWorld(); _l.compose(_v.set(x, y, z), _q.setFromAxisAngle(_y, yaw), _s.set(1, 1, 1));
    _m.multiplyMatrices(vMesh.matrixWorld, _l).decompose(mesh.position, mesh.quaternion, _s);
    return [key, fade];
  }
  /** the walker's own spot / heading at the end of the walk eased onto the door spot (model frame): -> [x, 0, z, yaw] */
  from(q, vMesh, sx, sz, yaw, t) {
    vMesh.updateMatrixWorld(); _v.set(q.wx, q.v.sim.y, q.wz).applyMatrix4(_m.copy(vMesh.matrixWorld).invert());
    const y0 = wrap(q.wh - q.v.sim.h);   // walker heading in the car frame
    return [lerp(_v.x, sx, t), 0, lerp(_v.z, sz, t), y0 + wrap(yaw - y0) * t];
  }
}
