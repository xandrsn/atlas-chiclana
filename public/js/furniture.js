import * as THREE from 'three';
import { toLocal } from './geo.js';
import { props } from './props.js';

// Promenade street furniture from OSM nodes (data/promenade_raw.json): benches, picnic tables, showers, fountains, toilets, lifeguard towers, bollards.
// One merged vertex-coloured mesh built once (a few dozen props); benches/tables/towers are solid.
const COL = { wood: [0.45, 0.3, 0.17], metal: [0.25, 0.27, 0.3], white: [0.9, 0.9, 0.88], red: [0.75, 0.2, 0.15], stone: [0.62, 0.6, 0.56], blue: [0.2, 0.45, 0.7] };
export class Furniture {
  constructor(scene, hf, raw) {
    const P = [], C = [], push = (x, y, z, w, h, d, col, rot = 0) => {   // axis-aligned-in-local box centred (x,z), base y
      const c = Math.cos(rot), s = Math.sin(rot), X = [-1, 1], pts = [];
      for (const a of X) for (const b of X) for (const k of [0, 1]) pts.push([x + (a * w / 2) * c + (b * d / 2) * s, y + k * h, z - (a * w / 2) * s + (b * d / 2) * c]);
      const f = (i, j, k, l) => { for (const t of [[i, j, k], [i, k, l]]) for (const v of t) { P.push(...pts[v]); C.push(...col); } };
      f(0, 1, 3, 2); f(4, 6, 7, 5); f(0, 4, 5, 1); f(2, 3, 7, 6); f(0, 2, 6, 4); f(1, 5, 7, 3);
    };
    for (const e of raw.coast || []) {
      if (e.type !== 'node') continue;
      const t = e.tags || {}, [x, z] = toLocal(e.lon, e.lat), y = hf.height(x, z), rot = (e.id % 628) / 100, k = t.amenity || t.leisure || t.barrier || t.emergency;
      if (k === 'bench') { push(x, y + 0.42, z, 1.6, 0.08, 0.45, COL.wood, rot); push(x, y + 0.75, z - 0.2, 1.6, 0.4, 0.07, COL.wood, rot); props.box(x, z, 0.8, 0.25, rot, 0.9); }
      else if (k === 'picnic_table') { push(x, y + 0.72, z, 1.8, 0.06, 0.8, COL.wood, rot); props.box(x, z, 0.9, 0.7, rot, 0.8); }
      else if (k === 'shower') push(x, y, z, 0.3, 2.2, 0.3, COL.metal);
      else if (k === 'drinking_water' || k === 'fountain') { push(x, y, z, 0.4, 0.9, 0.4, COL.stone); props.circle(x, z, 0.3, 0.9); }
      else if (k === 'toilets') { push(x, y, z, 3, 2.6, 2.5, COL.white, rot); props.box(x, z, 1.5, 1.25, rot, 2.6); }
      else if (k === 'lifeguard') { push(x, y + 1.6, z, 1.6, 1.2, 1.6, COL.red, rot); for (const [a, b] of [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]]) push(x + a, y, z + b, 0.12, 1.6, 0.12, COL.white); props.box(x, z, 0.8, 0.8, rot, 2.8); }
      else if (k === 'bollard') { push(x, y, z, 0.2, 0.8, 0.2, COL.metal); props.circle(x, z, 0.12, 0.8); }
    }
    if (!P.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.frustumCulled = false; scene.add(m);
  }
}
