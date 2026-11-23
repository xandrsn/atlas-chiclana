// Solid props (fountains, statues, benches, lamps, trunks, monument bases): circles and oriented boxes in a spatial hash.
// Chained into buildings.hit(x,z,y) by installProps(), so car / heli / walker (which already query buildings.hit) collide with them.
// `top` is an absolute world height: a body whose reference height y is above it passes over (e.g. the heli, or a jump over a bench).
const H = 8;
const key = (a, b) => a * 73856093 ^ b * 19349663;
export const props = {
  map: new Map(), n: 0,
  _put(s, x0, z0, x1, z1) { for (let a = Math.floor(x0 / H); a <= Math.floor(x1 / H); a++) for (let b = Math.floor(z0 / H); b <= Math.floor(z1 / H); b++) { const k = key(a, b); let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(s); } this.n++; },
  /** solid cylinder: centre (x,z), radius r, top height */
  circle(x, z, r, top) { this._put({ x, z, r, top }, x - r, z - r, x + r, z + r); },
  /** solid box: centre (x,z), half sizes hw (local x) / hd (local z), rotation rot (Three.js rotation.y), top height */
  /** walk=true: a stair tread / grandstand row. The on-foot player stands on it (topAt) and only a riser taller than a step (0.6 m) blocks; cars are stopped by the 2nd tread. */
  box(x, z, hw, hd, rot, top, walk) { const c = Math.cos(rot), s = Math.sin(rot), e = Math.abs(c) * hw + Math.abs(s) * hd, f = Math.abs(s) * hw + Math.abs(c) * hd; this._put({ x, z, hw, hd, c, s, top, walk }, x - e, z - f, x + e, z + f); },
  /** highest walkable tread top <= ymax under (x,z), or -Infinity */
  topAt(x, z, ymax) {
    const l = this.map.get(key(Math.floor(x / H), Math.floor(z / H))); let best = -Infinity; if (!l) return best;
    for (const o of l) {
      if (!o.walk || o.top > ymax || o.top <= best) continue;
      const dx = x - o.x, dz = z - o.z, lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      if (Math.abs(lx) < o.hw && Math.abs(lz) < o.hd) best = o.top;
    }
    return best;
  },
  hit(x, z, y) {
    const l = this.map.get(key(Math.floor(x / H), Math.floor(z / H))); if (!l) return false;
    for (const o of l) {
      if (y > o.top || (o.walk && y >= o.top - 0.3)) continue;   // walk boxes: climbable when the tread is within one step above the (feet+0.3) probe
      const dx = x - o.x, dz = z - o.z;
      if (o.r !== undefined) { if (dx * dx + dz * dz < o.r * o.r) return true; }
      else { const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c; if (Math.abs(lx) < o.hw && Math.abs(lz) < o.hd) return true; }   // Three.js rotation.y: world = (lx c + lz s, -lx s + lz c)
    }
    return false;
  },
};
export function installProps(buildings) {
  if (!buildings || buildings.__props) return;
  const orig = buildings.hit.bind(buildings); buildings.hit = (x, z, y) => orig(x, z, y) || props.hit(x, z, y); buildings.__props = true;
  const t0 = buildings.topAt?.bind(buildings); if (t0) buildings.topAt = (x, z, ym) => Math.max(t0(x, z, ym), props.topAt(x, z, ym));
}
