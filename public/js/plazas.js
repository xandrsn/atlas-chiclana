import * as THREE from 'three';
import { props } from './props.js';
// Generic procedural squares from data/plazas.json (OSM geometry, scripts/plazas.mjs). Not replicas: paving style, benches, lamps, trees and a fountain
// are chosen deterministically per plaza. Plaza Mayor has its own design in monuments.js. Built lazily within BUILD m, hidden beyond SHOW m.
const BUILD = 450, SHOW = 600;
const mat = c => new THREE.MeshLambertMaterial({ color: c });
const PAVE = [mat(0xd6cdb8), mat(0xc9a477), mat(0xb9654a), mat(0xcfcbc2)];   // stone, albero, brick, light granite
const wood = mat(0x7a5a3a), iron = mat(0x2c2f33), leaf = mat(0x4f8a3a), trunk = mat(0x6b4a2e), stone = mat(0xcfc8b6), water = new THREE.MeshLambertMaterial({ color: 0x7fd0e8, transparent: true, opacity: 0.8 }), lampG = new THREE.MeshBasicMaterial({ color: 0xfff1c0 });
const gBench = new THREE.BoxGeometry(1.7, 0.45, 0.5), gLamp = new THREE.CylinderGeometry(0.08, 0.12, 4, 6), gTrunk = new THREE.CylinderGeometry(0.15, 0.2, 2.2, 6), gCrown = new THREE.SphereGeometry(1.7, 8, 6);
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const inside = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
function dist2edge(P, x, z) { let m = 1e9; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); m = Math.min(m, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return m; }

function build(scene, hf, pl) {
  const P = pl.poly, g = new THREE.Group(), r = hash(pl.name + pl.id);
  let hy = 0; for (const [x, z] of P) hy += hf.height(x, z); hy = hy / P.length + 0.12;
  const tri = THREE.ShapeUtils.triangulateShape(P.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap(([x, z]) => [x, hy, z]), 3)); geo.setIndex(tri.flat()); geo.computeVertexNormals();
  const pm = PAVE[/albero/i.test(pl.surface || '') || /santa ana/i.test(pl.name) ? 1 : Math.floor(r * 4) % 4].clone(); pm.side = THREE.DoubleSide; pm.polygonOffset = true; pm.polygonOffsetFactor = -6; pm.polygonOffsetUnits = -6;
  g.add(new THREE.Mesh(geo, pm));
  let xs = [1e9, -1e9], zs = [1e9, -1e9]; for (const [x, z] of P) { xs = [Math.min(xs[0], x), Math.max(xs[1], x)]; zs = [Math.min(zs[0], z), Math.max(zs[1], z)]; }
  const spots = []; const step = pl.area > 2500 ? 9 : 6;
  for (let x = xs[0]; x < xs[1]; x += step) for (let z = zs[0]; z < zs[1]; z += step) { if (!inside(P, x, z)) continue; const d = dist2edge(P, x, z); spots.push({ x, z, d }); }
  const edge = spots.filter(s => s.d > 1.2 && s.d < step * 0.7), inner = spots.filter(s => s.d >= step * 0.7);
  const nb = Math.min(edge.length >> 1, 24), nt = Math.min(edge.length, 40), nl = Math.min(edge.length >> 1, 16);
  const benches = new THREE.InstancedMesh(gBench, wood, nb), lamps = new THREE.InstancedMesh(gLamp, iron, nl), trunks = new THREE.InstancedMesh(gTrunk, trunk, nt), crowns = new THREE.InstancedMesh(gCrown, leaf, nt);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
  const put = (im, i, x, y, z, a = 0, s = s1) => { q.setFromAxisAngle(up, a); m.compose(new THREE.Vector3(x, y, z), q, s); im.setMatrixAt(i, m); };
  for (let i = 0; i < nb; i++) { const s = edge[(i * 2 + 1) % edge.length]; put(benches, i, s.x, hy + 0.23, s.z, hash(pl.id + i) * 6.28); }
  for (let i = 0; i < nl; i++) { const s = edge[(i * 2) % edge.length]; put(lamps, i, s.x, hy + 2, s.z); }
  for (let i = 0; i < nt; i++) { const s = i % 2 ? edge[i % edge.length] : (inner.length ? inner[i % inner.length] : edge[i % edge.length]); put(trunks, i, s.x, hy + 1.1, s.z); put(crowns, i, s.x, hy + 3.4, s.z, 0, new THREE.Vector3(1, 0.8, 1)); }
  g.add(benches, lamps, trunks, crowns);
  for (let i = 0; i < nb; i++) { const s = edge[(i * 2 + 1) % edge.length]; props.box(s.x, s.z, 0.9, 0.3, hash(pl.id + i) * 6.28, hy + 0.5); }
  for (let i = 0; i < nl; i++) { const s = edge[(i * 2) % edge.length]; props.circle(s.x, s.z, 0.2, hy + 4); }
  for (let i = 0; i < nt; i++) { const s = i % 2 ? edge[i % edge.length] : (inner.length ? inner[i % inner.length] : edge[i % edge.length]); props.circle(s.x, s.z, 0.3, hy + 3); }
  if (pl.area > 1500 && inner.length) {   // central fountain
    let c = inner[0], best = 1e9; const cx = pl.c[0], cz = pl.c[1]; for (const s of inner) { const d = Math.hypot(s.x - cx, s.z - cz); if (d < best) { best = d; c = s; } }
    const f = new THREE.Group(); const bs = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.7, 16), stone), wt = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.1, 16), water), pil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2, 8), stone);
    bs.position.y = 0.35; wt.position.y = 0.68; pil.position.y = 1.5; f.add(bs, wt, pil); f.position.set(c.x, hy, c.z); g.add(f); props.circle(c.x, c.z, 3.2, hy + 2.2);
  }
  scene.add(g); return g;
}

export class Plazas {
  constructor(scene, hf, list) { this.scene = scene; this.hf = hf; this.items = list.filter(p => p.id !== 'w183510852').map(p => ({ p, g: null })); }   // Gran Plaza sobre el Río Iro is a real deck (world.js + stairs.js GRAN_PLAZA)
  update(cam) {
    let built = 0;
    for (const it of this.items) {
      const d = Math.hypot(it.p.c[0] - cam.x, it.p.c[1] - cam.z);
      if (!it.g && d < BUILD * (window.__lodK ?? 1) && built++ < 1) it.g = build(this.scene, this.hf, it.p);
      if (it.g) it.g.visible = d < SHOW * (window.__lodK ?? 1);
    }
  }
}
