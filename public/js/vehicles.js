import * as THREE from 'three';
import { clamp, angDiff } from './geo.js';
import { wallNormal } from './collide.js';

const NOPAD = { thr: 0, steer: 0, f: 0, s: 0, yaw: 0, up: 0 };   // analogue gamepad inputs (main.js fills keys.pad when a pad is connected)
const GEARS = [0, 9, 17, 26, 36, 48, 72];

const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };

// Forward is local -Z. heading psi: forward = (-sin psi, -cos psi); positive psi turns left.
const fwd = psi => [-Math.sin(psi), -Math.cos(psi)];

// ------------------------------------------------------------------------ vehicle types
// L/W body length/width (m), bh body height, cab [w,h,d,z] glass cabin, wb/track half wheelbase / half track, wr wheel radius,
// acc/top/grip/steer multipliers on the base car tuning, roll body-roll multiplier, lean = bike leaning.
// Paint colour 0xc8321e is the one the player's colour recolours (net.js tint).
export const VEHICLES = [
  { id: 'hatch',  name: 'Utilitario', icon: '🚗', L: 3.8, W: 1.7,  bh: 0.5,  cab: [1.5, 0.5, 1.9, 0.3],    wb: 1.15, track: 0.85, wr: 0.32, acc: 0.95, top: 0.9,  grip: 1.0,  steer: 1.1,  roll: 1, prob: 0.26, mass: 1050 },
  { id: 'sedan',  name: 'Berlina',    icon: '🚘', L: 4.6, W: 1.8,  bh: 0.5,  cab: [1.55, 0.48, 2.2, 0.35], wb: 1.5,  track: 0.92, wr: 0.34, acc: 1.0,  top: 1.0,  grip: 1.0,  steer: 1.0,  roll: 1, prob: 0.24, mass: 1450 },
  { id: 'suv',    name: 'SUV 4x4',    icon: '🚙', L: 4.7, W: 1.95, bh: 0.72, cab: [1.78, 0.6, 2.6, 0.3],   wb: 1.5,  track: 1.0,  wr: 0.43, acc: 0.9,  top: 0.88, grip: 0.95, steer: 0.95, roll: 1.5, offroad: 1.5, prob: 0.13, mass: 1950 },
  { id: 'sport',  name: 'Deportivo',  icon: '🏎️', L: 4.4, W: 1.9,  bh: 0.38, cab: [1.5, 0.34, 1.5, 0.35],  wb: 1.35, track: 0.95, wr: 0.34, acc: 1.4,  top: 1.3,  grip: 1.25, steer: 0.9,  roll: 0.6, spoiler: 1, prob: 0.04, mass: 1350 },
  { id: 'van',    name: 'Furgoneta',  icon: '🚐', L: 5.0, W: 2.0,  bh: 1.55, cab: [1.9, 0.55, 1.2, -1.45], wb: 1.6,  track: 1.0,  wr: 0.38, acc: 0.7,  top: 0.75, grip: 0.85, steer: 0.9,  roll: 1.7, van: 1, prob: 0.11, mass: 2300 },
  { id: 'taxi',   name: 'Taxi',       icon: '🚕', L: 4.6, W: 1.8,  bh: 0.5,  cab: [1.55, 0.48, 2.2, 0.35], wb: 1.5,  track: 0.92, wr: 0.34, acc: 1.0,  top: 0.95, grip: 1.0,  steer: 1.0,  roll: 1, fixed: 0xe9b824, sign: 1, prob: 0.08, mass: 1450 },
  { id: 'police', name: 'Policía',    icon: '🚓', L: 4.6, W: 1.85, bh: 0.5,  cab: [1.6, 0.48, 2.2, 0.35],  wb: 1.5,  track: 0.94, wr: 0.34, acc: 1.2,  top: 1.12, grip: 1.1,  steer: 1.0,  roll: 0.9, fixed: 0xeeeeee, lights: 1, prob: 0.03, mass: 1600 },
  { id: 'moto',   name: 'Moto',       icon: '🏍️', L: 2.1, W: 0.7,  bh: 0.3,                                 wb: 0.7,  track: 0.1,  wr: 0.33, acc: 1.35, top: 1.05, grip: 0.85, steer: 1.4,  roll: 1, lean: 3.6, bike: 1, prob: 0.11, mass: 210 },
];
const probesOf = v => { const l = v.L / 2, w = v.W / 2; return [[l, w], [l, -w], [-l, w], [-l, -w], [l + 0.1, 0], [0, w], [0, -w]]; };

/** fill 'model' with the meshes of one vehicle type; returns the wheel list [{pivot, w, front}] */
function buildModel(model, v) {
  const paint = mat(0xc8321e), body = v.fixed ? mat(v.fixed) : paint, glass = mat(0x1d2a38), dark = mat(0x151515), wheels = [];
  const wheel = (x, z, front, wid) => {
    const pivot = new THREE.Group(); pivot.position.set(x, v.wr, z);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(v.wr, v.wr, wid, 16), dark); w.rotation.z = Math.PI / 2;
    pivot.add(w); model.add(pivot); wheels.push({ pivot, w, front }); return pivot;
  };
  if (v.bike) {
    const metal = mat(0x8a8f96), cloth = mat(0x24303c), helmet = mat(0xe8e8e8);
    model.add(box(0.26, 0.28, 0.9, body, 0, 0.74, 0.05));                 // tank + frame
    model.add(box(0.2, 0.2, 0.7, dark, 0, 0.5, 0.35));                    // engine block
    model.add(box(0.24, 0.1, 0.7, dark, 0, 0.92, 0.5));                   // seat
    model.add(box(0.2, 0.08, 0.5, body, 0, 0.9, 0.95));                   // tail
    model.add(box(0.1, 0.1, 0.9, metal, 0.13, 0.4, 0.6));                 // exhaust
    wheel(0, 0.7, 0, 0.14);
    const fork = wheel(0, -0.7, 1, 0.14);                                  // front wheel + fork + handlebar steer together
    const f = box(0.08, 0.7, 0.08, metal, 0, 0.35, 0.1); f.rotation.x = 0.35; fork.add(f);
    fork.add(box(0.7, 0.05, 0.05, dark, 0, 0.66, 0.2));
    fork.add(box(0.2, 0.18, 0.12, mat(0xf2e9b0), 0, 0.52, -0.05));         // headlight
    model.add(box(0.34, 0.5, 0.2, cloth, 0, 1.28, 0.38)).rotation.x = -0.35;   // torso leaning forward
    model.add(box(0.12, 0.12, 0.5, cloth, -0.27, 1.12, 0.1)); model.add(box(0.12, 0.12, 0.5, cloth, 0.27, 1.12, 0.1));   // arms
    model.add(box(0.14, 0.5, 0.2, cloth, -0.22, 0.82, 0.5)); model.add(box(0.14, 0.5, 0.2, cloth, 0.22, 0.82, 0.5));       // legs
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), helmet); h.position.set(0, 1.65, 0.12); model.add(h);
    return wheels;
  }
  const y0 = v.wr + 0.12, [cw, ch, cd, cz] = v.cab;
  model.add(box(v.W, v.bh, v.L, body, 0, y0 + v.bh / 2, 0));
  if (v.van) model.add(box(cw, ch, cd, glass, 0, y0 + v.bh - 0.1, cz));           // windscreen band of the cab
  else {
    model.add(box(cw, ch, cd, glass, 0, y0 + v.bh + ch / 2, cz));
    model.add(box(cw - 0.05, 0.08, cd - 0.2, body, 0, y0 + v.bh + ch + 0.04, cz));
  }
  model.add(box(v.W - 0.1, 0.12, 0.18, dark, 0, y0 + 0.06, -v.L / 2));              // bumpers
  model.add(box(v.W - 0.1, 0.12, 0.18, dark, 0, y0 + 0.06, v.L / 2));
  model.add(box(v.W - 0.5, 0.1, 0.05, mat(0xf2e9b0), 0, y0 + v.bh * 0.55, -v.L / 2 - 0.01));   // headlights
  model.add(box(v.W - 0.5, 0.1, 0.05, mat(0xb01818), 0, y0 + v.bh * 0.55, v.L / 2 + 0.01));    // tail lights
  if (v.fixed) model.add(box(v.W + 0.02, 0.18, v.L * 0.6, paint, 0, y0 + v.bh * 0.5, 0));       // livery stripe in the player's colour
  if (v.spoiler) { model.add(box(v.W - 0.1, 0.06, 0.4, dark, 0, y0 + v.bh + 0.38, v.L / 2 - 0.3)); model.add(box(0.08, 0.3, 0.1, dark, -0.6, y0 + v.bh + 0.2, v.L / 2 - 0.3)); model.add(box(0.08, 0.3, 0.1, dark, 0.6, y0 + v.bh + 0.2, v.L / 2 - 0.3)); }
  if (v.sign) model.add(box(0.5, 0.16, 0.2, mat(0xfff4b0), 0, y0 + v.bh + ch + 0.17, cz));
  if (v.lights) { model.add(box(0.5, 0.12, 0.2, mat(0xd01818), -0.3, y0 + v.bh + ch + 0.14, cz)); model.add(box(0.5, 0.12, 0.2, mat(0x1848d0), 0.3, y0 + v.bh + ch + 0.14, cz)); }
  for (const [x, z, front] of [[-1, -1, 1], [1, -1, 1], [-1, 1, 0], [1, 1, 0]]) wheel(x * v.track, z * v.wb, front, 0.26);
  return wheels;
}


// ------------------------------------------------------------------------ baked fleets (traffic + parked): one instanced draw call per vehicle type
/** merge every mesh of a model into one non-indexed geometry: position, normal, colour (the material colour) and aPaint (1 where the player-recolourable paint is) */
function bake(root) {
  root.updateMatrixWorld(true); const P = [], N = [], C = [], A = [], v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverse(o => {
    if (!o.isMesh || !o.material?.color) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position, q = g.attributes.normal, col = o.material.color, paint = o.material.color.getHex() === 0xc8321e ? 1 : 0;
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); n.fromBufferAttribute(q, i).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); C.push(col.r, col.g, col.b); A.push(paint);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aPaint', new THREE.Float32BufferAttribute(A, 1)); return g;
}
const GEO = new Map();
/** baked geometry of a ground vehicle type (index into VEHICLES) or 'heli' */
export function fleetGeo(type) {
  let g = GEO.get(type); if (g) return g;
  const root = new THREE.Group();
  if (type === 'heli') root.add(new Heli(null).model); else buildModel(root, VEHICLES[type]);
  GEO.set(type, g = bake(root)); return g;
}
let FMAT = null;
function fleetMaterial() {   // vertex colour everywhere, times the per-instance colour on the paint only
  if (FMAT) return FMAT;
  FMAT = new THREE.MeshLambertMaterial({ vertexColors: true });
  FMAT.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint; attribute vec3 iCol; varying vec3 vPc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPc = mix(vec3(1.0), iCol, aPaint);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPc;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPc;');
  };
  return FMAT;
}
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3(), _S = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0), _C = new THREE.Color();
/** instanced set of one baked type: begin() / add(x,y,z,psi,hex) ... / end() every frame */
export class Fleet {
  constructor(scene, type, max) {
    this.geo = fleetGeo(type).clone(); this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.geo.setAttribute('iCol', this.col);
    this.im = new THREE.InstancedMesh(this.geo, fleetMaterial(), max); this.im.frustumCulled = false; this.im.count = 0; this.max = max; this.n = 0; this.on = true; this.im.visible = false; scene.add(this.im);
  }
  begin() { this.n = 0; }
  add(x, y, z, psi, hex) {
    if (this.n >= this.max) return false; const i = this.n++;
    _Q.setFromAxisAngle(_Y, psi); _P.set(x, y, z); this.im.setMatrixAt(i, _M.compose(_P, _Q, _S)); _C.setHex(hex); this.col.setXYZ(i, _C.r, _C.g, _C.b); return true;
  }
  end() { this.im.count = this.n; this.im.visible = this.on && this.n > 0; this.im.instanceMatrix.needsUpdate = true; this.col.needsUpdate = true; }
  set visible(v) { this.on = v; this.im.visible = v && this.n > 0; }
}
/** pick a ground vehicle type by its spawn probability; `skip` lists ids to exclude */
export function randomType(rnd = Math.random(), skip = []) {
  let sum = 0; for (const v of VEHICLES) if (!skip.includes(v.id)) sum += v.prob;
  let r = rnd * sum; for (let i = 0; i < VEHICLES.length; i++) { if (skip.includes(VEHICLES[i].id)) continue; r -= VEHICLES[i].prob; if (r <= 0) return i; } return 0;
}
export const topKmh = v => Math.round(46 * v.top * 3.6);

// ------------------------------------------------------------------------ car (every ground vehicle: cars, van, taxi, police, motorbike)
export class Car {
  constructor(world, type = 0) {
    this.world = world;
    this.group = new THREE.Group();
    this.model = new THREE.Group(); this.group.add(this.model);
    this.setType(type);
    this.pos = new THREE.Vector3(); this.psi = 0; this.speed = 0; this.steer = 0; this.kThr = 0;
    this.vx = 0; this.vz = 0; this.gear = 1; this.gearT = 0; this.rpm = 0; this.slip = 0; this.slip0 = 0; this.roll = 0; this.rollV = 0; this.pitch = 0; this.pitchV = 0;
    this.quat = new THREE.Quaternion();
    this.height = 1.5; this.yawRate = 0; this.bump = 0; this._n = [0, 0]; this._p = [0, 0];
    this._up = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
  }
  /** swap the body for another vehicle type (index into VEHICLES); handling follows the spec */
  setType(i) {
    const v = VEHICLES[i] || VEHICLES[0]; this.type = VEHICLES.indexOf(v); this.spec = v; this.probes = probesOf(v); this.wr = v.wr;
    for (const c of [...this.model.children]) { this.model.remove(c); c.traverse(o => o.geometry?.dispose()); }
    this.wheels = buildModel(this.model, v);
  }
  place(x, z, psi) { this.dmg = 0; this.model.scale.z = 1; this.pos.set(x, this.world.surf(x, z, null), z); this.psi = psi; this.speed = 0; this.vx = this.vz = 0; this.steer = 0; this.orient(1); }

  orient(t) {
    const hf = this.world.hf, [fx, fz] = fwd(this.psi), { x, z } = this.pos, L = this.spec.wb + 0.45, Wd = Math.max(0.3, this.spec.track);
    const yr = this.pos.y, sf_ = (a, b) => Math.max(this.world.surf(a, b, yr), yr - 2.2);   // a contact point can't suddenly drop >2.2 m (deck edge / road gap): keeps the car from plunging off bridges
    const hF = sf_(x + fx * L, z + fz * L), hB = sf_(x - fx * L, z - fz * L);
    const rx = -fz, rz = fx; // right vector (screen) = fwd rotated -90deg about y
    const hR = sf_(x + rx * Wd, z + rz * Wd), hL = sf_(x - rx * Wd, z - rz * Wd);
    // surface normal from slopes along forward (sf) and right (sr)
    const sf = (hF - hB) / (2 * L), sr = (hR - hL) / (2 * Wd);
    const up = this._up.set(-(sf * fx + sr * rx), 1, -(sf * fz + sr * rz)).normalize();
    const f = this._f.set(fx, 0, fz); f.addScaledVector(up, -f.dot(up)).normalize();
    const r = this._r.crossVectors(f, up);
    f.negate(); const q = this._q.setFromRotationMatrix(this._m.makeBasis(r, up, f));
    this.quat.slerp(q, t); this.group.quaternion.copy(this.quat);
    this.pos.y = (hF + hB + hR + hL) / 4;   // average of the four contact points
  }

  /** One fixed physics step (main.js calls this at 120 Hz). Bicycle model with a grip budget:
   *  - the heading turns with the front wheels, but the yaw rate cannot ask for more lateral acceleration than the tyres can give;
   *  - the velocity is NOT rotated with the body: whatever ends up sideways is slip, removed by tyre friction up to the same budget
   *    (so the car holds its line below the limit and washes wide / drifts above it; the handbrake frees the rear);
   *  - buildings stop it along the wall normal (it slides along oblique walls instead of sticking), solids bounce it. */
  update(dt, k) {
    const pad = k.pad || NOPAD;
    const kb = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), ramp = 7 * dt;   // keyboard throttle ramps in/out (analogue feel); pads are already analogue
    this.kThr = Math.abs(kb - (this.kThr || 0)) <= ramp ? kb : this.kThr + Math.sign(kb - this.kThr) * ramp;
    const thr = clamp(this.kThr + pad.thr, -1, 1), steerIn = clamp((k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) + pad.steer, -1, 1), nitro = k.ShiftLeft || k.ShiftRight ? 1 : 0, hb = k.Space ? 1 : 0;
    let [fx, fz] = fwd(this.psi), rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz, vl = this.vx * rx + this.vz * rz;          // velocity in body axes (slip = vl)
    const R = this.world.roads, onRoad = !R || !!R.road(this.pos.x, this.pos.z, this.pos.y);
    const S = this.spec, MU = (onRoad ? 11.5 : 6.5 * (S.offroad || 1)) * S.grip;                                                 // lateral grip budget (m/s2): tarmac / dirt & grass
    // ---- engine: 6 gears, each pulls hard at the bottom of its range and fades towards the top
    const GEAR = GEARS.map(g => g * S.top), top = (46 + nitro * 26) * S.top, av = Math.abs(vf);
    let g = 1; while (g < 6 && av > GEAR[g]) g++;
    if (g !== this.gear && this.gearT <= 0) { this.gear = g; this.gearT = 0.12; } this.gearT -= dt;       // short torque cut while shifting
    const rpm = clamp((av - GEAR[this.gear - 1]) / (GEAR[this.gear] - GEAR[this.gear - 1]), 0, 1); this.rpm = rpm;
    let a = 0;
    if (thr > 0) a = vf < -0.5 ? 26 * thr : (this.gearT > 0 ? 2 : (17 - this.gear * 1.7) * S.acc * (1 + nitro * 0.7) * (1 - 0.25 * rpm)) * (1 - clamp(vf / top, 0, 1)) * thr;
    else if (thr < 0) a = vf > 0.5 ? 32 * thr * Math.min(1.15, S.grip) : 8 * thr * (1 - clamp(-vf / 14, 0, 1));
    a -= vf * 0.03 + Math.sign(vf) * 0.5;                                              // drag + rolling resistance
    if (!onRoad) a -= vf * 0.55;                                                       // soft ground
    if (hb) a -= Math.sign(vf) * 12;
    const prev = vf; vf += a * dt; if (!thr && (prev * vf < 0 || Math.abs(vf) < 0.15)) vf = 0;
    // ---- steering: wheel angle shrinks with speed; yaw follows the bicycle model but is capped by the grip budget (understeer at the limit)
    const maxSteer = 0.58 * S.steer / (1 + (av / (20 * S.top)) ** 1.6);
    this.steer += (steerIn * maxSteer - this.steer) * Math.min(1, dt * (steerIn ? 6 : 9));
    let yaw = vf / (2 * S.wb) * Math.tan(this.steer);
    const yawCap = (hb && av > 5 ? 1.9 : 1.12) * MU / Math.max(av, 4);
    yaw = clamp(yaw, -Math.min(2.6, yawCap), Math.min(2.6, yawCap));
    if (av > 3 && !hb) yaw -= clamp(Math.atan2(vl, av), -0.6, 0.6) * 1.4;              // self-aligning: the nose follows the slide a little (easy to catch)
    yaw = this.yawRate + (yaw - this.yawRate) * Math.min(1, dt * 14 / Math.sqrt(S.mass / 1450));   // body inertia: heavy vehicles take longer to swing round, a bike flicks
    this.yawRate = yaw; this.psi += yaw * dt;
    // ---- tyres: project the (unrotated) velocity on the new body axes and scrub the sideways part within the budget
    const wvx = fx * vf + rx * vl, wvz = fz * vf + rz * vl;
    [fx, fz] = fwd(this.psi); rx = -fz; rz = fx;
    vf = wvx * fx + wvz * fz; vl = wvx * rx + wvz * rz;
    const scrub = (hb ? 0.32 : 1) * MU * dt * (1 + Math.min(1.5, Math.abs(vl) * 0.25));  // a big slide bites harder (keeps drifts controllable)
    vl -= clamp(vl, -scrub, scrub);
    this.slip = vl;
    this.vx = fx * vf + rx * vl; this.vz = fz * vf + rz * vl;
    // ---- move: buildings / props block along their wall normal, then solids (walls, trunks, cars) push the car out and bounce it
    this.moveBlocked(dt);
    this.collide(dt);
    vf = this.vx * fx + this.vz * fz; this.speed = vf;
    // ---- body: pitch under acceleration, roll in corners (suspension), spring-damped
    const lat = vf * yaw;                                                              // lateral acceleration ~ v * yawRate
    const tRoll = S.lean ? clamp(-lat * 0.012 * S.lean, -0.55, 0.55) : clamp(-lat * 0.012 * S.roll, -0.12 * S.roll, 0.12 * S.roll), tPitch = clamp(-a * 0.004, -0.05, 0.05);
    this.rollV += ((tRoll - this.roll) * 90 - this.rollV * 11) * dt; this.roll += this.rollV * dt;
    this.pitchV += ((tPitch - this.pitch) * 90 - this.pitchV * 11) * dt; this.pitch += this.pitchV * dt;
    this.model.rotation.set(this.pitch, 0, this.roll, 'YXZ'); if (this.dmg) this.model.scale.z = 1 - 0.07 * this.dmg;   // crumpled nose/tail
    this.orient(Math.min(1, dt * 10));
    this.group.position.copy(this.pos);
    for (const w of this.wheels) { w.w.rotation.x -= vf * dt / this.wr; if (w.front) w.pivot.rotation.y = this.steer; }
    this.hint = { x: this.pos.x, z: this.pos.z, psi: this.psi, speed: this.speed, groundH: this.pos.y };
    const col = this.world.roads?.col; if (col) col.player = { x: this.pos.x, z: this.pos.z, psi: this.psi, speed: vf };
  }
  /** translate by the velocity; if a probe point ends inside a building/prop, cancel the velocity into that wall (small bounce) and slide along it */
  moveBlocked(dt) {
    const b = this.world.buildings, mx = this.vx * dt, mz = this.vz * dt;
    if (!b) { this.pos.x += mx; this.pos.z += mz; return; }
    const hit = (x, z, yy) => b.hit(x, z, yy), p0 = this.probe(this.pos.x, this.pos.z);
    if (p0) {   // already overlapping a solid (spawned there, or shoved in by another collision): push out towards free space; only a car that is completely
      const n = wallNormal(hit, p0[0], p0[1], this.pos.y + 0.8, 0.7, this._n);   // enclosed may drive freely (otherwise it could cross a whole terrace of houses)
      if (n) { const vn = this.vx * n[0] + this.vz * n[1]; if (vn < 0) { this.vx -= vn * n[0]; this.vz -= vn * n[1]; } this.pos.x += (this.vx + n[0] * 4) * dt; this.pos.z += (this.vz + n[1] * 4) * dt; }
      else { this.pos.x += mx; this.pos.z += mz; }
      return;
    }
    const p = this.probe(this.pos.x + mx, this.pos.z + mz);
    if (!p) { this.pos.x += mx; this.pos.z += mz; return; }
    const y = this.pos.y + 0.8, n = wallNormal(hit, p[0], p[1], y, 0.7, this._n);
    if (!n) { this.vx *= -0.2; this.vz *= -0.2; return; }
    const vn = this.vx * n[0] + this.vz * n[1];
    if (vn < 0) {
      const e = 0.18; this.vx -= (1 + e) * vn * n[0]; this.vz -= (1 + e) * vn * n[1];
      const loss = Math.min(0.5, -vn * 0.02); this.vx *= 1 - loss; this.vz *= 1 - loss;       // scraping costs speed, a head-on hit costs most of it
      if (-vn > 3) this.bump = 0.3;
      const [fx, fz] = fwd(this.psi); this.psi += clamp((fx * n[1] - fz * n[0]) * -vn * 0.012, -0.06, 0.06);   // the nose is deflected along the wall
    }
    const sx = this.vx * dt, sz = this.vz * dt;                                               // slide with what is left
    if (!this.probe(this.pos.x + sx, this.pos.z + sz)) { this.pos.x += sx; this.pos.z += sz; }
  }
  /** first body probe point inside a building at (x,z), or null */
  probe(x, z) {
    const b = this.world.buildings; if (!b) return null;
    const [fx, fz] = fwd(this.psi), rx = -fz, rz = fx, y = this.pos.y + 0.8, o = this._p;
    for (const [l, s] of this.probes) { const px = x + fx * l + rx * s, pz = z + fz * l + rz * s; if (b.hit(px, pz, y)) { o[0] = px; o[1] = pz; return o; } }
    return null;
  }
  /** solids: three circles along the body; push out, cancel the velocity into the obstacle and bounce a little */
  collide(dt) {
    const col = this.world.roads?.col; if (!col) return; this.bump = Math.max(0, (this.bump || 0) - dt);
    const [fx, fz] = fwd(this.psi);
    const co = this.spec.wb, cr = this.spec.bike ? 0.5 : 0.7 + this.spec.W * 0.13;   // three circles along the body
    for (let pass = 0; pass < 2; pass++) for (const off of [co, 0, -co]) {
      const cx = this.pos.x + fx * off, cz = this.pos.z + fz * off, h = col.resolve(cx, cz, cr, 0.5, this.pos.y); if (!h) continue;
      if (h.tree && !h.dyn) { const v = Math.hypot(this.vx, this.vz);   // a tree: snapped if the momentum beats the trunk; the car ploughs on, losing speed in proportion
        if (col.tryBreak(h.tree, this.spec.mass, v, this.vx / (v || 1), this.vz / (v || 1))) { const k = 1 - 0.4 * h.tree.str / (this.spec.mass * v); this.vx *= k; this.vz *= k; this.bump = Math.max(this.bump, 0.3); this.crash = { mag: Math.min(1, 0.25 + h.tree.str / 4e4), t: performance.now() }; continue; } }
      this.pos.x += h.x - cx; this.pos.z += h.z - cz;
      const vn = this.vx * h.nx + this.vz * h.nz;
      const o = h.dyn, om = o ? (o.kind === 'heli' ? 3000 : VEHICLES[o.t ?? o.type]?.mass || 1450) : 0;
      if (o) { // car-to-car: the other body's velocity (traffic along its heading, parked = still) is subtracted; the lighter one takes more of the impulse
        const ov = o.v || 0, ofx = -Math.sin(o.psi || 0), ofz = -Math.cos(o.psi || 0), rv = (this.vx - ofx * ov) * h.nx + (this.vz - ofz * ov) * h.nz;   // closing speed along the normal
        if (rv < 0) {
          const e = 0.25, k = o.v !== undefined ? om / (this.spec.mass + om) : 1, j = -(1 + e) * rv;   // player's share k of the relative velocity change
          this.vx += j * k * h.nx; this.vz += j * k * h.nz; this.vx *= 0.97; this.vz *= 0.97;
          const mag = Math.min(1, -rv / 14), now = performance.now(), fresh = !this.crash || now - this.crash.t > 300; this.bump = Math.max(this.bump, 0.15 + mag * 0.5);
          // one crash = one dent, one jolt and one thud: the contact lasts several circles / steps (many when a heavy car ploughs into a light one), only the first and strongest counts
          if (fresh) { this.dmg = Math.min(1, (this.dmg || 0) + mag * mag * 0.5); this.rollV += (Math.random() - 0.5) * 6 * mag; this.pitchV += (Math.random() - 0.5) * 3 * mag; this.crash = { mag, t: now }; }   // audio.js reads crash
          this.psi += clamp((fx * h.nz - fz * h.nx) * -rv * 0.015 * Math.sign(off || 1) * (1 - k), -0.12, 0.12);
          if (o.v !== undefined && o.t !== undefined) {   // traffic car: shoved along its lane if hit from behind, then stops for a while (hazards on)
            const fw = -(h.nx * ofx + h.nz * ofz);   // >0: the player is behind it
            o.v = fw > 0.3 ? Math.min(o.vmax || 12, o.v + j * (1 - k) * 0.7) : 0; o.hitT = Math.max(o.hitT || 0, 2 + mag * 3);   // the weaker follow-up contacts must not shorten the stop
          }
        }
      } else if (vn < 0) { const e = 0.3; this.vx -= (1 + e) * vn * h.nx; this.vz -= (1 + e) * vn * h.nz; this.vx *= 0.96; this.vz *= 0.96; if (-vn > 3) this.bump = 0.3;
        this.psi += clamp((fx * h.nz - fz * h.nx) * -vn * 0.02 * Math.sign(off || 1), -0.1, 0.1);
        if (-vn > 2) this.crash = { mag: Math.min(1, -vn / 14), t: performance.now() }; }
    }
  }
  blocked(x, z) { return !!this.probe(x, z); }
  get velocityKmh() { return Math.abs(this.speed) * 3.6; }
}

// ------------------------------------------------------------------------ helicopter
const HPROBES = [[2.6, 0], [-1.6, 0], [0, 1.2], [0, -1.2], [-5.5, 0]];   // nose, cabin rear, sides, tail boom (forward, right) in metres
const SKIDS = [[0, 0], [1.7, 1.1], [1.7, -1.1], [-1.7, 1.1], [-1.7, -1.1]];
export class Heli {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.model = new THREE.Group(); this.group.add(this.model);
    const red = mat(0xd9d9d9), stripe = mat(0xc8321e), glass = mat(0x7fb6d8, { transparent: true, opacity: 0.75 }), dark = mat(0x222426);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), red); body.scale.set(1.05, 1.1, 2.2); body.position.y = 1.55; this.model.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glass); nose.scale.set(0.95, 0.85, 1.25); nose.position.set(0, 1.8, -1.35); this.model.add(nose);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 4.8, 10), red); boom.rotation.x = Math.PI / 2; boom.position.set(0, 1.9, 4.3); this.model.add(boom);
    this.model.add(box(0.1, 1.3, 0.9, stripe, 0, 2.5, 6.5));
    this.model.add(box(1.4, 0.07, 0.04, stripe, 0, 2.0, 1.2));
    for (const s of [-1, 1]) {
      this.model.add(box(0.1, 0.1, 3.8, dark, s * 1.1, 0.35, -0.2));
      this.model.add(box(0.08, 0.9, 0.1, dark, s * 1.0, 0.8, -1.0));
      this.model.add(box(0.08, 0.9, 0.1, dark, s * 1.0, 0.8, 0.8));
    }
    this.rotor = new THREE.Group(); this.rotor.position.set(0, 2.85, 0.1);
    this.rotor.add(box(0.28, 0.28, 0.28, dark));
    for (let i = 0; i < 4; i++) { const b = box(0.28, 0.04, 4.6, dark, 0, 0, -2.4); const p = new THREE.Group(); p.rotation.y = i * Math.PI / 2; p.add(b); this.rotor.add(p); }
    this.model.add(this.rotor);
    this.tail = new THREE.Group(); this.tail.position.set(0.25, 2.5, 6.5);
    for (let i = 0; i < 2; i++) { const b = box(0.04, 1.2, 0.18, dark); b.rotation.x = i * Math.PI / 2; this.tail.add(b); }
    this.model.add(this.tail);

    this.pos = new THREE.Vector3(); this.psi = 0;
    this.vf = 0; this.vs = 0; this.vy = 0; this.pitch = 0; this.roll = 0; this.spin = 0; this.yawRate = 0;
    this.af = 0; this.as = 0; this.airborne = true; this.groundY = 0; this._n = [0, 0];
    this.gear = 0.1;
  }
  place(x, y, z, psi) { this.pos.set(x, y, z); this.psi = psi; this.vf = this.vs = this.vy = 0; this.pitch = this.roll = 0; this.yawRate = 0; this.airborne = true; }

  /** One fixed physics step. Thrust + drag instead of eased velocities: the machine has weight (it keeps drifting when you let go, then the
   *  stability assist brings it to a hover), it cushions near the ground, and it can land on anything flat: terrain, bridge decks and rooftops. */
  update(dt, k) {
    const pad = k.pad || NOPAD, boost = k.ShiftLeft || k.ShiftRight ? 2.6 : 1;   // turbo: terminal speed 48 m/s x 2.6 = 125 m/s = 450 km/h
    const fIn = clamp((k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + pad.f, -1, 1), sIn = clamp(pad.s, -1, 1);
    const yIn = clamp((k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) + pad.yaw, -1, 1), uIn = clamp((k.Space ? 1 : 0) - (k.KeyX ? 1 : 0) + pad.up, -1, 1);
    const b = this.world.buildings, grounded = !this.airborne;
    // ---- horizontal: thrust along the body axes, linear drag (terminal speed = thrust / drag), stronger assist drag with the stick centred
    const DF = 0.45, DS = 0.6, AF = (fIn < 0 ? 22 : 48) * boost * DF, AS = 24 * boost * DS;
    if (!grounded) {
      this.af = fIn * AF - this.vf * (fIn ? DF : 1.0); this.as = sIn * AS - this.vs * (sIn ? DS : 1.2);
      this.vf += this.af * dt; this.vs += this.as * dt;
    } else { this.af = this.as = 0; const fr = Math.exp(-dt * 5); this.vf *= fr; this.vs *= fr; }   // skids on the ground
    // ---- vertical: collective with drag; hover hold when centred; ground cushion below ~5 m
    const AU = 20 * (boost > 1 ? 1.4 : 1) * 1.8;
    this.vy += (uIn * AU - this.vy * (uIn ? 1.8 : 3.2)) * dt;
    this.yawRate += (yIn * 1.15 - this.yawRate) * Math.min(1, dt * 3);
    this.psi += this.yawRate * dt;

    const [fx, fz] = fwd(this.psi), rx = -fz, rz = fx;
    let vx = fx * this.vf + rx * this.vs, vz = fz * this.vf + rz * this.vs;
    // ---- obstacles: the fuselage (4 points) against buildings / props whose top is above the skids
    if (b) {
      const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt, y = this.pos.y + 0.25, hit = (x, z, yy) => b.hit(x, z, yy);
      let hx = 0, hz = 0, blocked = false;
      for (const [l, s] of HPROBES) { const px = nx + fx * l + rx * s, pz = nz + fz * l + rz * s; if (b.hit(px, pz, y) && !b.hit(px - vx * dt, pz - vz * dt, y)) { hx = px; hz = pz; blocked = true; break; } }
      if (blocked) {
        const n = wallNormal(hit, hx, hz, y, 0.9, this._n);
        if (n) { const vn = vx * n[0] + vz * n[1]; if (vn < 0) { vx -= 1.3 * vn * n[0]; vz -= 1.3 * vn * n[1]; } } else { vx *= -0.2; vz *= -0.2; }
        this.vf = vx * fx + vz * fz; this.vs = vx * rx + vz * rz;
      } else { this.pos.x = nx; this.pos.z = nz; }
    } else { this.pos.x += vx * dt; this.pos.z += vz * dt; }

    // ---- what is underneath: terrain, bridge deck or the highest roof below the skids (max over the skid footprint so it never sinks at an edge)
    let ground = this.world.hf.height(this.pos.x, this.pos.z);
    { const rd = this.world.roads?.road(this.pos.x, this.pos.z, this.pos.y); if (rd && rd.y > ground && rd.y < this.pos.y + 1.5) ground = rd.y; }
    if (b?.topAt) for (const [l, s] of SKIDS) { const t = b.topAt(this.pos.x + fx * l + rx * s, this.pos.z + fz * l + rz * s, this.pos.y + 0.6); if (t > ground) ground = t; }
    this.groundY = ground;
    const minY = ground + this.gear, alt = this.pos.y - minY;
    if (this.vy < 0 && alt < 5) this.vy = Math.max(this.vy, -(1.2 + alt * 2.2));    // ground effect: the descent is cushioned, touchdown at ~1 m/s
    this.pos.y += this.vy * dt;
    if (this.pos.y <= minY) { this.pos.y = minY; if (this.vy < 0) this.vy = 0; }
    this.airborne = this.pos.y > minY + 0.15 || uIn > 0;

    const flying = this.airborne ? 1 : 0.35;
    this.spin += (30 * flying - this.spin) * Math.min(1, dt * 1.5);
    this.rotor.rotation.y += this.spin * dt;
    this.tail.rotation.x += this.spin * 1.4 * dt;
    // attitude follows the commanded acceleration (nose down to speed up, flare to brake) plus a little of the speed, banking into turns
    const tp = this.airborne ? clamp(-this.af / 30 * 0.26 - this.vf / 48 * 0.14, -0.42, 0.42) : 0, tr = this.airborne ? clamp(-this.as / 18 * 0.22 - this.vs / 24 * 0.1 - this.yawRate * this.vf / 48 * 0.25, -0.45, 0.45) : 0;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 3.5); this.roll += (tr - this.roll) * Math.min(1, dt * 3.5);
    this.model.rotation.set(this.pitch, 0, this.roll, 'YXZ');
    this.group.rotation.set(0, this.psi, 0);
    this.group.position.copy(this.pos);
  }
  get velocityKmh() { return Math.hypot(this.vf, this.vs) * 3.6; }
}

// ------------------------------------------------------------------------ parachute (after bailing out of a helicopter)
// Only the canopy lives here (group); main.js draws the walker's body at `pos` (feet). Free fall at up to ~190 km/h; Space (or 90 m above ground) opens the canopy,
// then it glides: W speeds up (steeper), S flares (slower, softer), A/D turn. Touching ground / a roof ends the jump (landed = true).
export class Chute {
  constructor(world) {
    this.world = world; this.group = new THREE.Group();
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const g = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4efe4' : '#d9482b'; g.fillRect(i * 8, 0, 8, 8); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    this.canopy = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    this.canopy.scale.y = 0.62; this.canopy.position.y = 5.2; this.group.add(this.canopy);
    const pts = [], R = 3.4 * Math.sin(Math.PI * 0.42), Yr = 5.2 + 3.4 * 0.62 * Math.cos(Math.PI * 0.42);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; pts.push(R * Math.cos(a), Yr, R * Math.sin(a), 0, 1.5, 0); }
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.group.add(this.lines);
    this.pos = new THREE.Vector3(); this.psi = 0; this.vx = this.vz = this.vy = 0; this.open = false; this.landed = false; this.t = 0; this.armed = false; this.speed = 0; this.groundY = 0; this._n = [0, 0];
    this.group.visible = false;
  }
  /** jump from `pos` carrying the given world velocity */
  start(x, y, z, psi, vx, vz, vy) { this.pos.set(x, y, z); this.psi = psi; this.vx = vx; this.vz = vz; this.vy = vy; this.open = false; this.landed = false; this.t = 0; this.armed = false; this.canopy.visible = this.lines.visible = false; this.openT = 0; }
  groundAt(x, z, y) { let g = this.world.surf(x, z, y, true); const t = this.world.buildings?.topAt?.(x, z, y + 0.6); return t > g ? t : g; }
  update(dt, k) {
    const pad = k.pad || NOPAD, f = clamp((k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + pad.f, -1, 1), turn = clamp((k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) + pad.yaw, -1, 1);
    this.t += dt; if (!k.Space) this.armed = true;
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y), agl = this.pos.y - g; this.groundY = g;
    if (!this.open && ((k.Space || pad.up > 0.5) && this.armed && this.t > 0.7 || agl < 90)) { this.open = true; this.openT = 0; this.canopy.visible = this.lines.visible = true; }
    const [fx, fz] = fwd(this.psi);
    if (!this.open) {   // free fall: drag-limited, a little steering by body position
      const a = -9.8 + 0.0036 * this.vy * this.vy * (this.vy < 0 ? 1 : -1);
      this.vy += a * dt; const ax = (fx * f) * 14, az = (fz * f) * 14;
      this.vx += (ax - this.vx * 0.35) * dt; this.vz += (az - this.vz * 0.35) * dt; this.psi += turn * dt * 1.4;
    } else {
      this.openT += dt; this.psi += turn * dt * 1.15;
      const vt = f > 0 ? 13 : f < 0 ? 4.5 : 8.5, k1 = 1 - Math.exp(-dt * 1.4);
      this.vx += (fx * vt - this.vx) * k1; this.vz += (fz * vt - this.vz) * k1;
      const sink = f > 0 ? -6.8 : f < 0 ? -3.2 : -5, kv = 1 - Math.exp(-dt * (this.vy < sink ? 1.6 : 0.8)); this.vy += (sink - this.vy) * kv;
      if (agl < 3 && f < 0) this.vy = Math.max(this.vy, -2.2);   // flare near the ground: soft landing
    }
    const b = this.world.buildings, nx = this.pos.x + this.vx * dt, nz = this.pos.z + this.vz * dt;
    if (b && b.hit(nx, nz, this.pos.y + 1) && b.hit(nx, nz, this.pos.y + 1.5)) { this.vx *= -0.3; this.vz *= -0.3; } else { this.pos.x = nx; this.pos.z = nz; }   // a wall stops the glide
    this.pos.y += this.vy * dt;
    const gg = this.groundAt(this.pos.x, this.pos.z, this.pos.y); this.groundY = gg;
    if (this.pos.y <= gg) { this.pos.y = gg; this.landed = true; }
    this.speed = Math.hypot(this.vx, this.vz);
    this.canopy.scale.setScalar(Math.min(1, this.openT * 1.6 + 0.2)); this.canopy.scale.y *= 0.62;
    this.group.position.copy(this.pos); this.group.rotation.set(0, this.psi, 0);
    this.canopy.rotation.z = -turn * 0.18; this.canopy.rotation.x = f > 0 ? 0.12 : f < 0 ? -0.15 : 0;
  }
  get velocityKmh() { return Math.hypot(this.vx, this.vz, this.vy) * 3.6; }
}
