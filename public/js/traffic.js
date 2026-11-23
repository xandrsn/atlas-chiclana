import { Fleet, VEHICLES, randomType } from './vehicles.js';

// Ambient traffic: cars follow the OSM road graph (right-hand drive) near the camera. Each car is one of the VEHICLES types (spawn probability from the
// table, own top speed) drawn by one instanced call per type. AI: stays in its lane, keeps a following distance to cars with a similar heading,
// stops for the player (also on foot) and for parked vehicles in its lane, slows for bends and road ends, gives way at junctions to whoever got there first
// (a patience timer breaks any deadlock), and is recycled when it has been stuck for too long or is far away.
const N = 26, RMIN = 60, RMAX = 330, FAR = 460, PAL = [0xf2f2f0, 0xd9d9d9, 0x8a8f96, 0x2a2d31, 0xb5251c, 0x1f4f8f, 0xe8d9a8, 0x3f5b45, 0x6b6e73, 0x7b1f1f];

export class Traffic {
  constructor(scene, world) {
    this.w = world; this.on = true; this.extra = []; this.nid = 1;
    this.fleets = VEHICLES.map((_, i) => new Fleet(scene, i, N));
    this.cars = [];
    this.ends = new Map();   // endpoint index to connect roads
    const key = (x, z) => Math.round(x / 3) + ',' + Math.round(z / 3);
    this.key = key;
    for (const r of world.roads) {
      if (!this.ok(r)) continue;
      for (const e of [0, r.n - 1]) { const k = key(r.P[2 * e], r.P[2 * e + 1]); let l = this.ends.get(k); if (!l) this.ends.set(k, l = []); l.push([r, e]); }
    }
    this.tun = world.ug?.roads() || [];   // tunnel / car-park-ramp ways as pseudo roads (underground.js): same junction graph as the surface
    for (const r of this.tun) for (const e of [0, r.n - 1]) { const k = key(r.P[2 * e], r.P[2 * e + 1]); let l = this.ends.get(k); if (!l) this.ends.set(k, l = []); l.push([r, e]); }
  }
  /** does the road run ALONG the tram track (> ~16 m in a row inside the corridor, world.keep)? Such roads carry no traffic; streets that merely cross it (signalled, see gates) do. */
  onTram(r) { if (r._tram === undefined) { r._tram = false; const keep = this.w.keep; if (keep) for (let i = 0, run = 0; i < r.n; i++) { run = keep(r.P[2 * i], r.P[2 * i + 1], 0.5) ? run + 1 : 0; if (run > 4) { r._tram = true; break; } } } return r._tram; }
  ok(r) { return r.drive && !this.onTram(r) && r.w >= 4.4 && r.n >= 4 && !/footway|path|cycleway|steps|pedestrian|track|bridleway|motorway/.test(r.cls); }
  wt(r) { return r.u ? 0.05 : r.tier === 1 ? 1 : r.tier === 2 ? 0.5 : 0.25; }
  /** target car count around the camera: grows with the amount of built-up road in the 3x3 cells around it */
  target(cam) {
    const cx = Math.floor(cam.x / 512), cz = Math.floor(cam.z / 512); let sum = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = this.w.cells.get((cx + a) + ',' + (cz + b)); if (!c) continue; for (const [r, i0, i1] of c.runs) if (this.ok(r)) sum += (i1 - i0) * 4 * this.wt(r); }
    const d = this.dens ?? 1; return Math.min(N, Math.max(d ? 2 : 0, Math.round(sum / 190 * d)));   // d: density setting
  }
  setVisible(v) { this.on = v; for (const f of this.fleets) f.visible = v; }
  speedOf(r, t) { const S = VEHICLES[t]; return ((r.w > 9 ? 12 : 8) + Math.random() * 3) * Math.sqrt(S.top) * (S.bike ? 1.05 : 1); }   // m/s: street limit x the type's character

  spawn(cam) {
    const W = this.w, keys = [], cx = Math.floor(cam.x / 512), cz = Math.floor(cam.z / 512);
    if (this.tun.length && Math.random() < 0.3) {   // underground traffic: tunnels within spawn range of the camera
      const near = this.tun.filter(r => Math.hypot(r.cx - cam.x, r.cz - cam.z) < RMAX + r.rad); if (near.length) { const r = near[(Math.random() * near.length) | 0], i = Math.random() * (r.n - 1), x = r.P[2 * (i | 0)], z = r.P[2 * (i | 0) + 1], d = Math.hypot(x - cam.x, z - cam.z);
        if (d > RMIN && d < RMAX && !this.cars.some(o => o.x !== undefined && Math.hypot(o.x - x, o.z - z) < 14)) { const ty = randomType(Math.random(), []); return { id: this.nid++, r, s: i, dir: Math.random() < 0.5 ? 1 : -1, v: 0, vmax: this.speedOf(r, ty), t: ty, col: PAL[(Math.random() * PAL.length) | 0], wait: 0, stuck: 0 }; } }
    }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = W.cells.get((cx + a) + ',' + (cz + b)); if (c && c.runs.length) keys.push(c); }
    if (!keys.length) return null;
    for (let t = 0; t < 12; t++) {
      const c = keys[(Math.random() * keys.length) | 0], [r, i0, i1] = c.runs[(Math.random() * c.runs.length) | 0];
      if (!this.ok(r) || i1 - i0 < 2) continue;
      if (Math.random() > this.wt(r)) continue;           // rural / minor roads get far fewer cars than built-up streets
      const i = i0 + Math.random() * (i1 - i0), x = r.P[2 * (i | 0)], z = r.P[2 * (i | 0) + 1], d = Math.hypot(x - cam.x, z - cam.z);
      if (d < RMIN || d > RMAX) continue;
      if (this.cars.some(o => o.x !== undefined && Math.hypot(o.x - x, o.z - z) < 14)) continue;   // never on top of another car
      const ty = randomType(Math.random(), []);
      return { id: this.nid++, r, s: i, dir: r.ow || Math.random() < 0.5 ? 1 : -1, v: 0, vmax: this.speedOf(r, ty), t: ty, col: PAL[(Math.random() * PAL.length) | 0], wait: 0, stuck: 0 };
    }
    return null;
  }

  update(dt, cam) {
    if (!this.on) return;
    const cars = this.cars;
    if (!this._tw || (this._tf = (this._tf || 0) + 1) % 45 === 0) this._tw = this.target(cam);   // density scan is costly: refresh ~1.3x/s
    const want = this._tw;
    while (cars.length < want && this.w.cells.size && Math.random() < 0.5) { const c = this.spawn(cam); if (!c) break; cars.push(c); }
    while (cars.length > want + 6) cars.pop();
    dt = Math.min(dt, 0.1); const pl = this.w.col?.player;
    for (let k = cars.length - 1; k >= 0; k--) {
      const c = cars[k], r = c.r;
      let vt = c.vmax; if (c.hitT > 0) { c.hitT -= dt; vt = 0; }                                              // was hit by the player: stopped for a few seconds
      const nrem = c.dir > 0 ? r.n - 1 - c.s : c.s;
      if (nrem < 4) vt = Math.min(vt, 3 + nrem * 1.5);                                                         // ease off before a junction / road end
      if (c.turn > 0.25) vt = Math.min(vt, Math.max(3, 9 - c.turn * 14));                                       // and in tight bends
      if (c.psi !== undefined) {
        const fx = -Math.sin(c.psi), fz = -Math.cos(c.psi), reach = 5 + c.v * 1.4;
        // obstacle ahead in my lane: player (any mode), cars with a similar heading, parked vehicles. Stop 4.6 m from its centre
        const chk = (ox, oz, lat) => { const dx = ox - c.x, dz = oz - c.z, ah = dx * fx + dz * fz; if (ah > 0.5 && ah < reach && Math.abs(dx * -fz + dz * fx) < lat) vt = ah < 4.6 ? 0 : Math.min(vt, Math.max(0, (ah - 4.6) * 1.1)); };
        if (pl) chk(pl.x, pl.z, 2.3);
        for (let j = 0; j < cars.length; j++) { const o = cars[j]; if (o === c || o.x === undefined || Math.abs(o.x - c.x) > 18 || Math.abs(o.z - c.z) > 18) continue;
          if (Math.cos(o.psi - c.psi) > 0.4) chk(o.x, o.z, 1.7); }
        for (const e of this.extra) { if (Math.abs(e[0] - c.x) > 18 || Math.abs(e[1] - c.z) > 18) continue; chk(e[0], e[1], 1.5); }
        // tram level crossings (world.gates, set by tram.js): red signal = stop 6.2 m before the rails (cars already on them keep going)
        for (const g of this.w.gates || []) {
          if (!g.closed || Math.abs(g.x - c.x) > 45 || Math.abs(g.z - c.z) > 45 || Math.abs(fx * g.ux + fz * g.uz) < 0.6) continue;
          const dx = g.x - c.x, dz = g.z - c.z, ah = dx * fx + dz * fz;
          if (ah > 3.4 && ah < Math.max(reach, 16) && Math.abs(dx * -fz + dz * fx) < g.hw) vt = ah < 6.2 ? 0 : Math.min(vt, Math.max(0, (ah - 6.2) * 1.1));
        }
        // junction: whoever reaches the node first goes first; the others wait ~3.5 m before it (patience 6 s)
        if (nrem < 6 && c.wait < 6) {
          const e = c.dir > 0 ? r.n - 1 : 0, ex = r.P[2 * e], ez = r.P[2 * e + 1], dm = Math.hypot(c.x - ex, c.z - ez);
          for (let j = 0; j < cars.length; j++) { const o = cars[j]; if (o === c || o.x === undefined) continue;
            const dox = Math.hypot(o.x - ex, o.z - ez); if (dox > 10 || Math.cos(o.psi - c.psi) > 0.8 || o.v < 0.3 && dox > 5) continue;
            if (dox < dm - 1 || (Math.abs(dox - dm) <= 1 && o.id < c.id)) { if (dm < 12) vt = Math.min(vt, Math.max(0, (dm - 3.5) * 0.9)); break; } }
        }
      }
      c.v += (vt - c.v) * Math.min(1, dt * (vt < c.v ? 3.5 : 0.8));
      c.wait = vt < 0.3 && c.v < 0.5 ? c.wait + dt : 0; c.stuck = c.v < 0.3 ? c.stuck + dt : 0;
      if (c.stuck > 25) { cars.splice(k, 1); continue; }                                                       // jammed: recycle it
      c.s += c.dir * c.v * dt / 4;                                                                              // road points are ~4 m apart
      if (c.s <= 0 || c.s >= r.n - 1) {                                                                         // reached an end: continue on a connected road
        const e = c.s <= 0 ? 0 : r.n - 1, l = (this.ends.get(this.key(r.P[2 * e], r.P[2 * e + 1])) || []).filter(([q, qe]) => q !== r && (!q.ow || qe === 0));
        if (!l.length && r.ow) { cars.splice(k, 1); continue; }
        if (!l.length) { c.dir = -c.dir; c.s = Math.max(0, Math.min(r.n - 1.001, c.s)); }
        else { const [q, qe] = l[(Math.random() * l.length) | 0]; c.r = q; c.s = qe === 0 ? 0.01 : q.n - 1.01; c.dir = qe === 0 ? 1 : -1; c.vmax = this.speedOf(q, c.t); }
      }
      const rr = c.r, i = Math.max(0, Math.min(rr.n - 2, c.s | 0)), f = c.s - i, P = rr.P;
      let tx = P[2 * i + 2] - P[2 * i], tz = P[2 * i + 3] - P[2 * i + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const off = rr.ow ? 0 : c.dir * rr.w * 0.25, x = P[2 * i] + tx * f * l + (-tz) * off, z = P[2 * i + 1] + tz * f * l + tx * off;
      const y = rr.Y[i] + (rr.Y[i + 1] - rr.Y[i]) * f + rr.spec[1] + 0.05;
      if (Math.hypot(x - cam.x, z - cam.z) > FAR) { cars.splice(k, 1); continue; }
      const tp = Math.atan2(-tx * c.dir, -tz * c.dir);
      if (c.psi === undefined) { c.psi = tp; c.x = x; c.z = z; } else {
        let dp = tp - c.psi; dp = Math.atan2(Math.sin(dp), Math.cos(dp)); c.turn = Math.abs(dp);
        c.psi += dp * Math.min(1, dt * 6);                                                                      // turn gradually, no snapping at junctions
        const k2 = Math.min(1, dt * 8); c.x += (x - c.x) * k2; c.z += (z - c.z) * k2;                           // lane changes glide
      }
      c.y = y;
    }
    for (const f of this.fleets) f.begin();
    for (const c of cars) if (c.psi !== undefined) this.fleets[c.t].add(c.x, c.y, c.z, c.psi, c.col);
    for (const f of this.fleets) f.end();
    if (this.w.col && ((this._df = (this._df || 0) + 1) & 1) === 0) {
      const dyn = [...this.extra];
      for (const c of cars) { if (c.psi === undefined) continue; const fx = -Math.sin(c.psi), fz = -Math.cos(c.psi), o = Math.max(0.6, VEHICLES[c.t].L / 2 - 1); dyn.push([c.x + fx * o, c.z + fz * o, 1.0, c, c.y], [c.x - fx * o, c.z - fz * o, 1.0, c, c.y]); }
      this.w.col.setDynamic(dyn);
    }
  }
}
