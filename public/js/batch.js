import * as THREE from 'three';

// Static batching: collapses the hundreds of tiny meshes of a finished, static prop group (plaza furniture, shopfronts, monuments...)
// into a handful of draw calls. Untextured opaque materials are baked to vertex colours and share one material per shading set-up;
// textured / transparent materials are merged per material. Transforms are baked relative to `root`, so moving/hiding `root` still works.
// Left untouched: InstancedMesh, sprites, lines, multi-material meshes, anything under `userData.noBatch`, anything hidden,
// and whatever `root.userData` (or a child group's userData) points at (animated parts such as fountain jets or windmill blades).
const PLAIN = new Set(['MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial', 'MeshBasicMaterial']);
const MAPS = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'bumpMap', 'lightMap', 'aoMap', 'envMap', 'specularMap', 'roughnessMap', 'metalnessMap', 'displacementMap'];
const shared = new Map();   // key -> vertex-colour material reused by every batch in the scene
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3();

function plainKey(m, ro) {
  if (!PLAIN.has(m.type) || m.transparent || m.opacity < 1 || m.alphaTest > 0 || !m.depthWrite || !m.depthTest || m.fog === false || m.wireframe || m.userData.noBatch) return null;
  for (const k of MAPS) if (m[k]) return null;
  return [m.type, m.side, m.flatShading ? 1 : 0, m.polygonOffset ? m.polygonOffsetFactor + '/' + m.polygonOffsetUnits : 0, m.emissive ? m.emissive.getHex() + '*' + (m.emissiveIntensity ?? 1) : 0,
    m.userData.fx || '', m.roughness ?? '', m.metalness ?? '', m.shininess ?? '', m.specular ? m.specular.getHex() : '', ro].join('|');
}

/** merge the static meshes below `root` in place. Returns { before, after } mesh counts (or null when there was nothing worth merging). */
export function batchStatic(root, { min = 2 } = {}) {
  root.updateMatrixWorld(true);
  const keep = new Set();   // objects referenced from userData anywhere in the tree = animated by their owner
  root.traverse(o => { for (const k in o.userData) { const v = o.userData[k]; if (v && v.isObject3D) v.traverse(c => keep.add(c)); } });
  const groups = new Map(); let before = 0;
  const visit = (o, hidden) => {
    if (!o.visible || o.userData.noBatch || keep.has(o)) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh && o !== root) {
      const g = o.geometry, mat = o.material;
      if (g && g.attributes.position && !Array.isArray(mat) && mat && !g.morphAttributes?.position && g.drawRange.start === 0 && g.drawRange.count === Infinity && !o.userData.merged) {
        const pk = plainKey(mat, o.renderOrder), key = pk ? 'P' + pk : 'M' + mat.uuid + '|' + o.renderOrder;
        let e = groups.get(key); if (!e) groups.set(key, e = { plain: !!pk, mat, ro: o.renderOrder, list: [] });
        e.list.push(o); before++;
      }
    }
    for (const c of o.children) visit(c, hidden);
  };
  visit(root, false);
  if (before < min) return null;
  _inv.copy(root.matrixWorld).invert();
  let after = 0;
  for (const [key, e] of groups) {
    if (e.list.length < 2) { after += e.list.length; continue; }
    let nv = 0, ni = 0;
    for (const o of e.list) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const useUv = !e.plain && !!(e.mat.map || e.mat.alphaMap);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = e.plain ? new Float32Array(nv * 3) : null, uv = useUv ? new Float32Array(nv * 2) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const o of e.list) {
      let g = o.geometry; if (!g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
      const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, U = g.attributes.uv, n = P.count;
      _m.multiplyMatrices(_inv, o.matrixWorld); _n.getNormalMatrix(_m); const flip = _m.determinant() < 0;
      const mc = o.material.color, vc = o.material.vertexColors && C;
      for (let i = 0; i < n; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(_m); pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
        _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor[(vo + i) * 3] = _v.x; nor[(vo + i) * 3 + 1] = _v.y; nor[(vo + i) * 3 + 2] = _v.z;
        if (col) { const r = mc ? mc.r : 1, gg = mc ? mc.g : 1, b = mc ? mc.b : 1; col[(vo + i) * 3] = r * (vc ? C.getX(i) : 1); col[(vo + i) * 3 + 1] = gg * (vc ? C.getY(i) : 1); col[(vo + i) * 3 + 2] = b * (vc ? C.getZ(i) : 1); }
        if (uv && U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      }
      const I = g.index, m = I ? I.count : n;
      for (let i = 0; i + 2 < m; i += 3) {
        const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, c = I ? I.getX(i + 2) : i + 2;
        idx[io++] = vo + a; idx[io++] = vo + (flip ? c : b); idx[io++] = vo + (flip ? b : c);
      }
      vo += n; o.removeFromParent();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(io === idx.length ? idx : idx.subarray(0, io), 1)); geo.computeBoundingSphere();
    let mat = e.mat;
    if (e.plain) { mat = shared.get(key); if (!mat) { mat = e.mat.clone(); mat.onBeforeCompile = e.mat.onBeforeCompile; mat.customProgramCacheKey = () => String(e.mat.userData.fx || ''); mat.color.setRGB(1, 1, 1); mat.vertexColors = true; shared.set(key, mat); } }
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = e.ro; mesh.matrixAutoUpdate = false; mesh.userData.merged = true;
    root.add(mesh); mesh.updateMatrixWorld(true); after++;
  }
  root.userData.batched = true;
  return { before, after };
}
