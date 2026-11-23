// Spatial-hash collision world for solid props: rural walls (segments), tree trunks (circles) and ambient traffic cars (dynamic circles).
// Static entries are registered per world cell when it is built and removed when it is freed.
const H = 8;   // hash cell size (m)
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6), Math.sin(i * Math.PI / 6)]);
/** outward unit normal of whatever solid 'hit(x,z,y)' reports around the blocked point (px,pz): mean direction of the free samples on a small circle.
 *  Returns null when the point is completely enclosed. Used to slide along walls instead of stopping dead. */
export function wallNormal(hit, px, pz, y, r = 0.7, out = [0, 0]) {
  let nx = 0, nz = 0;
  for (let pass = 0; pass < 2 && nx === 0 && nz === 0; pass++, r *= 2.2)
    for (const d of DIRS) if (!hit(px + d[0] * r, pz + d[1] * r, y)) { nx += d[0]; nz += d[1]; }
  const l = Math.hypot(nx, nz); if (l < 1e-3) return null; out[0] = nx / l; out[1] = nz / l; return out;
}
export class Collide {
  constructor() { this.seg = new Map(); this.circ = new Map(); this.byKey = new Map(); this.dyn = []; this.player = null; }
  _cells(x0, z0, x1, z1, fn) { for (let a = Math.floor(Math.min(x0, x1) / H); a <= Math.floor(Math.max(x0, x1) / H); a++) for (let b = Math.floor(Math.min(z0, z1) / H); b <= Math.floor(Math.max(z0, z1) / H); b++) fn(a * 73856093 ^ b * 19349663); }   // numeric cell key (a rare hash collision only adds candidates that the distance test rejects)
  _put(m, k, v, rec) { let l = m.get(k); if (!l) m.set(k, l = new Set()); l.add(v); rec.push([m, k, v]); }
  /** register a world cell's solids: walls = [[x1,z1,x2,z2,thick]...], trees = [[x,z,r]...] */
  add(key, walls, trees) {
    this.remove(key); const rec = [];
    for (const w of walls) this._cells(w[0] - 0.5, w[1] - 0.5, w[2] + 0.5, w[3] + 0.5, c => this._put(this.seg, c, w, rec));
    for (const t of trees) this._cells(t[0], t[1], t[0], t[1], c => this._put(this.circ, c, t, rec));
    this.byKey.set(key, rec);
  }
  remove(key) { const r = this.byKey.get(key); if (!r) return; for (const [m, k, v] of r) { const l = m.get(k); if (l) { l.delete(v); if (!l.size) m.delete(k); } } this.byKey.delete(key); }
  /** dynamic circles (traffic): array of [x,z,r,ref] rebuilt each frame */
  setDynamic(list) { this.dyn = list; }
  /** a vehicle of mass m (kg) at speed v (m/s) moving along (dx,dz) hits tree t: breaks it when the momentum beats the trunk (t.str, set by world.js) */
  tryBreak(t, m, v, dx = 0, dz = 0) { if (t.dead || !t.str || m * v < t.str) return false; t.dead = 1; this.onBreak?.(t, dx, dz, v); return true; }
  /** break every breakable tree within r of (x,z) (helicopter, tram, remote vehicles: bodies without circle physics of their own) */
  smash(x, z, r, m, v, dx, dz) {
    if (m * v < 800) return;
    this._cells(x - r - 1, z - r - 1, x + r + 1, z + r + 1, c => { for (const t of this.circ.get(c) || []) if (!t.dead && Math.hypot(t[0] - x, t[1] - z) < r + t[2]) this.tryBreak(t, m, v, dx, dz); });
  }
  /** push the circle (x,z,r) out of every solid. returns null or {x,z,nx,nz,depth,dyn} (nx,nz = accumulated outward unit normal) */
  resolve(x, z, r, height = 0.5, yRef) {
    let px = x, pz = z, nx = 0, nz = 0, depth = 0, dyn = null, hit = false, tree = null;
    const push = (cx, cz, rr, ref) => { const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz), m = r + rr; if (d >= m) return; const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0; px += ux * (m - d); pz += uz * (m - d); nx += ux; nz += uz; depth = Math.max(depth, m - d); hit = true; if (ref) dyn = ref; return true; };
    const stamp = this._stamp = (this._stamp || 0) + 1;   // visited marker instead of two Sets per call
    this._cells(x - r - 1, z - r - 1, x + r + 1, z + r + 1, c => {
      for (const w of this.seg.get(c) || []) { if (w._s === stamp) continue; w._s = stamp;
        const ax = w[0], az = w[1], dx = w[2] - ax, dz = w[3] - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (w.length > 6 && yRef !== undefined) { const yi = w[5] + (w[6] - w[5]) * t; if (w.length > 7 ? yRef > yi + w[7] - 0.1 : Math.abs(yi - yRef) > 1.8) continue; }   // y-tagged: bridge parapet only solid at deck level; w[7] = wall height, jump over it
        push(ax + dx * t, az + dz * t, w[4] || 0.2, null); }
      for (const t of this.circ.get(c) || []) { if (t._s === stamp || t.dead) continue; t._s = stamp; if (push(t[0], t[1], t[2], null) && t.str) tree = t; }   // broken trees no longer collide
    });
    for (const d of this.dyn) if (Math.abs(d[0] - px) < 4 && Math.abs(d[1] - pz) < 4 && !(yRef !== undefined && d[4] !== undefined && Math.abs(d[4] - yRef) > 3)) push(d[0], d[1], d[2], d[3]);
    if (!hit) return null; const l = Math.hypot(nx, nz) || 1; return { x: px, z: pz, nx: nx / l, nz: nz / l, depth, dyn, tree };
  }
}
