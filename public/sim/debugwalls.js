// Debug overlay of the movers' wall collisions (camera/solid.js wall pieces, sim/walls.js band): F4 or ?debugwalls=1.
// Every wall piece within R m of the mover, as a vertical rectangle from its bottom to its top: red = it blocks the mover now (its
// [bottom, top] overlaps feet + BAND.low .. feet + BAND.head), dim = it does not (above or below the body). The body rectangle in cyan.
// One LineSegments draw call while on, rebuilt 4 times a second; nothing at all while off.
import * as THREE from 'three';
import { BAND } from './walls.js';
const R = 30;
export function debugWalls(scene, solid) {
  const geo = new THREE.BufferGeometry(), mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  mesh.renderOrder = 999; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  let t = 0;
  return {
    get on() { return mesh.visible; }, set on(v) { mesh.visible = v; t = 0; },
    /** m: { x, z, y (feet), h, hw, hl } the current mover */
    update(dt, m) {
      if (!mesh.visible || (t -= dt) > 0) return; t = 0.25;
      const p = [], c = [], y0 = m.y + BAND.low, y1 = m.y + BAND.head, seen = new Set();
      const line = (ax, ay, az, bx, by, bz, col) => { p.push(ax, ay, az, bx, by, bz); c.push(...col, ...col); };
      solid.near(m.x, m.z, R, (s, k, ox, oz) => {
        const id = s.length + ':' + k + ':' + ox + ':' + oz; if (seen.has(id)) return false; seen.add(id);   // a piece sits in up to 4 buckets
        const ax = s[k] + ox, az = s[k + 1] + oz, bx = s[k + 2] + ox, bz = s[k + 3] + oz, lo = s[k + 4], hi = s[k + 5];
        if (Math.hypot((ax + bx) / 2 - m.x, (az + bz) / 2 - m.z) > R) return false;
        const col = hi > y0 && lo < y1 ? [1, 0.1, 0.1] : [0.6, 0.55, 0.2];
        line(ax, lo, az, bx, lo, bz, col); line(ax, hi, az, bx, hi, bz, col); line(ax, lo, az, ax, hi, az, col);
        if (col[0] === 1) line(ax, y0, az, bx, y0, bz, col);   // where it meets the body band
        return false;
      });
      const s = Math.sin(m.h), co = Math.cos(m.h), P = [[-m.hw, m.hl], [m.hw, m.hl], [m.hw, -m.hl], [-m.hw, -m.hl]].map(([a, b]) => [m.x + co * a - s * b, m.z - s * a - co * b]);
      for (let e = 0; e < 4; e++) for (const y of [y0, y1]) line(P[e][0], y, P[e][1], P[(e + 1) % 4][0], y, P[(e + 1) % 4][1], [0.2, 0.9, 1]);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    },
  };
}
