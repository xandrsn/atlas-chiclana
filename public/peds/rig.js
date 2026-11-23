// Skinned skeleton for the pedestrians and the protagonist (own design, no external assets): 17 bones placed from the recipe's own
// proportions (peds/pedmesh.js dims), smooth skin weights computed from the pedmesh bone groups + height (knees / elbows / hips / shoulders /
// neck blend over the double joint rings, so the mesh stays one continuous surface), a library of procedural poses (foot-planted IK gait,
// idle breathing, jump / fall, roll, lying, getting up, stumble, startle, seated in a car / on a bike, mounting) and a crossfading Animator.
// Model frame: y up, facing +z, left = +x, feet at y = 0. Rotations (about x): + bends the torso forward, - swings a thigh / arm forward,
// + bends a knee, - bends an elbow, + points the toes down; about z: + moves a left limb outwards (- a right one).
// Pose = Float32Array: 17 local quaternions (x, y, z, w) + hips offset (3). The player draws it with THREE.SkinnedMesh; the crowd writes the
// bone matrices of every near person into one float texture read by makeSkinMaterial (instanced skinning: one draw call for all of them).
import * as THREE from 'three';
import { dims, buildPed, jointsOf } from './pedmesh.js';

export const NB = 17, NQ = NB * 4, PL = NQ + 3, SLOTS = NB + 1;   // bones, pose length; texture slots per instance (+1 identity: footprint)
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
export const BONE = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, armL: 5, foreL: 6, handL: 7, armR: 8, foreR: 9, handR: 10, thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16 };
const TAU = Math.PI * 2, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const newPose = () => { const P = new Float32Array(PL); for (let i = 0; i < NB; i++) P[i * 4 + 3] = 1; return P; };
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
/** bone i local rotation from Euler angles (order ZYX: flex about x first, then twist, then abduct) */
const E = (P, i, x, y = 0, z = 0) => { _q.setFromEuler(_e.set(x, y, z, 'ZYX')); P[i * 4] = _q.x; P[i * 4 + 1] = _q.y; P[i * 4 + 2] = _q.z; P[i * 4 + 3] = _q.w; };
const O = (P, x, y, z) => { P[NQ] = x; P[NQ + 1] = y; P[NQ + 2] = z; };
const rest = P => { for (let i = 0; i < NB; i++) { P[i * 4] = P[i * 4 + 1] = P[i * 4 + 2] = 0; P[i * 4 + 3] = 1; } O(P, 0, 0, 0); return P; };
/** out = slerp(a, b, t) per bone, lerp of the hips offset (out may be a) */
export function blend(out, a, b, t) {
  for (let i = 0; i < NB; i++) THREE.Quaternion.slerpFlat(out, i * 4, a, i * 4, b, i * 4, t);
  for (let k = NQ; k < PL; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
/** foot path along the stride (u 0..1, duty d): stance planted (moves back at ground speed), swing lifted and eased forward -> [forward m, lift m] (= lowpoly.js) */
export function footPath(u, A, d, H) {
  u -= Math.floor(u); if (u < d) return [A * (1 - 2 * u / d), 0];
  const t = (u - d) / (1 - d); return [-A + 2 * A * (t - Math.sin(TAU * t) / TAU), H * Math.sin(Math.PI * t)];
}

export class Rig {
  constructor(p) {
    const d = this.d = dims(p);
    this.J = jointsOf(d);
    this.L1 = d.hipY - d.kneeY; this.L2 = d.kneeY - d.ankY; this.keys = {};
  }
  /** skin weights for a pedmesh geometry of this recipe -> { skinIndex, skinWeight } Float32 vec4 arrays (weights sum to 1) */
  weights(geo) {
    const { d } = this, P = geo.attributes.position, bn = geo.attributes.aBone, n = P.count, I = new Float32Array(n * 4), W = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const b = bn.getX(i), y = P.getY(i), x = P.getX(i), w = [];
      if (b === 1 || b === 2) {   // leg: foot <- shin <- thigh <- hips
        const o = b === 1 ? 11 : 14, f = 1 - ss(d.ankY - 0.01, d.ankY + 0.025, y), tk = ss(d.kneeY - 0.09, d.kneeY + 0.09, y), hp = 0.55 * ss(d.hipY - 0.12, d.hipY + 0.05, y);
        w.push([o + 2, f], [o + 1, (1 - f) * (1 - tk)], [o, (1 - f) * tk * (1 - hp)], [0, (1 - f) * tk * hp]);
      } else if (b === 3 || b === 4) {   // arm: hand <- forearm <- upper arm <- chest
        const o = b === 3 ? 5 : 8, h = 1 - ss(d.wristY - 0.03, d.wristY + 0.003, y), te = ss(d.elbowY - 0.09, d.elbowY + 0.09, y), ch = 0.55 * ss(d.shY - 0.1, d.shY + 0.045, y);
        w.push([o + 2, h], [o + 1, (1 - h) * (1 - te)], [o, (1 - h) * te * (1 - ch)], [2, (1 - h) * te * ch]);
      } else {   // body: hips -> spine -> chest -> neck -> head by height (the neck only near the axis: shoulders stay on the chest)
        const k = [[d.hipY, 0], [d.hipY + 0.16, 1], [d.shY - 0.17, 2], [d.n0 - 0.03, 2], [d.n0 + 0.02, Math.abs(x) < 0.09 ? 3 : 2], [d.h0 - 0.005, Math.abs(x) < 0.09 ? 3 : 2], [d.h0 + 0.035, 4]];
        if (y <= k[0][0]) w.push([0, 1]); else if (y >= k[6][0]) w.push([4, 1]);
        else for (let j = 0; j < 6; j++) if (y < k[j + 1][0]) { const t = ss(k[j][0], k[j + 1][0], y); w.push([k[j][1], 1 - t], [k[j + 1][1], t]); break; }
      }
      let s = 0; for (const [, v] of w) s += v;
      for (let j = 0; j < 4; j++) { I[i * 4 + j] = w[j]?.[0] ?? 0; W[i * 4 + j] = (w[j]?.[1] ?? 0) / s; }
    }
    return { skinIndex: I, skinWeight: W };
  }
  /** rigged pedmesh geometry (lod 0) with skin attributes */
  geometry(p) {
    const g = buildPed(p, 0); if (g.attributes.skinIndex) return g;   // Blender model: already skinned
    const { skinIndex, skinWeight } = this.weights(g);
    g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4)); return g;
  }
  /** THREE.Skeleton in the bind pose (bones are pure translations: rest rotations are identity) -> { root, bones, skeleton } */
  skeleton() {
    const bones = this.J.map(() => new THREE.Bone());
    bones.forEach((b, i) => { const p = PARENT[i], j = this.J[i]; b.position.set(j[0] - (p < 0 ? 0 : this.J[p][0]), j[1] - (p < 0 ? 0 : this.J[p][1]), j[2] - (p < 0 ? 0 : this.J[p][2])); if (p >= 0) bones[p].add(b); });
    return { root: bones[0], bones, skeleton: new THREE.Skeleton(bones) };
  }
  /** pose -> skeleton bones (player) */
  apply(P, bones) { for (let i = 0; i < NB; i++) bones[i].quaternion.fromArray(P, i * 4); const j = this.J[0]; bones[0].position.set(j[0] + P[NQ], j[1] + P[NQ + 1], j[2] + P[NQ + 2]); }
  /** pose -> skinning matrices (bone world x inverse bind) into out at off (SLOTS mat4, the last one identity) (crowd texture rows) */
  matrices(P, out, off) {
    const W = this._w ||= Array.from({ length: NB }, () => new THREE.Matrix4()), m = this._m ||= new THREE.Matrix4(), one = _ONE;
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i], j = this.J[i];
      if (p < 0) _v.set(j[0] + P[NQ], j[1] + P[NQ + 1], j[2] + P[NQ + 2]); else _v.set(j[0] - this.J[p][0], j[1] - this.J[p][1], j[2] - this.J[p][2]);
      m.compose(_v, _q.fromArray(P, i * 4), one); if (p < 0) W[i].copy(m); else W[i].multiplyMatrices(W[p], m);
      const e = W[i].elements, o = off + i * 16;
      for (let k = 0; k < 12; k++) out[o + k] = e[k];
      out[o + 12] = e[12] - (e[0] * j[0] + e[4] * j[1] + e[8] * j[2]); out[o + 13] = e[13] - (e[1] * j[0] + e[5] * j[1] + e[9] * j[2]); out[o + 14] = e[14] - (e[2] * j[0] + e[6] * j[1] + e[10] * j[2]); out[o + 15] = 1;
    }
    out.set(_ID, off + NB * 16);
  }
  /** model-space position of bone i's joint in pose P (tests, hand / foot checks) */
  joint(P, i) {
    const M = new Float32Array(SLOTS * 16); this.matrices(P, M, 0); const j = this.J[i], e = M.subarray(i * 16, i * 16 + 16);
    return [e[0] * j[0] + e[4] * j[1] + e[8] * j[2] + e[12], e[1] * j[0] + e[5] * j[1] + e[9] * j[2] + e[13], e[2] * j[0] + e[6] * j[1] + e[10] * j[2] + e[14]];
  }

  /** two-bone leg IK: ankle of leg side (0 left, 1 right) onto model-space target (tx, ty, tz); the foot is kept level (+ toe) */
  legIK(P, side, tx, ty, tz, toe = 0, hp = 0) {
    const th = side ? 14 : 11, J = this.J, L1 = this.L1, L2 = this.L2;
    _v.set(tx - J[0][0] - P[NQ], ty - J[0][1] - P[NQ + 1], tz - J[0][2] - P[NQ + 2]).applyQuaternion(_q.fromArray(P, 0).invert());
    _v.x -= J[th][0] - J[0][0]; _v.y -= J[th][1] - J[0][1]; _v.z -= J[th][2] - J[0][2];
    const len = clamp(_v.length(), 0.12, (L1 + L2) * 0.999); _v.normalize();
    const a = -Math.asin(clamp(_v.z, -1, 1)), b = Math.atan2(_v.x, -_v.y);
    const al = Math.acos(clamp((L1 * L1 + len * len - L2 * L2) / (2 * L1 * len), -1, 1)), kb = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - len * len) / (2 * L1 * L2), -1, 1));
    E(P, th, a - al, 0, b); E(P, th + 1, kb); E(P, th + 2, -(a - al) - kb - hp + toe);
  }
  /** idle .. walk .. run with planted feet. s: { ph (rad), A (half stride m), walk 0..1, run 0..1, cr (crouch m), slope, t (s), look (head yaw) } */
  loco(P, s) {
    const d = this.d, { A, walk, run, cr = 0, slope = 0, t = 0 } = s, idle = 1 - walk, ph = s.ph, u = ph / TAU, du = 0.6 - 0.2 * run, kA = Math.min(1, A / 0.3);
    const H = (0.07 + 0.06 * run) * kA, bob = (0.006 + 0.012 * run) * 0.5 * (1 - Math.cos(2 * (ph - du * Math.PI))) * kA, br = Math.sin(t * 1.9);
    const pitch = (0.03 + 0.1 * run) * walk + cr * 0.9, tw = (0.05 + 0.06 * run) * Math.sin(ph) * walk, hp = pitch * 0.3;
    const Lm = (this.L1 + this.L2) * 0.97, D0 = d.hipY - d.ankY, drop = clamp(D0 - Math.sqrt(Math.max(0, Lm * Lm - A * A * 0.8)), 0, 0.11);   // long strides: hips sink so the planted foot is reached
    rest(P); O(P, 0.012 * Math.sin(t * 0.45) * idle, -cr - bob - drop, 0);   // idle: slow weight shift; walking: pelvis bob
    E(P, 0, hp, -tw * 0.6, 0.02 * Math.sin(ph) * walk * (1 - run)); E(P, 1, pitch * 0.35 + 0.01 * br * idle, tw * 0.4); E(P, 2, pitch * 0.35 - 0.018 * br * idle, tw * 0.6);
    E(P, 3, -pitch * 0.55 + 0.04, (s.look || 0) * 0.4); E(P, 4, -pitch * 0.45 - 0.04 + 0.01 * br * idle, (s.look || 0) * 0.6);
    const f = [footPath(u, A, du, H), footPath(u + 0.5, A, du, H)];
    for (const side of [0, 1]) {
      const uu = u + side * 0.5 - Math.floor(u + side * 0.5), [fz, fy] = f[side], x = (side ? -1 : 1) * (d.legX + 0.012);
      const toe = (uu < du ? 0.45 * ss(0.6, 1, uu / du) : -0.3 * ss(0.7, 1, (uu - du) / (1 - du))) * walk;
      this.legIK(P, side, x, d.ankY + fy + slope * fz, fz + 0.01, toe, hp);
    }
    const amp = (0.16 + 0.5 * run) * walk / Math.max(A, 0.2), bend = (0.2 + 0.95 * run) * walk + 0.16 + 0.03 * br * idle, back = cr * 1.6 - pitch * 0.7;
    E(P, 5, -amp * f[1][0] + back, 0, 0.06 + 0.012 * br * idle); E(P, 6, -bend); E(P, 7, 0.05, 0, -0.05);
    E(P, 8, -amp * f[0][0] + back, 0, -0.06 - 0.012 * br * idle); E(P, 9, -bend); E(P, 10, 0.05, 0, 0.05);
    return P;
  }
  /** airborne: s.vy (rising: knee up, arms up; falling: legs reach down), s.fall 0..1 (long fall: flailing), s.t */
  air(P, s) {
    const up = ss(-2.5, 1, s.vy), fl = s.fall || 0, w = Math.sin(s.t * 11), w2 = Math.sin(s.t * 8.3 + 1);
    rest(P); O(P, 0, -0.03, 0); E(P, 0, 0.08 * up); E(P, 1, 0.06); E(P, 2, 0.04 - 0.15 * fl); E(P, 3, -0.08); E(P, 4, -0.05);
    E(P, 11, lerp(-0.35, -1.0, up) * (1 - fl) + fl * (-0.5 + 0.5 * w), 0, 0.05 + 0.15 * fl); E(P, 12, lerp(0.55, 1.35, up) * (1 - fl) + fl * (0.8 + 0.4 * w2)); E(P, 13, 0.3);
    E(P, 14, lerp(-0.1, -0.25, up) * (1 - fl) + fl * (-0.5 - 0.5 * w), 0, -0.05 - 0.15 * fl); E(P, 15, lerp(0.35, 0.6, up) * (1 - fl) + fl * (0.8 - 0.4 * w2)); E(P, 16, 0.3);
    for (const [o, sx, ph] of [[5, 1, 0], [8, -1, 2]]) { const v = Math.sin(s.t * 11 + ph); E(P, o, lerp(-0.7, -2.3, up) * (1 - fl) + fl * (-1.9 + 0.7 * v), 0, sx * (0.25 + fl * (0.6 + 0.35 * v))); E(P, o + 1, -0.5 - fl * 0.5 * (1 + v)); }
    return P;
  }
  /** forward roll after a high fall at speed, u 0..1 (tuck, turn over about the hips, open up) */
  roll(P, u) {
    const d = this.d, k = ss(0, 0.16, u) * (1 - ss(0.8, 1, u)), r = TAU * ss(0.06, 0.86, u);
    rest(P); O(P, 0, -(d.hipY - 0.4) * k + 0.08 * Math.sin(r / 2), 0); E(P, 0, r); E(P, 1, 0.75 * k); E(P, 2, 0.6 * k); E(P, 3, 0.55 * k); E(P, 4, 0.2 * k);
    for (const [o, sx] of [[5, 1], [8, -1]]) { E(P, o, -1.5 * k, 0, sx * 0.35 * k); E(P, o + 1, -1.7 * k); }
    for (const [o, sx] of [[11, 1], [14, -1]]) { E(P, o, -2.25 * k, 0, sx * 0.12 * k); E(P, o + 1, 2.4 * k); E(P, o + 2, 0.4 * k); }
    return P;
  }
  /** lying flat: face 1 = face down, -1 = on the back (hips on the ground) */
  lie(P, face) {
    rest(P); O(P, 0, 0.13 - this.d.hipY, 0); E(P, 0, face * Math.PI / 2);
    if (face > 0) { E(P, 3, -0.45); E(P, 4, 0, 0.9); E(P, 5, -0.35, 0, 0.45); E(P, 6, -1.2); E(P, 8, -0.15, 0, -0.2); E(P, 9, -0.4); E(P, 11, 0, 0, 0.12); E(P, 12, 0.2); E(P, 13, 1.25); E(P, 14, -0.35, 0, -0.08); E(P, 15, 0.7); E(P, 16, 1.2); }
    else { E(P, 3, 0.15); E(P, 4, 0, 0.4); E(P, 5, 0.1, 0, 0.6); E(P, 6, -0.3); E(P, 8, 0.1, 0, -0.75); E(P, 9, -0.5); E(P, 11, -0.1, 0, 0.15); E(P, 12, 0.15); E(P, 13, 0.3); E(P, 14, -0.45, 0, -0.1); E(P, 15, 0.9); E(P, 16, 0.2); }
    return P;
  }
  /** swimming crawl at the surface (hips just under it): face down, head up, arms windmill, legs flutter; t (s) */
  swim(P, t) {
    const a = t * 3.2, k = Math.sin(t * 9);
    rest(P); O(P, 0, 0.2 - this.d.hipY, 0); E(P, 0, 1.35); E(P, 3, -0.75); E(P, 4, -0.35);
    E(P, 5, -Math.PI + 2.6 * Math.sin(a) - 0.3, 0, 0.25); E(P, 6, -0.25 - 0.35 * Math.max(0, Math.cos(a)));
    E(P, 8, -Math.PI - 2.6 * Math.sin(a) - 0.3, 0, -0.25); E(P, 9, -0.25 - 0.35 * Math.max(0, -Math.cos(a)));
    E(P, 11, 0.25 * k, 0, 0.06); E(P, 12, 0.2 + 0.15 * k); E(P, 13, 1.2); E(P, 14, -0.25 * k, 0, -0.06); E(P, 15, 0.2 - 0.15 * k); E(P, 16, 1.2);
    return P;
  }
  /** static key poses (cached per rig): all fours, sitting up, kneeling on one knee, standing, stumble lunge / catch, startle, seats, mount */
  key(name) {
    if (this.keys[name]) return this.keys[name];
    const d = this.d, P = rest(newPose()), hipH = this.L1 + 0.06;
    const arms = (x, z, f, xr = x, zr = -z, fr = f) => { E(P, 5, x, 0, z); E(P, 6, f); E(P, 8, xr, 0, zr); E(P, 9, fr); };
    switch (name) {
      case 'fours': O(P, 0, hipH - d.hipY, 0); E(P, 0, 1.35); E(P, 1, 0.05); E(P, 3, -0.7); E(P, 4, -0.3); arms(-1.4, 0.12, -0.15);
        E(P, 11, -1.35, 0, 0.06); E(P, 12, 1.55); E(P, 13, 1.1); E(P, 14, -1.3, 0, -0.06); E(P, 15, 1.6); E(P, 16, 1.1); break;
      case 'sit': O(P, 0, 0.13 - d.hipY, 0); E(P, 0, -0.3); E(P, 1, 0.35); E(P, 2, 0.2); E(P, 3, -0.1); arms(0.55, 0.3, -0.15);
        E(P, 11, -1.3, 0, 0.08); E(P, 12, 0.35); E(P, 13, -0.2); E(P, 14, -1.25, 0, -0.08); E(P, 15, 0.6); E(P, 16, -0.2); break;
      case 'kneel': O(P, 0, hipH - d.hipY, 0); E(P, 0, 0.15); E(P, 1, 0.25); E(P, 2, 0.1); E(P, 3, -0.2); arms(-0.65, 0.1, -0.9, -0.2, -0.15, -0.3);
        E(P, 11, -1.4, 0, 0.06); E(P, 12, 1.25); E(P, 13, 0.05); E(P, 14, 0.15, 0, -0.04); E(P, 15, 1.5); E(P, 16, 1.05); break;
      case 'stand': this.loco(P, { ph: 0, A: 0, walk: 0, run: 0, t: 0 }); break;
      case 'lunge': O(P, 0, -0.09, 0.05); E(P, 0, 0.3); E(P, 1, 0.25); E(P, 2, 0.15); E(P, 3, -0.35); arms(-1.25, 0.85, -0.5);
        E(P, 11, -0.95, 0, 0.05); E(P, 12, 0.75); E(P, 13, 0.25); E(P, 14, 0.3, 0, -0.05); E(P, 15, 0.35); E(P, 16, 0.4); break;
      case 'catch': O(P, 0, -0.05, 0); E(P, 0, 0.12); E(P, 1, 0.1); E(P, 3, -0.1); arms(-0.55, 0.45, -0.4);
        E(P, 11, -0.45, 0, 0.05); E(P, 12, 0.45); E(P, 13, 0.0); E(P, 14, 0.2, 0, -0.05); E(P, 15, 0.3); E(P, 16, 0.1); break;
      case 'startle': O(P, 0, -0.06, -0.04); E(P, 0, -0.08); E(P, 1, -0.12); E(P, 2, -0.05); E(P, 4, -0.15); arms(-1.35, 0.3, -1.9);
        E(P, 11, -0.3, 0, 0.06); E(P, 12, 0.45); E(P, 13, -0.15); E(P, 14, -0.05, 0, -0.06); E(P, 15, 0.3); E(P, 16, -0.1); break;
      case 'reach': this.loco(P, { ph: 0, A: 0, walk: 0, run: 0, t: 0 }); E(P, 2, 0.05, -0.25); E(P, 8, -0.95, 0, -0.5); E(P, 9, -0.35); E(P, 10, 0, 0, -0.4); break;
      case 'car': O(P, 0, 0.1 - d.hipY, 0); E(P, 0, -0.2); E(P, 1, 0.05); E(P, 2, 0.05); E(P, 3, 0.1); arms(-1.05, -0.12, -0.75);
        E(P, 11, -1.25, 0, 0.06); E(P, 12, 1.3); E(P, 13, 0.25); E(P, 14, -1.25, 0, -0.06); E(P, 15, 1.3); E(P, 16, 0.25); break;
      case 'carClose': P.set(this.key('car')); E(P, 2, 0.05, 0.3); E(P, 5, -0.7, 0, 0.95); E(P, 6, -0.8); break;
      case 'bike': O(P, 0, 0.1 - d.hipY, 0); E(P, 0, 0.25); E(P, 1, 0.15); E(P, 2, 0.05); E(P, 3, -0.35); E(P, 4, -0.15); arms(-1.15, 0.22, -0.45);
        E(P, 11, -1.3, 0, 0.2); E(P, 12, 1.5); E(P, 13, 0.0); E(P, 14, -1.3, 0, -0.2); E(P, 15, 1.5); E(P, 16, 0.0); break;
      case 'mount': this.loco(P, { ph: 0, A: 0, walk: 0, run: 0, t: 0 }); O(P, 0, -0.06, 0); E(P, 0, 0.2, 0, 0.12); E(P, 1, 0.2); arms(-0.9, 0.25, -0.5);
        E(P, 14, -0.7, 0, -1.05); E(P, 15, 0.9); E(P, 16, 0.2); break;
      case 'limp': this.lie(P, -1); E(P, 0, -Math.PI / 2, 0.3, 0.2); arms(0.3, 1.1, -0.6, -0.5, -0.9, -0.2); E(P, 12, 0.8); E(P, 15, 0.3); break;
      default: throw new Error('pose ' + name);
    }
    return this.keys[name] = P;
  }
  /** key sequence [[u, pose], ...] sampled at u (eased per segment) */
  seq(P, keys, u) {
    let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const [u0, a] = keys[i], [u1, b] = keys[i + 1]; return blend(P, a, b, ss(0, 1, (u - u0) / (u1 - u0)));
  }
  /** getting up from lying (face 1 down: push up to all fours; -1 back: sit up), then one knee, then stand; u 0..1 */
  getup(P, u, face) {
    const L = this.keys[face > 0 ? 'lieF' : 'lieB'] ||= this.lie(newPose(), face);
    return this.seq(P, [[0, L], [0.3, this.key(face > 0 ? 'fours' : 'sit')], [0.66, this.key('kneel')], [1, this.key('stand')]], u);
  }
  /** pushed / bumped: lunge to catch the balance, recover; u 0..1 */
  stumble(P, u) { return this.seq(P, [[0, this.key('stand')], [0.3, this.key('lunge')], [0.62, this.key('catch')], [1, this.key('stand')]], u); }
}
const _ONE = new THREE.Vector3(1, 1, 1), _ID = new THREE.Matrix4().elements;

/** crossfade: a frozen snapshot of the last output eases into the live target pose (this.T, written by the caller every frame) */
export class Animator {
  constructor() { this.out = newPose(); this.from = newPose(); this.T = newPose(); this.w = 1; this.key = null; this.fade = 0.2; }
  update(dt, key, fade = 0.2) {
    if (key !== this.key) { this.from.set(this.out); this.key = key; this.w = 0; this.fade = fade; }
    this.w = Math.min(1, this.w + dt / Math.max(1e-3, this.fade));
    return blend(this.out, this.from, this.T, ss(0, 1, this.w));
  }
}

/** bone texture for cap instances (row = instance, SLOTS x 4 RGBA texels = column-major mat4s) */
export function boneTexture(cap) {
  const t = new THREE.DataTexture(new Float32Array(SLOTS * 4 * 4 * cap), SLOTS * 4, cap, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true; return t;
}
/** unlit vertex-colour material skinned from a bone texture per gl_InstanceID; aSel / aModel pick the outfit, instance colour x aPaint repaints the top */
export function makeSkinMaterial(tex) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.defaultAttributeValues = { aSel: [0], aModel: [0] };
  m.customProgramCacheKey = () => 'pedskin';
  m.onBeforeCompile = s => {
    s.uniforms.uBones = { value: tex };
    s.vertexShader = `uniform highp sampler2D uBones; attribute vec4 skinIndex; attribute vec4 skinWeight; attribute float aPaint; attribute float aModel; attribute float aSel;
mat4 boneM(float b) { int x = int(b + 0.5) * 4, y = gl_InstanceID; return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0), texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0)); }
` + s.vertexShader.replace('#include <begin_vertex>', `vec4 p0 = vec4(position, 1.0);
vec3 transformed = (skinWeight.x * (boneM(skinIndex.x) * p0) + skinWeight.y * (boneM(skinIndex.y) * p0) + skinWeight.z * (boneM(skinIndex.z) * p0) + skinWeight.w * (boneM(skinIndex.w) * p0)).xyz;
if (aSel > 0.5 && abs(aSel - 1.0 - aModel) > 0.5) transformed = vec3(0.0);   // other outfits collapse to a point`).replace('#include <color_vertex>', `vColor = color;
#ifdef USE_INSTANCING_COLOR
  if (aPaint > 0.0) vColor = instanceColor * aPaint;
#endif`);
  };
  return m;
}
