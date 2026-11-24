// Procedural low-poly vehicle meshes from data/vehicles/<id>.json (body, glass, wheels, lights), 2 LODs, one geometry per model+LOD.
// Frame: x right, y up, z forward (+z = front); origin on the ground at the centre of the wheelbase.
// InstancedMesh: share buildVehicle(spec, lod) + makeLowpolyMaterial(); setColorAt(i, colour from spec.palette) repaints the body only.
// Art (own design): faceted body (sides tuck in at the sill and the shoulder line), wheel arches, door seams, mirrors, made-up plates,
// rims with a cap; lamps carry LAMP codes so the shared shader lights them (headlights at night, brake, indicators: setLights).
// Body options in the JSON "body" block: open (convertible), bed (pickup), rack + bullbar (off-roader), cargo, stripe, roofBox.
import * as THREE from 'three';
import { Builder, rng, pick, LAMP, shadeOf } from '../lowpoly.js';
import { heli } from './helimesh.js';
import { dozer } from './dozermesh.js';
export { makeLowpolyMaterial, setLights } from '../lowpoly.js';

const GLASS = '#2b3742', TIRE = '#1c1c1c', RIM = '#a3a7ab', TRIM = '#2c2c2e', HEAD = '#fff3cc', TAIL = '#b3121a', PLATE = '#ecebe4', GRILLE = '#18191b';
const ARCH = '#121213', SEAM = '#1a1b1d', AMBER = '#e08a1c', CAP = '#55595e', INTERIOR = '#232220', SEAT = '#3b3430', BAND = '#2440a0';
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

/** clip a convex [[z,y]] polygon to z >= a (keep = 1) or z <= a (keep = -1) */
function clipZ(poly, a, keep) {
  const out = [], inside = p => (p[0] - a) * keep >= 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) { const t = (a - p[0]) / (q[0] - p[0]); out.push([a, lerp(p[1], q[1], t)]); }
  }
  return out;
}
/** shrink a convex [[z,y]] polygon by t (each edge moved inwards, corners re-intersected) */
function inset(P, t) {
  const n = P.length, s = Math.sign(P.reduce((acc, p, i) => { const q = P[(i + 1) % n]; return acc + p[0] * q[1] - q[0] * p[1]; }, 0));
  const lines = P.map((p, i) => { const q = P[(i + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]), d = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; return { o: [p[0] - s * d[1] * t, p[1] + s * d[0] * t], d }; });
  return lines.map((B, i) => {
    const A = lines[(i + n - 1) % n], c = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    const k = ((B.o[0] - A.o[0]) * B.d[1] - (B.o[1] - A.o[1]) * B.d[0]) / c;
    return [A.o[0] + A.d[0] * k, A.o[1] + A.d[1] * k];
  });
}
const dedupe = pts => pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02; });

/** random body colour from the model palette (seeded) */
export const pickColor = (spec, seed) => new THREE.Color(pick(rng(seed), spec.palette));

/** tyre + rim (outer face): rim disc, darker hub cap and five spoke slots at LOD 0 */
function wheel(B, x, y, z, r, w, lod, outer) {
  B.style(TIRE); B.cylX(x, y, z, r, w, lod ? 6 : 18, lod ? null : RIM, outer);
  if (lod) return;
  const xo = x + outer * (w / 2 + 0.008), ctr = v3(x, y, z), ring = (rr, n, a0 = 0) => Array.from({ length: n }, (_, i) => v3(xo, y + rr * Math.cos(a0 + i / n * 2 * Math.PI), z + rr * Math.sin(a0 + i / n * 2 * Math.PI)));
  B.style(CAP); B.ctr = ctr; B.poly(ring(r * 0.2, 6)); B.ctr = null;
  B.style(ARCH);
  for (let k = 0; k < 5; k++) { const a = k / 5 * 2 * Math.PI, q = (rr, da) => v3(xo - outer * 0.002, y + rr * Math.cos(a + da), z + rr * Math.sin(a + da)); B.quad(q(r * 0.3, -0.25), q(r * 0.3, 0.25), q(r * 0.5, 0.22), q(r * 0.5, -0.22), v3(x - outer, y, z)); }
}

/** wheel geometry on its own (player car spins/steers wheels): centred, axis X */
export function buildWheel(spec, lod = 0) {
  const d = spec.dims, B = new Builder();
  wheel(B, 0, 0, 0, d.wheelRadius, d.wheelWidth, lod, 1);
  return B.geometry();
}

/** wheel centres [[x,y,z]...] for physics/suspension, same frame as the body */
export function wheelPositions(spec) {
  if (spec.kind === 'dozer') return [];   // tracks: dozermesh.js
  const d = spec.dims, z = d.wheelbase / 2, r = d.wheelRadius;
  if (spec.kind === 'bike') return [[0, r, z], [0, r, -z]];
  const x = d.track / 2;
  return [[-x, r, z], [x, r, z], [-x, r, -z], [x, r, -z]];
}

/** -> BufferGeometry for one model at lod 0 (near) or 1 (far). wheels=false leaves them out (use buildWheel) */
export function buildVehicle(spec, lod = 0, { wheels = true, part = 'all' } = {}) {
  const glb = spec.kind === 'car' && GLB.get(spec.id)?.[lod];
  if (glb) return fromGLB(glb, spec, lod, wheels);
  const B = new Builder();
  (spec.kind === 'bike' ? bike : spec.kind === 'heli' ? heli : spec.kind === 'dozer' ? (b, s, l) => dozer(b, s, l, part) : car)(B, spec, lod);
  if (wheels && spec.kind !== 'heli' && spec.kind !== 'dozer') for (const [x, y, z] of wheelPositions(spec)) wheel(B, x, y, z, spec.dims.wheelRadius, spec.dims.wheelWidth, lod, Math.sign(x) || 1);
  const g = B.geometry({ normals: spec.kind === 'heli' ? creased : null }); g.userData = { id: spec.id, lod, triangles: B.triangles };
  return g;
}

// ---- Blender models (tools/blender/build_vehicle.py -> public/v2/assets/vehicles/<id>.glb). preloadGLBs() runs once at boot so buildVehicle stays sync;
// a model without a GLB (or if loading fails) keeps the procedural mesh. The GLB is converted to the same attributes (position, normal, color, aPaint).
const GLB = new Map();   // id -> [lod0 geometry, lod1 geometry]
export function useGLB(id, geos) { GLB.set(id, geos); }

/** smooth normals over edges softer than ~40 degrees on a triangle soup (number[] positions), so panels read as pressed steel and creases stay */
export function creased(pos, cos = 0.77) {
  const n = pos.length / 3, F = new Float32Array(n), at = new Map(), keys = [], out = new Float32Array(n * 3);   // F: face normals x area, 3 per triangle
  for (let t = 0; t < n; t += 3) {
    const p = k => pos.slice((t + k) * 3, (t + k) * 3 + 3), a = p(0), b = p(1), c = p(2), u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
    F[t] = u[1] * w[2] - u[2] * w[1]; F[t + 1] = u[2] * w[0] - u[0] * w[2]; F[t + 2] = u[0] * w[1] - u[1] * w[0];
    for (const q of [a, b, c]) { const k = q.map(v => Math.round(v * 1000)).join(); keys.push(k); if (!at.has(k)) at.set(k, []); at.get(k).push(t); }
  }
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, L = Math.hypot(F[t], F[t + 1], F[t + 2]) || 1, s = [0, 0, 0];
    for (const o of at.get(keys[i])) { const l = Math.hypot(F[o], F[o + 1], F[o + 2]); if (l && (F[t] * F[o] + F[t + 1] * F[o + 1] + F[t + 2] * F[o + 2]) >= cos * l * L) for (let k = 0; k < 3; k++) s[k] += F[o + k]; }
    const m = Math.hypot(...s) || 1; for (let k = 0; k < 3; k++) out[i * 3 + k] = s[k] / m;
  }
  return out;
}

/** glTF scene -> [LOD0 + door nodes merged (closed shell; cutDoor re-cuts the door), LOD1]: non-indexed, colour x baked light, aPaint (_PAINT: 1 paint -> baked light, 0 fixed, < 0 LAMP code) */
export function glbGeometries(root) {
  root.updateMatrixWorld(true);
  return [0, 1].map(lod => {
    const nodes = [root.getObjectByName('LOD' + lod), ...lod ? [] : root.children.filter(c => /^door_/.test(c.name))], pos = [], col = [], paint = [], n = v3(0, 0, 0);
    for (const node of nodes) node.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      const P = g.attributes.position, C = g.attributes.color, K = g.attributes._paint, cs = C.itemSize;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); col.push(C.getX(i), C.getY(i), C.getZ(i)); paint.push(K.getX(i)); if (cs < 3) throw new Error('GLB colour');
      }
    });
    const N = creased(pos);
    for (let i = 0; i < paint.length; i++) { const s = shadeOf(n.fromArray(N, i * 3)); for (let k = 0; k < 3; k++) col[i * 3 + k] *= s; if (paint[i] > 0) paint[i] = s; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 1));
    return g;
  });
}

/** fetch the models listed in assets/vehicles/index.json and register them (browser; errors leave the procedural meshes) */
export async function preloadGLBs(base = new URL('../assets/vehicles/', import.meta.url)) {
  try {
    const ids = await (await fetch(new URL('index.json', base))).json(); if (!ids.length) return;
    const { GLTFLoader } = await import('/vendor/three/examples/jsm/loaders/GLTFLoader.js'), loader = new GLTFLoader();   // its own imports: 'three' (importmap) + a relative BufferGeometryUtils
    await Promise.all(ids.map(id => loader.loadAsync(new URL(id + '.glb', base).href).then(g => useGLB(id, glbGeometries(g.scene))).catch(e => console.warn('vehicle glb', id, e))));
  } catch (e) { console.warn('vehicle glbs', e); }
}

function fromGLB(src, spec, lod, wheels) {
  const parts = [src];
  if (wheels) { const B = new Builder(); for (const [x, y, z] of wheelPositions(spec)) wheel(B, x, y, z, spec.dims.wheelRadius, spec.dims.wheelWidth, lod, Math.sign(x) || 1); parts.push(B.geometry()); }
  const g = new THREE.BufferGeometry(), N = parts.reduce((a, p) => a + p.attributes.position.count, 0);
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aPaint', 1]]) {
    const a = new Float32Array(N * size); let o = 0; for (const p of parts) { a.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
    g.setAttribute(name, new THREE.BufferAttribute(a, size));
  }
  g.computeBoundingSphere(); g.computeBoundingBox(); g.userData = { id: spec.id, lod, triangles: N / 3, glb: true };
  return g;
}

/** flat decal on a side of the body at x = sx * x (pts [[z, y]...] convex), facing outwards */
const side = (B, sx, x, pts, col, code = false) => { B.style(col, code); B.quad(...pts.map(([z, y]) => v3(sx * x, y, z)), v3(0, pts[0][1], pts[0][0])); };

function car(B, spec, lod) {
  const d = spec.dims, b = spec.body, L = d.length, W = d.width, hw = W / 2;
  const zR = -L / 2, zF = L / 2, sill = d.groundClearance, roof = b.roof ?? d.height, paint = [spec.palette[0], true];
  const zc1 = zF - b.hood, zc0 = zR + b.deck, zr1 = zc1 - b.wsRake, zr0 = zc0 + b.rearRake;

  // lower body: chamfered nose/tail, hood rising to the windscreen base, deck falling to the tail. Faceted: the side tucks in at the
  // sill and at the shoulder (belt), so the flat-shaded side caps break into planes
  const lower = dedupe([[zR, sill + 0.1], [zR + 0.1, sill], [zF - 0.12, sill], [zF, sill + 0.12], [zF - 0.06, b.noseH], [zc1, b.belt], [zc0, b.belt], [zR + 0.04, b.tailH]]);
  const tuck = Math.min(0.06, hw * 0.05), lhw = y => y < sill + 0.05 ? hw - tuck : y > Math.min(b.noseH, b.tailH) - 0.02 ? hw - tuck * 0.6 : hw;
  B.style(...paint).prism(lower, lhw);

  // cabin: windscreen / roof / rear window; sides narrower at the top (tumblehome). Open top: windscreen frame, tub and seats only
  const cab = [[zc0, b.belt], [zc1, b.belt], [zr1, roof], [zr0, roof]];
  const chw = y => lerp(hw - 0.03 - tuck * 0.6, hw - b.tumble, (y - b.belt) / (roof - b.belt));
  if (b.open) {
    const ws = [[zc1 - 0.05, b.belt], [zc1, b.belt], [zc1 - b.wsRake * 0.75, b.belt + 0.38], [zc1 - b.wsRake * 0.75 - 0.06, b.belt + 0.38]];
    B.style(GLASS, LAMP.glass).prism(ws, () => hw - 0.08, i => i === 2 ? [TRIM] : undefined, () => [TRIM]);
    B.style(INTERIOR).box(-hw + 0.1, hw - 0.1, b.belt - 0.2, b.belt + 0.004, zc0 + 0.1, zc1 - 0.1);
    if (!lod) for (const sx of [-1, 1]) {
      B.style(SEAT).box(sx * 0.36 - 0.22, sx * 0.36 + 0.22, b.belt - 0.1, b.belt + 0.42, zc1 - b.wsRake - 0.85, zc1 - b.wsRake - 0.7);
      B.style(SEAT).box(sx * 0.36 - 0.1, sx * 0.36 + 0.1, b.belt + 0.42, b.belt + 0.6, zc1 - b.wsRake - 0.83, zc1 - b.wsRake - 0.72);
    }
  } else {
    B.prism(cab, chw, i => i === 0 ? null : i === 2 ? undefined : [GLASS, LAMP.glass], () => lod ? [GLASS, LAMP.glass] : undefined);
    if (!lod) sideWindows(B, cab, chw, b.windows, b.belt, roof);
  }

  if (b.cargo) { const c = b.cargo; B.style(c.color).box(-hw, hw, c.floor, c.height, zR, zR + c.length); }
  if (b.bed) {   // pickup: open bed behind the cab (dark floor + rim on the deck)
    const z1 = zc0 - 0.08, z0 = zR + 0.08; B.style(INTERIOR).quad(v3(-hw + 0.08, b.belt + 0.004, z0), v3(hw - 0.08, b.belt + 0.004, z0), v3(hw - 0.08, b.belt + 0.004, z1), v3(-hw + 0.08, b.belt + 0.004, z1), v3(0, 0, (z0 + z1) / 2));
    for (const sx of [-1, 1]) B.style(...paint).box(sx * (hw - 0.04) - 0.04, sx * (hw - 0.04) + 0.04, b.belt, b.belt + 0.08, z0 - 0.08, z1);
    B.style(...paint).box(-hw, hw, b.belt, b.belt + 0.08, zR, zR + 0.09);
  }
  if (b.stripe) { const s = b.stripe, z0 = zR + 0.15, z1 = zF - 0.3; for (const sx of [-1, 1]) side(B, sx, hw + 0.006, [[z0, s.y0], [z1, s.y0], [z1, s.y1], [z0, s.y1]], s.color); }
  if (b.roofBox) {
    const r = b.roofBox, zm = (zr0 + zr1) / 2, cols = r.colors;
    cols.forEach((c, i) => { const x0 = lerp(-r.w / 2, r.w / 2, i / cols.length), x1 = lerp(-r.w / 2, r.w / 2, (i + 1) / cols.length); B.style(c).box(x0, x1, roof, roof + r.h, zm - r.d / 2, zm + r.d / 2); });
  }
  if (b.rack && !b.open) for (const sx of [-1, 1]) B.style(TRIM).box(sx * (hw - b.tumble - 0.06) - 0.03, sx * (hw - b.tumble - 0.06) + 0.03, roof, roof + 0.07, zr0 + 0.05, zr1 - 0.05);

  // lamps (both LODs: the traffic's headlights carry at night). Front: headlights + grille on the nose face; rear: tail lights + plate
  const lw = Math.min(0.3, W * 0.17), face = (zA, yA, zB, yB, t0, t1, x0, x1, col, out, code) => {
    const za = lerp(zA, zB, t0) + out, ya = lerp(yA, yB, t0), zb = lerp(zA, zB, t1) + out, yb = lerp(yA, yB, t1);
    B.style(col, code).quad(v3(x0, ya, za), v3(x1, ya, za), v3(x1, yb, zb), v3(x0, yb, zb), v3((x0 + x1) / 2, (ya + yb) / 2, za - out * 10));
  };
  const fA = [zF, sill + 0.12, zF - 0.06, b.noseH], rA = [zR, sill + 0.1, zR + 0.04, b.tailH];
  for (const sx of [-1, 1]) {
    face(...fA, 0.55, 0.9, sx * (hw - 0.07), sx * (hw - 0.07 - lw), HEAD, 0.012, LAMP.head);
    face(...rA, 0.55, 0.9, sx * (hw - 0.06), sx * (hw - 0.06 - lw * 0.8), TAIL, -0.012, LAMP.tail);
  }
  if (lod) return;
  for (const sx of [-1, 1]) {   // indicators at the outer corners, front and rear (facing +z, left = +x)
    const code = sx > 0 ? LAMP.indL : LAMP.indR;
    face(...fA, 0.32, 0.5, sx * (hw - 0.05), sx * (hw - 0.05 - lw * 0.55), AMBER, 0.013, code);
    face(...rA, 0.36, 0.53, sx * (hw - 0.06), sx * (hw - 0.06 - lw * 0.5), AMBER, -0.013, code);
  }
  face(...fA, 0.5, 0.85, -(hw - 0.12 - lw), hw - 0.12 - lw, GRILLE, 0.01);
  plate(B, face, rA, -0.013); plate(B, face, fA, 0.013, 0.08, 0.32);
  B.style(TRIM).box(-hw - 0.01, hw + 0.01, sill - 0.02, sill + 0.13, zF - 0.12, zF + 0.025);
  B.style(TRIM).box(-hw - 0.01, hw + 0.01, sill - 0.02, sill + 0.12, zR - 0.025, zR + 0.1);
  B.style(TRIM).box(hw * 0.45, hw * 0.45 + 0.07, sill + 0.02, sill + 0.09, zR - 0.05, zR + 0.2);   // exhaust
  if (b.bullbar) { B.style(TRIM).box(-hw * 0.7, hw * 0.7, sill + 0.15, b.noseH + 0.05, zF + 0.03, zF + 0.06); B.style(TRIM).box(-hw * 0.7, hw * 0.7, sill + 0.15, sill + 0.25, zF + 0.03, zF + 0.08); }

  // sides: dark wheel arches, door seams + handles, mirrors by the windscreen base
  const r = d.wheelRadius, zw = d.wheelbase / 2, by = Math.min(b.belt - 0.06, 2 * r + 0.12);
  for (const sx of [-1, 1]) {
    for (const z of [zw, -zw]) side(B, sx, hw + 0.004, [[z - r * 1.2, sill], [z + r * 1.2, sill], [z + r * 0.8, by], [z - r * 0.8, by]], ARCH);
    if (spec.archetype === 'autobus' || b.cargo) continue;
    const doors = b.open || b.windows.panes < 2 || b.bed ? [zc1 - 0.05, zc1 - b.wsRake - 0.6] : [zc1 - 0.05, (zc0 + zc1) / 2 + 0.1, zc0 + 0.2];
    for (const z of doors) side(B, sx, hw + 0.005, [[z - 0.012, sill + 0.06], [z + 0.012, sill + 0.06], [z + 0.012, b.belt - 0.02], [z - 0.012, b.belt - 0.02]], SEAM);
    for (let k = 1; k < doors.length; k++) { const z = doors[k] + 0.12; side(B, sx, hw + 0.007, [[z, b.belt - 0.12], [z + 0.14, b.belt - 0.12], [z + 0.14, b.belt - 0.08], [z, b.belt - 0.08]], TRIM); }
    const mx = sx * (hw + 0.02), mz = zc1 - 0.12;
    B.style(TRIM).box(Math.min(mx, sx * (hw + 0.05)), Math.max(mx, sx * (hw + 0.05)), b.belt + 0.04, b.belt + 0.06, mz - 0.03, mz + 0.03);
    B.style(...paint).box(Math.min(sx * (hw + 0.035), sx * (hw + 0.068)), Math.max(sx * (hw + 0.035), sx * (hw + 0.068)), b.belt + 0.04, b.belt + 0.17, mz - 0.06, mz + 0.03);
    side(B, sx, hw + 0.003, [[zR + 0.25, sill + 0.03], [zF - 0.25, sill + 0.03], [zF - 0.25, sill + 0.11], [zR + 0.25, sill + 0.11]], TRIM);   // sill trim
  }
  if (b.open) return;
  // interior hints on the glass: steering wheel (driver on the left = +x), headrests front and rear; wipers; roof aerial
  const ws = [zc1, b.belt, zr1, roof], rw = [zc0, b.belt, zr0, roof];
  face(...ws, 0.06, 0.24, hw * 0.2, hw * 0.62, '#101112', 0.012);
  for (const sx of [-1, 1]) {
    face(...ws, 0.5, 0.7, sx * 0.24, sx * 0.48, '#151517', 0.012); face(...rw, 0.42, 0.62, sx * 0.24, sx * 0.48, '#151517', -0.012);
    face(...ws, 0.03, 0.06, sx * 0.05, sx * hw * 0.62, TRIM, 0.016);
  }
  B.style(TRIM).box(hw * 0.4, hw * 0.4 + 0.03, roof, roof + 0.28, zr0 + 0.12, zr0 + 0.16);
}

/** made-up plate: white plate, a blue band on the left and seven dark glyph blocks (no real format, no real characters) */
function plate(B, face, A, out, t0 = 0.2, t1 = 0.45) {
  face(...A, t0, t1, -0.26, 0.26, PLATE, out);
  face(...A, t0 + 0.02, t1 - 0.02, -0.255, -0.205, BAND, out * 1.1);
  for (let k = 0; k < 7; k++) { const x0 = -0.18 + k * 0.061 + (k > 3 ? 0.03 : 0); face(...A, t0 + 0.05, t1 - 0.05, x0, x0 + 0.04, SEAM, out * 1.1); }
}

/** glass panes on the cabin sides: cabin profile shrunk into a frame, split into `panes` between from..to (0 = rear, 1 = front) */
function sideWindows(B, cab, chw, w, belt, roof) {
  const y0 = belt, y1 = roof, win = inset(cab, 0.07);
  const zs = win.map(p => p[0]), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const a = lerp(zmin, zmax, w.from), e = lerp(zmin, zmax, w.to), step = (e - a) / w.panes, gap = 0.07;
  B.style(GLASS, LAMP.glass);
  for (let i = 0; i < w.panes; i++) {
    const p = clipZ(clipZ(win, a + i * step + (i ? gap / 2 : 0), 1), a + (i + 1) * step - (i < w.panes - 1 ? gap / 2 : 0), -1);
    if (p.length < 3) continue;
    for (const sx of [-1, 1]) { B.ctr = v3(0, (y0 + y1) / 2, (a + e) / 2); B.poly(p.map(([z, y]) => v3(sx * (chw(y) + 0.006), y, z))); B.ctr = null; }
  }
}

function bike(B, spec, lod) {
  const d = spec.dims, z = d.wheelbase / 2, r = d.wheelRadius, paint = [spec.palette[0], true], H = d.height;
  const lamp = (col, code, y0, y1, zz, w) => B.style(col, code).quad(v3(-w, y0, zz), v3(w, y0, zz), v3(w, y1, zz), v3(-w, y1, zz), v3(0, (y0 + y1) / 2, zz - Math.sign(zz) * 0.5));
  if (spec.body?.scooter) {   // step-through: leg shield + floorboard + rounded rear body over the engine
    B.style(TRIM).box(-0.04, 0.04, r, H - 0.12, z - 0.12, z - 0.02);                                   // fork / steering column
    B.style(...paint).box(-0.2, 0.2, r + 0.05, H - 0.25, z - 0.3, z - 0.1, undefined, 0.75, 0.8);    // leg shield
    B.style(TRIM).box(-0.16, 0.16, r * 0.9, r * 0.9 + 0.06, -z + 0.35, z - 0.25);                    // floorboard
    B.style(...paint).box(-0.19, 0.19, r * 0.7, r + 0.42, -z - 0.12, -z + 0.45, undefined, 0.8, 0.85); // rear body
    B.style(TRIM).box(-0.32, 0.32, H - 0.12, H - 0.08, z - 0.16, z - 0.08);                          // bars
    lamp(HEAD, LAMP.head, H - 0.36, H - 0.24, z - 0.09, 0.07); lamp(TAIL, LAMP.tail, r + 0.28, r + 0.36, -z - 0.125, 0.07);
    if (lod) return;
    B.style('#151515').box(-0.15, 0.15, r + 0.42, r + 0.52, -z + 0.0, -z + 0.5);                     // seat
    B.style(...paint).box(-0.13, 0.13, r + 0.02, r + 0.1, z - 0.1, z + 0.08);                        // front mudguard
    for (const sx of [-1, 1]) { const zz = z - 0.085, y0 = H - 0.28, y1 = H - 0.24, x0 = sx * 0.16, x1 = sx * 0.21; B.style(AMBER, sx > 0 ? LAMP.indL : LAMP.indR).quad(v3(x0, y0, zz), v3(x1, y0, zz), v3(x1, y1, zz), v3(x0, y1, zz), v3(0, y0, zz - 0.5)); }
    return;
  }
  B.style(TRIM).box(-0.05, 0.05, r, r + 0.18, -z, z - 0.15);                       // frame
  B.style(...paint).box(-0.17, 0.17, r + 0.18, r + 0.45, -0.15, z - 0.2, undefined, 0.8, 0.85);  // tank / fairing
  B.style(TRIM).box(-0.04, 0.04, r, H - 0.12, z - 0.12, z - 0.02);           // fork
  B.style(TRIM).box(-0.36, 0.36, H - 0.14, H - 0.1, z - 0.14, z - 0.06); // bars
  lamp(HEAD, LAMP.head, H - 0.33, H - 0.2, z + 0.005, 0.07);
  lamp(TAIL, LAMP.tail, r + 0.3, r + 0.38, -z - 0.056, 0.06);
  if (lod) return;
  B.style('#151515').box(-0.15, 0.15, r + 0.45, r + 0.55, -z + 0.05, -0.05);        // seat
  B.style(...paint).box(-0.12, 0.12, r + 0.1, r + 0.42, -z - 0.05, -z + 0.35);      // tail
  B.style(TRIM).box(-0.09, 0.09, H - 0.36, H - 0.18, z - 0.1, z);     // headlamp pod
  B.style(TRIM).box(0.08, 0.14, r - 0.05, r + 0.05, -z + 0.1, -0.1);                 // exhaust
}
