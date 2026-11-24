// Procedural low-poly pedestrians from data/peds.json: a style picks top / bottom / hair / accessories + palettes, a seed picks the
// combination (resolvePed), buildPed() bakes it into one rigged geometry (2 LODs). Animation (idle / walk / run) runs in the vertex
// shader of makeLowpolyMaterial({ anim: true }): bones 0 body, 1 left leg, 2 right leg, 3 left arm, 4 right arm (pivots per vertex).
// Frame: y up, facing +z, feet at y = 0. InstancedMesh: setColorAt() repaints the top garment; setPedAnim() sets gait/phase.
import * as THREE from 'three';
import { Builder, rng, pick } from '../lowpoly.js';
import { pedGLBGeometry } from './pedglb.js';
export { makeLowpolyMaterial } from '../lowpoly.js';

export const PARTS = {
  top: ['tshirt', 'polo', 'longsleeve', 'jacket', 'suit'],
  bottom: ['trousers', 'shorts', 'skirt'],
  hair: ['short', 'buzz', 'long', 'bun', 'bald'],
  accessory: ['stripe', 'tie', 'cap', 'hat', 'backpack', 'camera', 'bag', 'cane', 'apron', 'tray', 'sunglasses'],
};
const BIG = new Set(['backpack', 'apron', 'hat', 'cap']);   // accessories that survive in LOD 1

const palette = (db, p, top) => p === '@top' ? [top] : Array.isArray(p) ? p : db.palettes[p];

/** style + seed -> concrete recipe (all colours chosen). Same seed, same person. */
export function resolvePed(db, styleId, seed) {
  const s = db.styles.find(x => x.id === styleId), r = rng(seed);
  if (!s) throw new Error('unknown ped style ' + styleId);
  const buildId = pick(r, s.builds), top = { part: pick(r, s.top.parts), color: pick(r, palette(db, s.top.palette)) };
  return {
    style: s.id, seed, build: { id: buildId, ...db.builds[buildId] }, skin: pick(r, db.palettes.skin), top,
    bottom: { part: pick(r, s.bottom.parts), color: pick(r, palette(db, s.bottom.palette, top.color)) },
    shoes: pick(r, palette(db, s.shoes)), hair: { part: pick(r, s.hair), color: pick(r, palette(db, s.hairPalette)) },
    acc: s.accessories.filter(a => r() < a.chance).map(a => ({ part: a.part, color: pick(r, palette(db, a.palette, top.color)) })),
  };
}

/** recipe -> rigged BufferGeometry (lod 0 near, 1 far) */
/** joint heights / offsets of a recipe (model frame: y up, facing +z, left = +x); shared with the skeleton (peds/rig.js) */
export function dims(p) {
  const k = p.build.height / 1.76, w = p.build.width, z = p.build.stoop || 0, shY = 1.42 * k, n0 = shY + 0.045;
  return { k, w, z, hipY: 0.9 * k, shY, elbowY: 1.1 * k, wristY: 0.84 * k, kneeY: 0.49 * k, ankY: 0.085, legX: 0.095 * w, armX: 0.165 * w + 0.027, n0, h0: n0 + 0.045, hz: z * 2.2 };
}

/** skeleton joint positions of a recipe (peds/rig.js Rig.J) */
export function jointsOf(d) {
  const J = [[0, d.hipY, 0], [0, d.hipY + 0.12, d.z * 0.7], [0, d.shY - 0.2, d.z], [0, d.n0 - 0.02, d.hz * 0.6], [0, d.h0, d.hz]];
  for (const s of [1, -1]) J.push([s * d.armX, d.shY, d.z], [s * d.armX, d.elbowY, d.z], [s * d.armX, d.wristY, d.z]);
  for (const s of [1, -1]) J.push([s * d.legX, d.hipY, 0], [s * d.legX, d.kneeY, 0], [s * d.legX, d.ankY, 0]);
  return J;
}

export function buildPed(p, lod = 0) {
  const gl = pedGLBGeometry(p, lod, dims, jointsOf); if (gl) return gl;   // Blender model (peds/pedglb.js) once preloaded
  // human proportions (own design): rounded low-poly parts (8-sided limbs and torso, 10-sided head), a torso that narrows to the waist
  // and widens to the shoulders; two rings at every knee / elbow so the skinned rig (peds/rig.js) bends them without collapsing.
  // LOD 1: 6 sides, no hands / face / small details
  const B = new Builder(), near = !lod, N = near ? 8 : 6;
  const { k, w, z, hipY, shY, elbowY, wristY, kneeY, ankY, legX, armX } = dims(p), tz = 0.11 * Math.max(1, w * 0.95);
  const PIV = [[0, 0, 0], [legX, hipY, 0], [-legX, hipY, 0], [armX, shY, 0], [-armX, shY, 0]];
  const rig = (bone, col, paint = false) => B.rig(bone, PIV[bone]).style(col, paint);
  const bx = (bone, col, paint, x0, x1, y0, y1, z0, z1, tx, tzz) => { rig(bone, col, paint); B.box(x0, x1, y0, y1, z0, z1, undefined, tx, tzz); };
  const has = name => p.acc.some(a => a.part === name) && (near || BIG.has(name)), accCol = name => p.acc.find(a => a.part === name).color;
  const top = p.top, short = top.part === 'tshirt' || top.part === 'polo', bot = p.bottom.part, TOP = [top.color, true];
  const pants = bot === 'skirt' ? p.skin : p.bottom.color, shin = bot === 'trousers' ? p.bottom.color : p.skin;

  // legs (bones 1, 2): ankle -> knee -> thigh -> hip, shorts end at the knee; shoes: rounded-toe side profile, light sole
  for (const [bone, sx] of [[1, 1], [2, -1]]) {
    const x = sx * legX; rig(bone, shin);
    B.loft(near ? [[ankY - 0.02, x, 0, 0.048, 0.05], [kneeY - 0.05, x, 0.008, 0.055, 0.058], [kneeY + 0.05, x, 0.004, 0.06, 0.062], [hipY - 0.12, x, 0, 0.074 * w, 0.078], [hipY + 0.04, x * 0.85, 0, 0.08 * w, 0.085]]
      : [[ankY - 0.02, x, 0, 0.05, 0.05], [hipY + 0.04, x * 0.85, 0, 0.08 * w, 0.085]], N, near ? [shin, shin, pants, pants] : [bot === 'trousers' ? pants : p.skin], [false, false]);
    if (near && bot === 'shorts') B.loft([[kneeY + 0.02, x, 0.004, 0.068, 0.07], [kneeY + 0.06, x, 0.004, 0.07, 0.072]], N, [], [false, false]);   // hem
    if (near) { rig(bone, p.shoes); B.prism([[-0.07, 0], [0.15, 0], [0.18, 0.035], [0.14, 0.08], [0.03, 0.105], [-0.075, 0.1]], () => 0.055 * Math.max(1, w * 0.9), i => i === 0 ? ['#e8e4dc'] : undefined, undefined, x); }
    else bx(bone, p.shoes, false, x - 0.055, x + 0.055, 0, 0.1, -0.075, 0.16, 0.9, 0.8);
    if (has('stripe')) for (const [y0, y1] of [[0.13, kneeY], [kneeY, hipY]]) bx(bone, accCol('stripe'), false, sx > 0 ? x + 0.07 : x - 0.078, sx > 0 ? x + 0.078 : x - 0.07, y0, y1, -0.02, 0.02);   // split at the knee: bends with it
  }
  if (bot === 'skirt') { rig(0, p.bottom.color); B.loft([[kneeY - 0.03, 0, z * 0.5, 0.22 * w, 0.16], [hipY + 0.06, 0, z, 0.16 * w, 0.115]], N, [], [false, false]); }

  // torso (paint channel: instance colour repaints the top garment): hips (trousers / shorts colour) -> waist -> chest -> shoulders
  rig(0, ...TOP);
  const T = [[hipY - 0.05, 0, z * 0.6, 0.165 * w, tz * 0.92], [hipY + 0.1, 0, z * 0.8, 0.145 * w, tz * 0.88], [shY - 0.15, 0, z + 0.012, 0.172 * w, tz], [shY - 0.02, 0, z, 0.185 * w + 0.01, tz * 0.88], [shY + 0.05, 0, z - 0.005, 0.1, 0.07]];
  B.loft(near ? T : [T[0], T[2], T[4]], N, near ? [bot === 'skirt' || top.part === 'suit' ? TOP : pants, TOP, TOP, TOP] : [TOP, TOP]);
  if (near && bot === 'trousers' && top.part !== 'suit') { rig(0, '#2a2420'); B.loft([[hipY + 0.06, 0, z * 0.75, 0.155 * w, tz * 0.91], [hipY + 0.095, 0, z * 0.8, 0.15 * w, tz * 0.9]], N, [], [false, false]); }   // belt
  const P3 = (x, y, dz) => new THREE.Vector3(x, y, tz + z + dz);
  if (near && top.part === 'suit') {   // shirt front + lapels
    rig(0, '#f2f2ee'); B.quad(P3(-0.045, shY - 0.2, 0.004), P3(0.045, shY - 0.2, 0.004), P3(0.045, shY, 0.004), P3(-0.045, shY, 0.004), new THREE.Vector3(0, shY - 0.1, z));
    for (const sx of [-1, 1]) { rig(0, top.color); B.quad(P3(sx * 0.045, shY - 0.2, 0.007), P3(sx * 0.09, shY - 0.02, 0.002), P3(sx * 0.05, shY + 0.01, 0.004), P3(sx * 0.02, shY - 0.1, 0.008), new THREE.Vector3(0, shY - 0.1, z)); }
  }
  if (near && (top.part === 'polo' || top.part === 'jacket')) { rig(0, ...TOP); B.loft([[shY + 0.03, 0, z - 0.005, 0.085, 0.075], [shY + 0.085, 0, z - 0.01, 0.07, 0.062]], N, [], [false, false]); }   // collar
  if (near && (top.part === 'tshirt' || top.part === 'longsleeve')) { rig(0, ...TOP); B.loft([[shY + 0.0, 0, z - 0.005, 0.098, 0.082], [shY + 0.045, 0, z - 0.008, 0.074, 0.066]], N, [], [false, false]); rig(0, p.skin); B.quad(P3(-0.03, shY - 0.045, 0.012), P3(0.03, shY - 0.045, 0.012), P3(0.04, shY + 0.02, 0.01), P3(-0.04, shY + 0.02, 0.01), new THREE.Vector3(0, shY - 0.1, z)); }   // crew neck + a bit of chest
  if (near && top.part === 'jacket') { rig(0, '#1c1c1e'); B.quad(P3(-0.006, hipY - 0.04, 0.003), P3(0.006, hipY - 0.04, 0.003), P3(0.006, shY - 0.02, 0.003), P3(-0.006, shY - 0.02, 0.003), new THREE.Vector3(0, shY - 0.3, z)); }   // zip
  if (has('tie')) bx(0, accCol('tie'), false, -0.022, 0.022, shY - 0.28, shY + 0.03, tz + z + 0.003, tz + z + 0.012, 0.6, 1);
  if (has('apron')) bx(0, accCol('apron'), false, -0.17 * w, 0.17 * w, kneeY, hipY + 0.12, tz + z, tz + z + 0.014);
  if (has('backpack')) { bx(0, accCol('backpack'), false, -0.14 * w, 0.14 * w, hipY + 0.1, shY - 0.03, -tz - 0.13 + z, -tz + z + 0.01, 0.92, 0.8); if (near) for (const sx of [-1, 1]) bx(0, accCol('backpack'), false, sx * 0.09 - 0.018, sx * 0.09 + 0.018, shY - 0.25, shY + 0.045, -tz + z, tz * 0.6 + z); }
  if (has('camera')) bx(0, accCol('camera'), false, -0.06, 0.06, shY - 0.28, shY - 0.2, tz + z, tz + z + 0.06);
  if (has('bag')) bx(0, accCol('bag'), false, 0.17 * w + 0.01, 0.17 * w + 0.08, hipY - 0.1, hipY + 0.14, -0.12, 0.12, 0.9, 0.8);

  // arms (bones 3, 4): wrist -> elbow -> biceps -> shoulder cap (short sleeves end above the elbow), mitten hands with a thumb
  for (const [bone, sx] of [[3, 1], [4, -1]]) {
    const x = sx * armX, sleeve = short ? p.skin : TOP;
    rig(bone, ...TOP);
    B.loft(near ? [[wristY, x, z, 0.038, 0.04], [elbowY - 0.05, x, z, 0.046 * w, 0.048], [elbowY + 0.05, x, z, 0.05 * w, 0.052], [elbowY + 0.12, x, z, 0.058 * w, 0.058], [shY - 0.05, x, z, 0.066 * w, 0.066], [shY + 0.045, x * 0.9, z, 0.05, 0.056]]
      : [[wristY - 0.08, x, z, 0.04, 0.044], [shY + 0.03, x * 0.92, z, 0.06 * w, 0.062]], N, near ? [sleeve, sleeve, sleeve, TOP, TOP] : [short ? p.skin : TOP], [!near, true]);
    if (!near) continue;
    rig(bone, p.skin);
    B.loft([[wristY - 0.125, x - sx * 0.002, z + 0.008, 0.016, 0.03], [wristY - 0.07, x, z + 0.006, 0.026, 0.046], [wristY + 0.005, x, z, 0.03, 0.036]], 6);
    bx(bone, p.skin, false, x - 0.014, x + 0.014, wristY - 0.075, wristY - 0.025, z + 0.035, z + 0.065, 0.8, 0.7);   // thumb, forward
    bx(bone, p.skin, false, x - 0.02, x + 0.02, wristY - 0.17, wristY - 0.1, z - 0.026, z + 0.03, 0.8, 0.6);   // the four fingers together, slightly curled
    if (!short) bx(bone, '#e9e6df', false, x - 0.044, x + 0.044, wristY + 0.005, wristY + 0.04, z - 0.044, z + 0.044, 1, 1);   // cuff
    if (has('stripe')) for (const [y0, y1] of [[wristY, elbowY], [elbowY, shY]]) bx(bone, accCol('stripe'), false, sx > 0 ? x + 0.05 : x - 0.058, sx > 0 ? x + 0.058 : x - 0.05, y0, y1, -0.02 + z, 0.02 + z);
  }
  if (has('cane')) bx(4, accCol('cane'), false, -armX - 0.015, -armX + 0.015, 0.02, wristY - 0.06, z + 0.04, z + 0.07);
  if (has('tray')) bx(3, accCol('tray'), false, armX - 0.18, armX + 0.18, wristY + 0.02, wristY + 0.035, z + 0.04, z + 0.32);

  // neck + head (face forward = +z): chin -> jaw -> cheeks -> temples -> crown; face decals (eyes, brows, mouth), nose and ears
  const { hz, n0, h0 } = dims(p), h1 = h0 + 0.3, hx = 0.125, F = hz + 0.135 * Math.cos(Math.PI / 10) + 0.006;
  rig(0, p.skin);
  if (near) B.loft([[n0 - 0.04, 0, hz * 0.6, 0.05, 0.052], [h0 + 0.03, 0, hz, 0.048, 0.05]], N, [], [false, false]);
  B.loft(near ? [[h0 - 0.005, 0, hz + 0.02, 0.06, 0.07], [h0 + 0.07, 0, hz + 0.005, 0.105, 0.12], [h0 + 0.17, 0, hz, hx, 0.135], [h0 + 0.25, 0, hz - 0.005, hx * 0.94, 0.127], [h1, 0, hz - 0.012, 0.06, 0.07]]
    : [[h0, 0, hz + 0.01, 0.08, 0.09], [h0 + 0.17, 0, hz, hx, 0.135], [h1, 0, hz - 0.01, 0.07, 0.08]], near ? 10 : N);
  const V = (x, y, dz = 0) => new THREE.Vector3(x, y, F + dz), C0 = new THREE.Vector3(0, h0 + 0.15, hz);
  const dec = (col, x0, x1, y0, y1, dz = 0) => { rig(0, col); B.quad(V(x0, y0, dz), V(x1, y0, dz), V(x1, y1, dz), V(x0, y1, dz), C0); };
  if (near) {
    for (const sx of [-1, 1]) {
      dec('#f4f1ea', sx * 0.05 - 0.024, sx * 0.05 + 0.024, h0 + 0.148, h0 + 0.183);
      dec('#1a1410', sx * 0.053 - 0.011, sx * 0.053 + 0.011, h0 + 0.15, h0 + 0.181, 0.002);
      dec(p.hair.part === 'bald' ? '#6a5040' : p.hair.color, sx * 0.05 - 0.03, sx * 0.05 + 0.03, h0 + 0.192, h0 + 0.206, 0.001);
      bx(0, p.skin, false, sx * (hx - 0.004) - 0.014, sx * (hx - 0.004) + 0.014, h0 + 0.11, h0 + 0.175, hz - 0.035, hz + 0.02, 1, 0.8);   // ears
    }
    bx(0, p.skin, false, -0.017, 0.017, h0 + 0.1, h0 + 0.16, F - 0.01, F + 0.028, 0.6, 0.4);   // nose
    dec('#7a3a32', -0.036, 0.036, h0 + 0.063, h0 + 0.077);   // mouth
  }
  if (has('sunglasses')) dec(accCol('sunglasses'), -0.1, 0.1, h0 + 0.143, h0 + 0.192, 0.006);
  // hair: a shell over the skull (buzz: tight, from higher up), a swept fringe, long hair down the back, a bun
  const hc = p.hair.color, hp = p.hair.part;
  if (hp === 'bald') { if (near) { rig(0, hc); B.loft([[h0 + 0.1, 0, hz - 0.008, hx + 0.004, 0.137], [h0 + 0.17, 0, hz - 0.01, hx + 0.006, 0.139]], 10, [], [false, false]); } }   // the ring of hair round the sides
  else {
    const g = hp === 'buzz' ? 0.006 : 0.016;
    rig(0, hc);
    B.loft([[h0 + (hp === 'buzz' ? 0.215 : 0.2), 0, hz - 0.012, hx + g, 0.13 + g], [h0 + 0.265, 0, hz - 0.014, hx * 0.94 + g, 0.125 + g], [h1 + g, 0, hz - 0.02, 0.06 + g, 0.07 + g]], near ? 10 : N, [], [false, true]);
    if (near && hp !== 'buzz') {
      bx(0, hc, false, -hx - 0.012, hx + 0.012, hp === 'long' ? n0 - 0.08 : h0 + 0.1, h0 + 0.22, hz - 0.15, hz - (hp === 'long' ? 0.03 : 0.06), 1, 1.1);   // back of the head / long hair
      bx(0, hc, false, -hx * 0.95, hx * 0.35, h0 + 0.205, h0 + 0.26, F - 0.03, F + 0.012, 1, 0.6);   // fringe swept to one side
      if (hp === 'long') for (const sx of [-1, 1]) bx(0, hc, false, sx * hx - 0.016, sx * hx + 0.016, n0 - 0.02, h0 + 0.2, hz - 0.06, hz + 0.06, 1, 1);   // locks over the ears
    }
    if (near && hp !== 'buzz') for (const sx of [-1, 1]) bx(0, hc, false, sx * (hx + 0.004) - 0.012, sx * (hx + 0.004) + 0.012, h0 + 0.12, h0 + 0.215, hz - 0.1, hz + 0.045, 1, 1);   // sideburns / side volume
    if (near && hp === 'short') bx(0, hc, false, -hx * 0.75, hx * 0.75, h1 - 0.015, h1 + 0.035, hz - 0.1, F - 0.02, 0.8, 0.8);   // crown volume / quiff
    if (near && hp === 'bun') B.loft([[h1 - 0.08, 0, hz - 0.16, 0.03, 0.03], [h1 - 0.04, 0, hz - 0.18, 0.05, 0.045], [h1, 0, hz - 0.165, 0.03, 0.03]], 6);
  }
  if (has('cap')) { rig(0, accCol('cap')); B.loft([[h1 - 0.07, 0, hz - 0.01, hx + 0.02, 0.15], [h1 + 0.03, 0, hz - 0.02, 0.07, 0.08]], N); if (near) bx(0, accCol('cap'), false, -0.1, 0.1, h1 - 0.075, h1 - 0.055, F - 0.03, F + 0.1, 1, 0.9); }
  if (has('hat')) { rig(0, accCol('hat')); B.loft([[h1 - 0.05, 0, hz, 0.24, 0.24], [h1 - 0.03, 0, hz, 0.24, 0.24]], N); B.loft([[h1 - 0.03, 0, hz - 0.01, hx + 0.012, 0.142], [h1 + 0.08, 0, hz - 0.01, hx * 0.85, 0.12]], N); }

  const geo = B.geometry({ rigged: true });
  // human head size: the parts above were drawn big (cartoon); shrink everything from the chin up about the neck
  { const P = geo.attributes.position, bn = geo.attributes.aBone; for (let i = 0; i < P.count; i++) if (bn.getX(i) === 0 && P.getY(i) > h0) { P.setXYZ(i, P.getX(i) * 0.82, h0 + (P.getY(i) - h0) * 0.84, hz + (P.getZ(i) - hz) * 0.84); } geo.computeBoundingSphere(); geo.computeBoundingBox(); } geo.userData = { style: p.style, seed: p.seed, lod, triangles: B.triangles };
  return geo;
}

/** per-instance animation: gait 0 idle, 1 walk, 2 run (blend in between); phase in radians. Geometry must belong to this mesh only. */
export function setPedAnim(mesh, i, gait, phase) {
  let a = mesh.geometry.getAttribute('aAnim');
  if (!a || a.count < mesh.count) { a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(mesh.count, 1) * 2), 2); mesh.geometry.setAttribute('aAnim', a); }
  a.setXY(i, gait, phase); a.needsUpdate = true;
}

/** player locomotion pose (gait 6..8 on foot / 9 airborne in setPedAnim): stride phase, half stride, crouch, slope (or vy, 0, crouch, 0) */
export function setPedPose(mesh, i, a, b, c, d) {
  let t = mesh.geometry.getAttribute('aPose');
  if (!t || t.count < mesh.count) { t = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(mesh.count, 1) * 4), 4); mesh.geometry.setAttribute('aPose', t); }
  t.setXYZW(i, a, b, c, d); t.needsUpdate = true;
}
