// Blender pedestrian models (tools/blender/build_ped.py -> public/v2/assets/peds/<male|female|elderly|child>.glb). preloadPedGLBs() runs once at boot so
// buildPed / Rig.geometry stay sync; with no GLB (or a failed load) the procedural meshes of pedmesh.js remain. A GLB is a kit of pieces named
// LOD<n>__<slot>__<part>: the recipe picks the pieces, each slot (skin / top / bottom / shoes / hair / acc) is tinted with the recipe colour, the light is
// baked like Builder.geometry(), and the bind pose is warped to the build (height / width / stoop) with the skin weights, so the same rig drives it.
import * as THREE from 'three';
import { shadeOf } from '../lowpoly.js';

export const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const REF = { male: [1.76, 1, 0], female: [1.76, 1, 0], elderly: [1.62, 1.08, 0.05], child: [1.6, 0.86, 0] };   // reference build (height, width, stoop) of each body
const BODY = new Map();   // body -> [Map('slot__part' -> { pos, col, idx, si, sw }) per LOD]
const DIM = ([h, w, z]) => ({ build: { height: h, width: w, stoop: z } });
const KNOWN = ['stripe', 'tie', 'cap', 'hat', 'backpack', 'camera', 'bag', 'cane', 'apron', 'tray', 'sunglasses'];

export const bodyOf = p => p.build.id === 'old' ? 'elderly' : p.build.id === 'teen' ? 'child' : p.bottom.part === 'skirt' || p.hair.part === 'long' || p.hair.part === 'bun' ? 'female' : 'male';

/** glTF scene of one body -> pieces (skin joints remapped to rig bone indices) */
export function registerPedGLB(body, root) {
  const lods = [new Map(), new Map()];
  root.traverse(o => {
    const m = /^LOD(\d)__(\w+?)__(.+)$/.exec(o.name); if (!o.isMesh || !m) return;
    const g = o.geometry, A = g.attributes, n = A.position.count, map = o.skeleton.bones.map(b => BONE_NAMES.indexOf(b.name));
    if (map.includes(-1)) throw new Error('ped glb: unknown bone in ' + body);
    const si = new Float32Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { for (let j = 0; j < 4; j++) { si[i * 4 + j] = map[A.skinIndex.getComponent(i, j)]; sw[i * 4 + j] = A.skinWeight.getComponent(i, j); } for (let j = 0; j < 3; j++) col[i * 3 + j] = A.color.getComponent(i, j); }
    lods[+m[1]].set(m[2] + '__' + m[3], { pos: Float32Array.from(A.position.array), col, idx: Uint32Array.from(g.index.array), si, sw });
  });
  BODY.set(body, lods);
}

/** recipe -> pieces [key 'slot__part', tint colour for accessories] */
export function pieces(p) {
  const t = p.top.part, b = p.bottom.part, L = ['skin__head', 'skin__neck', 'skin__hands', 'fixed__face', 'hair__brows', 'bottom__pelvis', 'shoes__shoes', 'fixed__sole', 'top__' + t, 'hair__' + p.hair.part].map(k => [k]);
  const add = (k, c) => L.push([k, c]);
  if (t === 'tshirt' || t === 'polo') add('skin__arm_low'); if (t === 'polo' || t === 'jacket' || t === 'suit') add('fixed__' + t + '_trim');
  if (b === 'trousers') add('bottom__trousers'); else { add('skin__leg_low'); add(b === 'shorts' ? 'bottom__shorts' : 'bottom__skirt'); }   // the skirt covers the upper legs
  for (const a of p.acc) if (KNOWN.includes(a.part)) { add('acc__' + a.part, a.color); add('fixed__' + a.part + '_trim'); }
  return L;
}

const _c = new THREE.Color(), _n = new THREE.Vector3();
/** recipe + LOD -> geometry with position, normal, color, aPaint, aBone, aPivot (the lowpoly shader walk of peds/pedmesh.js) and skinIndex / skinWeight (peds/rig.js), or null (no GLB) */
export function pedGLBGeometry(p, lod, dims, jointsOf) {
  const body = bodyOf(p), B = BODY.get(body)?.[lod]; if (!B) return null;
  const rd = dims(DIM(REF[body])), d = dims(p), Jr = jointsOf(rd), J = jointsOf(d), same = REF[body][0] === p.build.height && REF[body][1] === p.build.width && REF[body][2] === (p.build.stoop || 0);
  const sx = d.w / rd.w, sy = d.k / rd.k, sz = Math.max(1, d.w * 0.95) / Math.max(1, rd.w * 0.95), tint = { skin: p.skin, top: p.top.color, bottom: p.bottom.color, shoes: p.shoes, hair: p.hair.color };
  const out = { position: [], normal: [], color: [], aPaint: [], aBone: [], aPivot: [], skinIndex: [], skinWeight: [] }; let tris = 0;
  const PIV = [[0, 0, 0], J[11], J[14], J[5], J[8]], group = b => b >= 11 && b <= 13 ? 1 : b >= 14 ? 2 : b >= 5 && b <= 7 ? 3 : b >= 8 && b <= 10 ? 4 : 0;
  for (const [key, acc] of pieces(p)) {
    const q = B.get(key); if (!q) continue;
    const slot = key.split('__')[0], tc = slot === 'acc' ? acc : tint[slot], n = q.pos.length / 3, P = new Float32Array(q.pos);
    if (!same) for (let i = 0; i < n; i++) {   // warp: every bone carries its joint to the new place and scales the offset from it
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; let a = 0, b = 0, c = 0;
      for (let j = 0; j < 4; j++) { const w = q.sw[i * 4 + j]; if (!w) continue; const r = Jr[q.si[i * 4 + j]], t = J[q.si[i * 4 + j]]; a += w * (t[0] + (x - r[0]) * sx); b += w * (t[1] + (y - r[1]) * sy); c += w * (t[2] + (z - r[2]) * sz); }
      P[i * 3] = a; P[i * 3 + 1] = b; P[i * 3 + 2] = c;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(q.idx, 1)); g.computeVertexNormals();   // smooth inside a piece
    const N = g.attributes.normal, I = q.idx;
    if (slot !== 'fixed') _c.set(tc);
    for (let t = 0; t < I.length; t++) {
      const i = I[t]; _n.fromBufferAttribute(N, i); const s = shadeOf(_n), grey = q.col[i * 3];
      out.position.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); out.normal.push(_n.x, _n.y, _n.z);
      if (slot === 'fixed') out.color.push(q.col[i * 3] * s, q.col[i * 3 + 1] * s, q.col[i * 3 + 2] * s); else out.color.push(_c.r * grey * s, _c.g * grey * s, _c.b * grey * s);
      out.aPaint.push(slot === 'top' ? grey * s : 0);
      let best = 0, bw = -1; for (let j = 0; j < 4; j++) { out.skinIndex.push(q.si[i * 4 + j]); out.skinWeight.push(q.sw[i * 4 + j]); if (q.sw[i * 4 + j] > bw) { bw = q.sw[i * 4 + j]; best = q.si[i * 4 + j]; } }
      const gr = group(best); out.aBone.push(gr); out.aPivot.push(...PIV[gr]);
    }
    tris += I.length / 3;
  }
  const g = new THREE.BufferGeometry(), size = { position: 3, normal: 3, color: 3, aPaint: 1, aBone: 1, aPivot: 3, skinIndex: 4, skinWeight: 4 };
  for (const k in out) g.setAttribute(k, new THREE.Float32BufferAttribute(out[k], size[k]));
  g.computeBoundingSphere(); g.computeBoundingBox(); g.userData = { triangles: tris, glb: true, body };
  return g;
}

/** fetch the bodies listed in assets/peds/index.json (browser; errors leave the procedural meshes) */
export async function preloadPedGLBs(base = new URL('../assets/peds/', import.meta.url)) {
  try {
    const ids = await (await fetch(new URL('index.json', base))).json(); if (!ids.length) return;
    const { GLTFLoader } = await import('/vendor/three/examples/jsm/loaders/GLTFLoader.js'), loader = new GLTFLoader();
    await Promise.all(ids.map(id => loader.loadAsync(new URL(id + '.glb', base).href).then(g => registerPedGLB(id, g.scene)).catch(e => console.warn('ped glb', id, e))));
  } catch (e) { console.warn('ped glbs', e); }
}
