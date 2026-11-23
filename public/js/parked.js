import { Fleet, VEHICLES, randomType } from './vehicles.js';

// Parked vehicles: street-side cars / vans / motos generated deterministically along the OSM roads (per 512 m cell, probability by vehicle type),
// helicopters on football pitches, plus whatever the player left behind (`drop`). Everything is drawn as one instanced call per type.
// The player can climb into any of them (main.js `interact`): `take` removes it from the world, `drop` puts one back.
const PAL = [0xf2f2f0, 0xd9d9d9, 0x8a8f96, 0x2a2d31, 0xb5251c, 0x1f4f8f, 0xe8d9a8, 0x3f5b45, 0x6b6e73, 0x7b1f1f, 0x2d6a9f];
const hash = (a, b = 0) => { let h = Math.imul((a * 73856093) ^ (b * 19349663), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const R_VIS = 190, R_HELI = 700, R_DYN = 60, CELL = 512;

export class Parked {
  constructor(scene, world, footballItems = []) {
    this.w = world; this.fleets = VEHICLES.map((_, i) => new Fleet(scene, i, 40)); this.heliFleet = new Fleet(scene, 'heli', 8);
    this.cells = new Map(); this.taken = new Set(); this.dropped = []; this.vis = []; this.dyn = []; this.helis = []; this.t = 9; this.dirty = true; this.n = 0;
    // helicopters: every third real pitch (>= 60 m long), at the centre circle, nose along the pitch
    let k = 0;
    for (const f of footballItems) {
      if (!(f.L >= 60) || f.kind === 'stadium' || hash(f.x, f.z) > 0.45) continue;   // never in a stadium (Bernabéu: a heli on the match pitch)
      const x = f.ox ?? f.x, z = f.oz ?? f.z; this.helis.push({ id: 'h' + k++, kind: 'heli', x, z, y: world.surf(x, z, null) + 0.1, psi: Math.atan2(-Math.cos(f.ang || 0), -Math.sin(f.ang || 0)) + (hash(x, z) < 0.5 ? 0 : Math.PI), color: [0xd9482b, 0xe8e8e8, 0x1f4f8f, 0xf2b84b][(hash(z, x) * 4) | 0] });
      if (this.helis.length >= 12) break;
    }
  }
  /** slots of one 512 m cell (cached) */
  slots(key) {
    let L = this.cells.get(key); if (L) return L; L = []; this.cells.set(key, L);
    const W = this.w.roads, c = W?.cells.get(key); if (!c) return L;
    for (const [r, i0, i1] of c.runs) {
      if (!r.drive || r.w < 4.4 || r.bridge || r.rb || /motorway|trunk|primary|track|footway|path|cycleway|steps|pedestrian/.test(r.cls) || r.u) continue;
      const pr = (r.tier === 1 ? 0.3 : r.tier === 0 ? 0.18 : 0.05);
      for (let i = i0 + 3; i < i1 - 3 && i < r.n - 4; i += 4 + ((hash(i, r.P[0] | 0) * 5) | 0)) {
        const h = hash((r.P[2 * i] * 10) | 0, (r.P[2 * i + 1] * 10) | 0); if (h > pr) continue;
        const tx0 = r.P[2 * i + 2] - r.P[2 * i], tz0 = r.P[2 * i + 3] - r.P[2 * i + 1], l = Math.hypot(tx0, tz0) || 1, tx = tx0 / l, tz = tz0 / l;
        const side = hash(i, 7) < 0.5 ? 1 : -1, off = side * Math.max(1.2, r.w / 2 - 1.05), x = r.P[2 * i] - tz * off, z = r.P[2 * i + 1] + tx * off;   // right-hand normal = (-tz, tx)
        const y = this.w.surf(x, z, null); if (this.w.buildings?.hit(x, z, y + 0.8)) continue;
        if (L.some(q => Math.hypot(q.x - x, q.z - z) < 5.5)) continue;
        const type = randomType(hash(i, 3)), moto = VEHICLES[type].bike;
        L.push({ id: key + ':' + L.length, kind: 'car', type, x, z, y, psi: side > 0 ? Math.atan2(-tx, -tz) : Math.atan2(tx, tz), color: PAL[(hash(i, 5) * PAL.length) | 0], moto });
      }
    }
    return L;
  }
  /** nearest enterable vehicle to a point: cars within rCar, helicopters within rHeli (the rotor disc is big) */
  nearest(x, z, rCar = 4.5, rHeli = 8) {
    let best = null, bd = 1e9;
    for (const e of this.vis) { const d = Math.hypot(e.x - x, e.z - z); if (d < (e.kind === 'heli' ? rHeli : rCar) && d < bd) { best = e; bd = d; } }
    return best;
  }
  take(e) { if (!e.dropped) this.taken.add(e.id); else this.dropped = this.dropped.filter(q => q !== e); this.dirty = true; this.t = 9; }
  /** leave a vehicle in the world. A helicopter dropped in the air settles by itself (autorotation, ~7 m/s) */
  drop(kind, type, x, y, z, psi, color, air = false) {
    const e = { id: 'd' + (this.n++), dropped: true, kind, type, x, y, z, psi, color, fall: air }; this.dropped.push(e); this.dirty = true; this.t = 9; return e;
  }
  update(cam, dt) {
    for (const e of this.dropped) if (e.fall) {   // a heli with nobody at the controls comes down and sits
      const g = this.w.surf(e.x, e.z, e.y, true) + 0.1; e.y = Math.max(g, e.y - 7 * dt); e.psi += dt * 0.8; if (e.y <= g) e.fall = false; this.dirty = true;
    }
    this.t += dt; if (!this.dirty && this.t < 0.2) return; this.t = 0; this.dirty = false;
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL), vis = [], dyn = [];
    const consider = e => {
      if (this.taken.has(e.id)) return; const d = Math.hypot(e.x - cam.x, e.z - cam.z); if (d > (e.kind === 'heli' ? R_HELI : R_VIS)) return;
      vis.push(e);
      if (d < R_DYN) { const f = e.kind === 'heli' ? [[0, 0, 2.3]] : [[0.9, 1.0], [-0.9, 1.0]], fx = -Math.sin(e.psi), fz = -Math.cos(e.psi);
        if (e.kind === 'heli') dyn.push([e.x, e.z, 2.4, e, e.y]); else { const L = VEHICLES[e.type]?.L || 4, o = Math.max(0.6, L / 2 - 1); dyn.push([e.x + fx * o, e.z + fz * o, 1.0, e, e.y], [e.x - fx * o, e.z - fz * o, 1.0, e, e.y]); } }
    };
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const e of this.slots((cx + a) + ',' + (cz + b))) consider(e);
    for (const e of this.helis) consider(e); for (const e of this.dropped) consider(e);
    this.vis = vis; this.dyn = dyn;
    for (const f of this.fleets) f.begin(); this.heliFleet.begin();
    for (const e of vis) { if (e.kind === 'heli') this.heliFleet.add(e.x, e.y, e.z, e.psi, e.color); else this.fleets[e.type]?.add(e.x, e.y, e.z, e.psi, e.color); }
    for (const f of this.fleets) f.end(); this.heliFleet.end();
  }
}
