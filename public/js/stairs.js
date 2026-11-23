import * as THREE from 'three';
import { props } from './props.js';
import { toLocal } from './geo.js';
import { Builder, solidMat } from './football.js';

// Stairs and grandstands. A tread is a solid "walk" box (props.js): the on-foot player climbs it (rise <= 0.6 m), cars / heli are blocked.
//   flight(cb, o)  - one straight flight of steps, optional side rails. cb = { box(x,z,du,dv,ang,y0,h,col,topCol), solid(x,z,du,dv,ang,top,walk) } in WORLD coords
//   Stairs         - builds a real flight for every OSM highway=steps way that climbs on the terrain (data/osm.json)
//   stand(cb, o)   - grandstand in a football pitch frame (football.js): tiered rows split in bays by aisle stairs, seats, back wall, roof
const rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const CONC = rgb(0xb9b3a6), CONC_TOP = rgb(0xcfc9bc), RAIL = rgb(0x3b4046);
export const SEAT = [0x1d4fa6, 0xf0f0f0];   // Chiclana CF blue / white
// "Gran Plaza sobre el Río Iro" (OSM area w183510852, ~34 x 58 m, flat): built as a synthetic pedestrian deck in world.js; its south edge
// ends in wide granite gradas down to the riverside promenade with a narrow half-rise stair on the west side (Commons photos, see docs/PLAN.md)
export const GRAN_PLAZA = { n: 'Gran Plaza sobre el Río Iro', h: 'pedestrian', w: 34, b: 1, d: 0, loc: [[-3563, -2124.5], [-3529, -2172]] };

/** straight flight: base-centre (x,z) at ground height y0, climbing along ang (world dir (cos,sin)); n treads of rise x run, width w */
export function flight(cb, o) {
  const { x, z, ang, w, rise, run, n, y0 } = o, c = Math.cos(ang), s = Math.sin(ang), sink = o.sink ?? 0.35, rail = o.rail ?? true;
  for (let i = 0; i < n; i++) {
    const d = run * (i + 0.5), top = y0 + rise * (i + 1), cx = x + c * d, cz = z + s * d;
    cb.box(cx, cz, run, w, ang, y0 - sink, top - y0 + sink, o.col || CONC, o.topCol || CONC_TOP);
    cb.solid(cx, cz, run, w, ang, top, true);
  }
  if (rail) for (const t of [-1, 1]) {   // posts every other tread + the solid side so you cannot step off the flight into the air
    const px = -s * t * (w / 2 + 0.04), pz = c * t * (w / 2 + 0.04);
    for (let i = 0; i < n; i += 2) { const d = run * (i + 0.5), top = y0 + rise * (i + 1); cb.box(x + c * d + px, z + s * d + pz, 0.06, 0.06, ang, top, 0.95, RAIL, RAIL); }
    const top = y0 + rise * n, d = run * n / 2;   // handrail: stepped bar following the treads
    for (let i = 0; i < n; i++) cb.box(x + c * run * (i + 0.5) + px, z + s * run * (i + 0.5) + pz, run, 0.05, ang, y0 + rise * (i + 1) + 0.92, 0.05, RAIL, RAIL);
    cb.solid(x + c * d + px, z + s * d + pz, run * n, 0.06, ang, top + 1, false);
  }
}

function worldCb(B) {
  return {
    box(x, z, du, dv, ang, y0, h, col, topCol) {   // oriented box, top face in topCol
      const c = Math.cos(ang), s = Math.sin(ang), hu = du / 2, hv = dv / 2, y1 = y0 + h;
      const cr = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([a, b]) => [x + a * c - b * s, z + a * s + b * c]);
      const lo = cr.map(p => [p[0], y0, p[1]]), hi = cr.map(p => [p[0], y1, p[1]]);
      B.quad(hi[0], hi[3], hi[2], hi[1], topCol || col); for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; B.quad(lo[k], lo[k2], hi[k2], hi[k], col); }
    },
    solid(x, z, du, dv, ang, top, walk) { props.box(x, z, du / 2, dv / 2, -ang, top, walk); },
  };
}

/** every OSM highway=steps segment that climbs >= 0.35 m on the terrain becomes a real flight (tread rise ~0.17 m) */
export class Stairs {
  constructor(scene, hf, osm) {
    // one mesh per 512 m cell, hidden beyond 600 m by THREE.LOD: a single city-wide mesh was 2.3 M always-drawn triangles in Madrid
    const CELL = 512, cells = new Map(); let nf = 0;
    const cbAt = (x, z) => { const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL); let e = cells.get(k); if (!e) { const B = new Builder(); cells.set(k, e = { B, cb: worldCb(B), x: (Math.floor(x / CELL) + 0.5) * CELL, z: (Math.floor(z / CELL) + 0.5) * CELL }); } return e.cb; };
    // gradas of the Gran Plaza: tiers of ~0.5 x 0.8 m across the whole south edge, climbing north to the flat deck (deck height = north end ground, as world.js)
    const [[sx, sz], [ex, ez]] = GRAN_PLAZA.loc, gl = Math.hypot(ex - sx, ez - sz), ux = (ex - sx) / gl, uz = (ez - sz) / gl, ang = Math.atan2(uz, ux), top = hf.height(ex, ez), W = GRAN_PLAZA.w;
    let n = 2; for (let k = 0; k < 3; k++) n = Math.max(2, Math.round((top - hf.height(sx - ux * n * 0.8, sz - uz * n * 0.8)) / 0.5));
    const run = 0.8, L = n * run, y0 = hf.height(sx - ux * L, sz - uz * L), rise = (top - y0) / n, bx = sx - ux * L, bz = sz - uz * L, side = o => [bx - uz * o, bz + ux * o];   // o > 0 = east, o < 0 = west
    const gr = { col: rgb(0x8f8d88), topCol: rgb(0xa9a7a1) }, cb = cbAt(bx, bz);
    { const [x, z] = side(1.4); flight(cb, { x, z, ang, w: W - 3.2, rise, run, n, y0, rail: false, ...gr }); }
    { const [x, z] = side(-(W / 2 - 1.3)); flight(cb, { x, z, ang, w: 2.0, rise: rise / 2, run: run / 2, n: 2 * n, y0, ...gr }); }   // narrow side stair (half risers) on the west edge
    for (const o of [W / 2 - 0.15, -(W / 2 - 0.15)]) { const [x, z] = side(o); for (let i = 0; i < n; i++) { const d = run * (i + 0.5), h = y0 + rise * (i + 1) + 1; cb.box(x + ux * d, z + uz * d, run, 0.3, ang, y0 - 0.4, h - y0 + 0.4, rgb(0xe8e6df)); cb.solid(x + ux * d, z + uz * d, run, 0.3, ang, h, false); } }   // white concrete cheek walls, stepped with the tiers
    const inGradas = (x, z) => { const u = (x - sx) * ux + (z - sz) * uz, v = (x - sx) * -uz + (z - sz) * ux; return u > -L - 3 && u < 4 && Math.abs(v) < W / 2 + 2; };
    this.gradas = { n, rise, run, y0, top };
    for (const r of osm.roads) {
      if (r.h !== 'steps' || r.b) continue;
      const pts = []; for (let i = 0; i + 1 < r.p.length; i += 2) pts.push(toLocal(r.p[i], r.p[i + 1]));
      if (pts.some(([x, z]) => inGradas(x, z))) continue;   // OSM steps 7339/7340/7449/7450 = these gradas
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), ha = hf.height(ax, az), hb = hf.height(bx, bz), dh = Math.abs(hb - ha);
        if (len < 1.2 || dh < 0.35 || dh / len < 0.2) continue;   // flat or a gentle ramp: the footway strip is enough
        const n = Math.max(2, Math.round(dh / 0.17)), lowA = ha < hb, [x0, z0, x1, z1] = lowA ? [ax, az, bx, bz] : [bx, bz, ax, az];
        flight(cbAt(x0, z0), { x: x0, z: z0, ang: Math.atan2(z1 - z0, x1 - x0), w: Math.max(1.8, r.w || 1.8), rise: dh / n, run: len / n, n, y0: Math.min(ha, hb) });
        nf++;
      }
    }
    this.count = nf;
    this.group = new THREE.Group(); this.group.name = 'stairs'; scene.add(this.group);
    for (const e of cells.values()) {
      const y = hf.height(e.x, e.z), m = new THREE.Mesh(e.B.geometry(false), solidMat()), lod = new THREE.LOD();
      m.position.set(-e.x, -y, -e.z); lod.position.set(e.x, y, e.z); lod.addLevel(m, 0); lod.addLevel(new THREE.Object3D(), 600); this.group.add(lod);
      lod.updateMatrixWorld(true); lod.traverse(o => { o.matrixAutoUpdate = false; });   // static: no per-frame matrix work
    }
  }
}

/** grandstand in the pitch frame. cb = { box(u,v,du,dv,y0,h,col,B?), solid(u,v,du,dv,top,walk), gy(u,v) } (football.js).
 *  a = position along the stand (centred on o.off), b = depth away from the pitch; axis 'u' = along the touchline, 'v' = behind a goal. */
export function stand(cb, o) {
  const { len, rows = 10, rise = 0.4, run = 0.85, side = 1, axis = 'u', off = 0, front, roof = false } = o, base = cb.gy(axis === 'u' ? off : side * front, axis === 'u' ? side * front : off) + 0.05;
  const U = (a, b) => axis === 'u' ? a + off : side * (front + b), V = (a, b) => axis === 'u' ? side * (front + b) : a + off, sz = (A, Bd) => axis === 'u' ? [A, Bd] : [Bd, A];
  const put = (a, b, A, Bd, y0, h, col, walkTop) => { const [du, dv] = sz(A, Bd); cb.box(U(a, b), V(a, b), du, dv, y0, h, col); if (walkTop !== undefined) cb.solid(U(a, b), V(a, b), du, dv, walkTop, true); };
  const nb = Math.max(1, Math.round(len / 13)), aw = 1.3, bw = (len - (nb - 1) * aw) / nb, depth = rows * run;
  for (let k = 0; k < nb; k++) {
    const a = -len / 2 + k * (bw + aw) + bw / 2;
    for (let r = 0; r < rows; r++) {
      const b = r * run + run / 2, top = base + (r + 1) * rise;
      put(a, b, bw, run, base - 0.4, top - base + 0.4, rgb(0xc4bfb3), top);
      put(a, b + run * 0.12, bw - 0.2, run * 0.5, top, 0.07, rgb(SEAT[(k + r) % 2 ? 1 : 0]));   // seat strip (visual only)
      put(a, b + run * 0.42, bw - 0.2, 0.07, top, 0.38, rgb(SEAT[(k + r) % 2 ? 1 : 0]));        // seat back
    }
    if (k < nb - 1) {   // aisle: stairs with half-height risers
      const ax = a + bw / 2 + aw / 2;
      for (let j = 0; j < rows * 2; j++) { const top = base + (j + 1) * rise / 2; put(ax, j * run / 2 + run / 4, aw - 0.1, run / 2, base - 0.4, top - base + 0.4, rgb(0xd6d1c4), top); }
    }
  }
  for (const t of [-1, 1]) { const a = t * (len / 4 + 0.75), l = len / 2 - 1.5; put(a, -0.35, l, 0.15, base - 0.2, 1.3, rgb(SEAT[0])); cb.solid(U(a, -0.35), V(a, -0.35), ...sz(l, 0.15), base + 1.1, false); }   // front barrier (blue) with a 3 m gate in the middle
  put(0, depth + 0.2, len, 0.4, base - 0.4, rows * rise + (roof ? 4.6 : 2.2), rgb(0xd9d4c8)); cb.solid(U(0, depth + 0.2), V(0, depth + 0.2), ...sz(len, 0.4), base + rows * rise + (roof ? 4.6 : 2.2), false);   // back wall
  if (roof) {   // cantilever roof on steel columns, club-blue fascia
    const rt = base + rows * rise + 4.6, step = 8, nc = Math.max(2, Math.round(len / step) + 1);
    for (let i = 0; i < nc; i++) { const a = -len / 2 + len * i / (nc - 1); put(a, depth - 0.6, 0.35, 0.35, base, rows * rise + 4.6, rgb(0x8a9098)); cb.solid(U(a, depth - 0.6), V(a, depth - 0.6), ...sz(0.35, 0.35), rt, false); }
    put(0, depth / 2 + 0.2, len + 1, depth + 1.6, rt, 0.25, rgb(0xcfd3d8)); put(0, -0.7, len + 1, 0.15, rt - 0.2, 0.6, rgb(SEAT[0]));
  }
}
