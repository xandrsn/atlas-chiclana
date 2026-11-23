import * as THREE from 'three';
import { props } from './props.js';

// Public parks (data/parks_all.json, built by scripts/parks_build.mjs): lazily generated detail, one merged mesh per park, built once when the camera gets near.
// Perimeter promenade, cross paths, benches, lamps, bins, central fountain + flowerbeds, hedges, playground.
// shortcut: generated from the park polygon only (Overpass amenity dumps in p.am were unavailable); use p.am when data/parks/amen_*.json exists.
const COL = { wood: [0.45, 0.3, 0.17], metal: [0.25, 0.27, 0.3], stone: [0.66, 0.63, 0.57], sand: [0.78, 0.7, 0.52], rubber: [0.62, 0.22, 0.18], hedge: [0.14, 0.34, 0.14], flower: [0.8, 0.25, 0.4], flower2: [0.9, 0.8, 0.2], soil: [0.3, 0.2, 0.12], water: [0.25, 0.5, 0.7], lamp: [0.95, 0.9, 0.7], red: [0.75, 0.2, 0.15], blue: [0.2, 0.45, 0.7], yel: [0.9, 0.75, 0.15] };
const inside = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const rng = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

export class Parks {
  constructor(scene, hf, list) {
    this.scene = scene; this.hf = hf; this.list = list.filter(p => p.ar < 130000); this.built = new Map();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  update(pos) {
    for (const p of this.list) {
      const near = Math.hypot(p.c[0] - pos.x, p.c[1] - pos.z) < Math.sqrt(p.ar) * 0.7 + 260;
      let m = this.built.get(p.id);
      if (m === undefined && near) { m = this.build(p) || null; this.built.set(p.id, m); }
      if (m) m.visible = near;
    }
  }
  build(p) {
    const hf = this.hf, P = [], C = [], rnd = rng([...p.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0), poly = p.poly;
    const tri = (a, b, c, col) => { for (const v of [a, b, c]) { P.push(...v); C.push(...col); } };
    const box = (x, y, z, w, h, d, col, rot = 0) => {
      const c = Math.cos(rot), s = Math.sin(rot), pts = [];
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const k of [0, 1]) pts.push([x + (a * w / 2) * c + (b * d / 2) * s, y + k * h, z - (a * w / 2) * s + (b * d / 2) * c]);
      for (const [i, j, k, l] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) { tri(pts[i], pts[j], pts[k], col); tri(pts[i], pts[k], pts[l], col); }
    };
    const G = (x, z) => hf.height(x, z);
    const ribbon = (pts, w, col, dy = 0.07) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.01) continue;
        const nx = -dz / L * w / 2, nz = dx / L * w / 2, a = [x0 + nx, G(x0 + nx, z0 + nz) + dy, z0 + nz], b = [x0 - nx, G(x0 - nx, z0 - nz) + dy, z0 - nz], c = [x1 - nx, G(x1 - nx, z1 - nz) + dy, z1 - nz], d = [x1 + nx, G(x1 + nx, z1 + nz) + dy, z1 + nz];
        tri(a, b, c, col); tri(a, c, d, col);
      }
    };
    const disc = (x, z, r, col, dy = 0.08, n = 14) => { const y = G(x, z) + dy; for (let i = 0; i < n; i++) { const a0 = i / n * 6.2832, a1 = (i + 1) / n * 6.2832; tri([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], col); } };
    const bench = (x, z, rot) => { const y = G(x, z), c = Math.cos(rot), s = Math.sin(rot); box(x, y + 0.42, z, 1.6, 0.08, 0.45, COL.wood, rot); box(x, y + 0.75, z, 1.6, 0.4, 0.07, COL.wood, rot); box(x - 0.7 * c, y, z + 0.7 * s, 0.1, 0.42, 0.4, COL.metal, rot); box(x + 0.7 * c, y, z - 0.7 * s, 0.1, 0.42, 0.4, COL.metal, rot); props.box(x, z, 0.8, 0.25, rot, 0.9); };
    const lamp = (x, z) => { const y = G(x, z); box(x, y, z, 0.12, 3.6, 0.12, COL.metal); box(x, y + 3.6, z, 0.5, 0.25, 0.5, COL.lamp); props.circle(x, z, 0.1, 3.6); };
    const bin = (x, z) => { const y = G(x, z); box(x, y, z, 0.45, 0.85, 0.45, COL.metal); props.circle(x, z, 0.25, 0.85); };

    // inset loop along the boundary (bisector offset, flipped if it lands outside)
    const n = poly.length, loop = [], D = Math.min(4, Math.sqrt(p.ar) * 0.05 + 1.5);
    for (let i = 0; i < n; i++) {
      const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
      const e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1], l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
      let nx = -e1z / l1 - e2z / l2, nz = e1x / l1 + e2x / l2; const nl = Math.hypot(nx, nz); if (nl < 0.2) continue; nx /= nl; nz /= nl;
      let px = b[0] + nx * D, pz = b[1] + nz * D; if (!inside(poly, px, pz)) { px = b[0] - nx * D; pz = b[1] - nz * D; if (!inside(poly, px, pz)) continue; }
      loop.push([px, pz]);
    }
    const dense = [];
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / 6)); for (let j = 0; j < k; j++) { const t = j / k, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; if (inside(poly, x, z)) dense.push([x, z]); } }
    if (dense.length < 4) return null;
    const segs = []; let cur = [];
    for (let i = 0; i <= dense.length; i++) { const q = dense[i % dense.length], prev = cur.at(-1); if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 14) { if (cur.length > 1) segs.push(cur); cur = []; } cur.push(q); }
    if (cur.length > 1) segs.push(cur);
    for (const s of segs) ribbon(s, 2.4, COL.sand);
    // benches / lamps / bins along the promenade, hedge stretches
    let acc = 0, k = 0; const big = Math.sqrt(p.ar) > 40;
    for (let i = 0; i + 1 < dense.length; i++) {
      const a = dense[i], b = dense[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (L > 14 || L < 0.5) continue;
      const rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); let sx = -(b[1] - a[1]) / L, sz = (b[0] - a[0]) / L;
      if (!inside(poly, a[0] + sx * 3, a[1] + sz * 3)) { sx = -sx; sz = -sz; }
      if (acc > 26) { acc = 0; k++; const m = k % 3;
        if (m === 0) bench(a[0] + sx * 1.8, a[1] + sz * 1.8, rot); else if (m === 1) lamp(a[0] + sx * 1.5, a[1] + sz * 1.5); else { bin(a[0] + sx * 1.6, a[1] + sz * 1.6); bench(a[0] - sx * 1.8, a[1] - sz * 1.8, rot + Math.PI); } }
      if (big && rnd() < 0.15) { const hx = a[0] - sx * 2.6, hz = a[1] - sz * 2.6; if (inside(poly, hx, hz)) box(hx, G(hx, hz), hz, L, 0.9, 0.7, COL.hedge, rot); }
    }
    // cross paths, central plaza with fountain + flowerbeds
    const c0 = inside(poly, p.c[0], p.c[1]) ? p.c : dense[Math.floor(dense.length / 2)], cx = c0[0], cz = c0[1];
    if (p.ar > 3000) {
      for (let i = 0; i < 4; i++) { const ang = i * Math.PI / 2 + rnd() * 0.5, line = []; for (let r = 0; r < 200; r += 4) { const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r; if (!inside(poly, x, z)) break; line.push([x, z]); } if (line.length > 2) ribbon(line, 2.0, COL.sand, 0.06); }
      disc(cx, cz, 7, COL.stone, 0.09, 20);
      const y = G(cx, cz); box(cx, y, cz, 3.2, 0.5, 3.2, COL.stone); box(cx, y + 0.5, cz, 2.6, 0.12, 2.6, COL.water); box(cx, y + 0.5, cz, 0.35, 1.8, 0.35, COL.stone); props.circle(cx, cz, 1.7, 0.6);
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28 + 0.5, fx = cx + Math.cos(a) * 5.5, fz = cz + Math.sin(a) * 5.5; if (!inside(poly, fx, fz)) continue; disc(fx, fz, 1.1, COL.soil, 0.1, 10); for (let f = 0; f < 6; f++) { const q = rnd() * 6.28, rr = rnd() * 0.8; box(fx + Math.cos(q) * rr, G(fx, fz) + 0.1, fz + Math.sin(q) * rr, 0.22, 0.28, 0.22, f % 2 ? COL.flower : COL.flower2); } }
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; bench(cx + Math.cos(a) * 9.5, cz + Math.sin(a) * 9.5, -a + Math.PI / 2); }
    }
    // playground (>= 4500 m2): rubber floor, swing frame, slide tower, seesaw
    if (p.ar > 4500) for (let tries = 0; tries < 30; tries++) {
      const px = cx + (rnd() - 0.5) * Math.sqrt(p.ar) * 0.6, pz = cz + (rnd() - 0.5) * Math.sqrt(p.ar) * 0.6;
      if (Math.hypot(px - cx, pz - cz) < 14 || ![[-8, -6], [8, -6], [-8, 6], [8, 6]].every(([a, b]) => inside(poly, px + a, pz + b))) continue;
      const y = G(px, pz) + 0.09; box(px, y - 0.04, pz, 14, 0.06, 10, COL.rubber);
      box(px - 4, y, pz, 0.15, 2.4, 0.15, COL.metal); box(px - 2, y, pz, 0.15, 2.4, 0.15, COL.metal); box(px - 3, y + 2.35, pz, 2.3, 0.1, 0.1, COL.blue);
      box(px - 3.4, y + 0.5, pz, 0.35, 0.05, 0.3, COL.yel); box(px - 2.6, y + 0.5, pz, 0.35, 0.05, 0.3, COL.yel); props.box(px - 3, pz, 1.2, 0.3, 0, 2.4);
      box(px + 3, y, pz - 1, 1.6, 1.5, 1.6, COL.red); box(px + 3, y + 1.5, pz - 1, 1.8, 0.08, 1.8, COL.blue); box(px + 3, y + 0.3, pz + 1.3, 0.6, 0.08, 2.6, COL.yel); props.box(px + 3, pz - 1, 0.9, 0.9, 0, 1.6);
      box(px, y + 0.25, pz + 3, 3, 0.08, 0.3, COL.wood); box(px, y, pz + 3, 0.2, 0.3, 0.3, COL.metal);
      bench(px - 6, pz - 4, 0); bench(px + 6, pz + 4, 0); break;
    }
    if (!P.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat); this.scene.add(m); return m;
  }
}
