// Low-poly mesh kit shared by vehicles and pedestrians: flat faces, non-indexed, pre-lit vertex colours (same look as render/world.js:
// unlit MeshBasicMaterial whose .color is the time-of-day light), one paint channel that InstancedMesh.setColorAt() replaces per instance,
// and optional bone ids + pivots for the pedestrian walk cycle done in the vertex shader.
import * as THREE from 'three';

/** deterministic PRNG (mulberry32): rng(seed)() -> [0,1) */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

const SUN = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
export const shadeOf = n => 0.62 + 0.38 * Math.max(0, n.dot(SUN)) + 0.08 * n.y;   // baked "pre-lit" light, matches the unlit world

export class Builder {
  constructor() { this.pos = []; this.col = []; this.paint = []; this.bone = []; this.pivot = []; this.c = new THREE.Color(1, 1, 1); this.isPaint = false; this.b = 0; this.pv = [0, 0, 0]; this.ctr = null; }
  /** current style for the next faces: colour (hex/css), paint (true: instance colour replaces it; a LAMP code: light / glass), bone id + pivot (peds) */
  style(color, paint = false) { this.c = new THREE.Color(color); this.isPaint = paint; return this; }
  rig(bone, pivot) { this.b = bone; this.pv = pivot; return this; }
  tri(a, b, c) {
    if (this.ctr) {   // parts are convex: orient every face away from the part centre so winding never has to be hand-checked
      const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
      const m = new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3).sub(this.ctr);
      if (n.dot(m) < 0) [b, c] = [c, b];
    }
    for (const v of [a, b, c]) { this.pos.push(v.x, v.y, v.z); this.col.push(this.c.r, this.c.g, this.c.b); this.paint.push(typeof this.isPaint === 'number' ? this.isPaint : this.isPaint ? 1 : 0); this.bone.push(this.b); this.pivot.push(...this.pv); }
  }
  poly(pts) { for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1]); }
  /** 8 corners indexed (x?1:0)|(y?2:0)|(z?4:0); faceStyle(name) may restyle a face: name in x-,x+,y-,y+,z-,z+ */
  hexa(k, faceStyle) {
    const save = [this.c, this.isPaint];
    this.ctr = k.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / 8);
    for (const [name, f] of [['x-', [0, 2, 6, 4]], ['x+', [1, 5, 7, 3]], ['y-', [0, 4, 5, 1]], ['y+', [2, 3, 7, 6]], ['z-', [0, 1, 3, 2]], ['z+', [4, 6, 7, 5]]]) {
      if (faceStyle) { const s = faceStyle(name); if (s === null) continue; if (s) { this.c = new THREE.Color(s[0]); this.isPaint = !!s[1]; } else [this.c, this.isPaint] = save; }
      this.poly(f.map(i => k[i]));
    }
    [this.c, this.isPaint] = save; this.ctr = null;
  }
  /** axis-aligned box [x0,x1]x[y0,y1]x[z0,z1]; top face scaled by (tx,tz) about its centre (taper) */
  box(x0, x1, y0, y1, z0, z1, faceStyle, tx = 1, tz = 1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, k = [];
    for (let i = 0; i < 8; i++) { const top = i & 2; let x = i & 1 ? x1 : x0, z = i & 4 ? z1 : z0; if (top) { x = cx + (x - cx) * tx; z = cz + (z - cz) * tz; } k.push(new THREE.Vector3(x, top ? y1 : y0, z)); }
    this.hexa(k, faceStyle);
  }
  /** convex side profile pts [[z,y]...] extruded across x = cx ± hw(y); edgeStyle(i) restyles strip i (pts[i]->pts[i+1]), null skips it */
  prism(pts, hw, edgeStyle, capStyle, cx = 0) {
    const save = [this.c, this.isPaint], set = s => { if (s) { this.c = new THREE.Color(s[0]); this.isPaint = !!s[1]; } else [this.c, this.isPaint] = save; };
    const zc = pts.reduce((s, p) => s + p[0], 0) / pts.length, yc = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    this.ctr = new THREE.Vector3(cx, yc, zc);
    const V = (p, sx) => new THREE.Vector3(cx + sx * hw(p[1]), p[1], p[0]);
    for (const sx of [-1, 1]) { const s = capStyle ? capStyle() : undefined; if (s !== null) { set(s); this.poly(pts.map(p => V(p, sx))); } }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], s = edgeStyle ? edgeStyle(i) : undefined;
      if (s === null) continue; set(s);
      this.poly([V(a, -1), V(b, -1), V(b, 1), V(a, 1)]);
    }
    [this.c, this.isPaint] = save; this.ctr = null;
  }
  /** cylinder along X (wheel): centre, radius, width, sides; capColor for the outer hub */
  cylX(cx, cy, cz, r, w, n, hubColor, outer = Math.sign(cx) || 1) {
    this.ctr = new THREE.Vector3(cx, cy, cz);
    const ring = (x, rr) => Array.from({ length: n }, (_, i) => new THREE.Vector3(x, cy + rr * Math.cos((i + 0.5) / n * 2 * Math.PI), cz + rr * Math.sin((i + 0.5) / n * 2 * Math.PI)));
    const A = ring(cx - w / 2, r), B = ring(cx + w / 2, r);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.poly([A[i], A[j], B[j], B[i]]); }
    this.poly(A); this.poly(B);
    if (hubColor) { const save = [this.c, this.isPaint]; this.style(hubColor); this.poly(ring(cx + outer * (w / 2 + 0.004), r * 0.6)); [this.c, this.isPaint] = save; }
    this.ctr = null;
  }
  /** rounded part along y (limbs, torso, head): rings [y, cx, cz, rx, rz] bottom to top, n sides (r 0 = a point: a cone tip);
   *  cols[i] = colour / [colour, paint] of the band ring i -> i+1 (default: the current style); caps: close the ends (a ring with r > 0) */
  loft(rings, n = 8, cols = [], caps = [true, true]) {
    const save = [this.c, this.isPaint], V = THREE.Vector3;
    const P = rings.map(([y, cx, cz, rx, rz]) => Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * 2 * Math.PI; return new V(cx + rx * Math.sin(a), y, cz + rz * Math.cos(a)); }));
    const ctr = r => new V(r[1], r[0], r[2]), flat = r => r[3] === 0 && r[4] === 0;
    for (let k = 0; k + 1 < rings.length; k++) {
      const s = cols[k]; if (s !== undefined) { if (Array.isArray(s)) this.style(s[0], s[1]); else this.style(s); }
      this.ctr = ctr(rings[k]).add(ctr(rings[k + 1])).multiplyScalar(0.5);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, A = P[k], B = P[k + 1];
        if (flat(rings[k])) this.tri(A[0], B[i], B[j]); else if (flat(rings[k + 1])) this.tri(A[i], A[j], B[0]); else this.poly([A[i], A[j], B[j], B[i]]); }
    }
    for (const [e, k, dy] of [[0, 0, 1], [1, rings.length - 1, -1]]) if (caps[e] && !flat(rings[k])) { this.ctr = ctr(rings[k]).add(new V(0, dy, 0)); this.poly(P[k]); }
    [this.c, this.isPaint] = save; this.ctr = null;
  }
  /** flat quad (decals: windows, lights, stripes); oriented away from ctr */
  quad(a, b, c, d, ctr) { this.ctr = ctr; this.poly([a, b, c, d]); this.ctr = null; }
  get triangles() { return this.pos.length / 9; }
  /** -> BufferGeometry: position, normal, color (albedo x baked light), aPaint (0 = fixed, else baked light for the instance colour) [, aBone, aPivot] */
  geometry({ rigged = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();   // non-indexed -> face normals (flat)
    const nrm = g.attributes.normal, col = this.col.slice(), paint = this.paint.slice(), n = new THREE.Vector3();
    for (let i = 0; i < nrm.count; i++) { n.fromBufferAttribute(nrm, i); const s = shadeOf(n); col[i * 3] *= s; col[i * 3 + 1] *= s; col[i * 3 + 2] *= s; if (paint[i] > 0) paint[i] = s; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 1));
    if (rigged) { g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1)); g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pivot, 3)); }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Unlit vertex-colour material (like render/world.js). With InstancedMesh.setColorAt the instance colour replaces the paint channel
 *  (keeping the baked light). anim: pedestrian walk cycle from aBone/aPivot + per-instance aAnim (x = gait 0 idle,1 walk,2 run; y = phase);
 *  advance material.userData.time.value each frame. */
export function makeLowpolyMaterial({ anim = false } = {}) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true }), time = { value: 0 }, night = { value: 0 };
  m.userData.time = time; m.userData.night = night;   // advance time every frame; night 0..1 (headlights, tail lights, dimmer reflections)
  m.defaultAttributeValues = { aSel: [0], aModel: [0], aLights: [0, 0], aPose: [0, 0, 0, 0] };   // geometries without them read 0 (not a generic value left by another program)
  m.customProgramCacheKey = () => 'lowpoly' + (anim ? '-anim' : '');
  m.onBeforeCompile = s => {
    s.uniforms.uTime = time; s.uniforms.uNight = night;
    // fleet geometry (traffic/ambient.js): several models in one geometry (aModel per vertex); the instance shows one (aSel = model + 1, 0 = all)
    // aPaint < 0 = LAMP code (head, tail, indicators, glass); aLights per instance = (brake 0..1, indicator 0 off / 1 left / 2 right / 3 hazard)
    let head = `uniform float uTime; uniform float uNight; varying float vEm; attribute float aPaint; attribute float aModel;
#if defined(USE_INSTANCING) && ${anim ? 0 : 1}
attribute float aSel; attribute vec2 aLights;
#else
const float aSel = 0.0; const vec2 aLights = vec2(0.0);   // pedestrians have no fleet models / lamps: frees attribute slots for aPose
#endif
`;
    s.vertexShader = s.vertexShader.replace('#include <project_vertex>', `#ifdef USE_INSTANCING
  if (aSel > 0.5 && abs(aSel - 1.0 - aModel) > 0.5) transformed = vec3(0.0);   // other models collapse to a point: zero-area triangles
#endif
#include <project_vertex>
#if defined(USE_INSTANCING) && ${anim ? 0 : 1}
  if (aPaint > 0.0 || aPaint < -4.5) {   // fake reflection on paint and glass: the sky in the reflected ray, stronger at grazing angles
    vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal), v = normalize(-mvPosition.xyz), up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float f = pow(1.0 - abs(dot(n, v)), 2.0), r = smoothstep(-0.15, 0.7, dot(reflect(-v, n), up));
    vColor += vec3(0.8, 0.88, 1.0) * (0.06 + 0.26 * f) * r * mix(1.0, 0.25, uNight) * (aPaint < 0.0 ? 1.6 : 1.0);
  }
#endif`);
    s.vertexShader = s.vertexShader.replace('#include <color_vertex>', `vColor = color; vEm = 0.0;
#ifdef USE_INSTANCING_COLOR
  if (aPaint > 0.0) vColor = instanceColor * aPaint;
#endif
${anim ? '' : `#ifdef USE_INSTANCING
  if (aPaint > 0.0) {   // wear: per-parked-car dirt on the lower body (hash of the instance position; the player's own car sits at the origin: clean)
    float w = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    vColor *= 1.0 - 0.32 * w * smoothstep(0.75, 0.2, position.y);
  }
#endif`}
  if (aPaint < -0.5 && aPaint > -4.5) {
    float k = -aPaint, blink = step(0.5, fract(uTime * 1.5)), ind = aLights.y, on = step(-0.5, aLights.x);   // brake < 0 = parked: lamps off
    if (k < 1.5) { vColor = vec3(1.0, 0.95, 0.78); vEm = uNight * on; }
    else if (k < 2.5) { vColor = vec3(1.0, 0.1, 0.07) * (0.55 + 0.45 * max(aLights.x, 0.0)); vEm = max(uNight * 0.85 * on, aLights.x); }
    else { bool lit = ind > 2.5 || (k < 3.5 ? abs(ind - 1.0) < 0.5 : abs(ind - 2.0) < 0.5); vColor = vec3(1.0, 0.55, 0.08); vEm = lit ? blink : 0.0; }
  }`);
    s.fragmentShader = 'varying float vEm;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vColor, vEm);   // lamps ignore the time-of-day light');
    if (anim) {
      head += `attribute float aBone; attribute vec3 aPivot;
#ifdef USE_INSTANCING
attribute vec2 aAnim; attribute vec4 aPose;
#else
const vec2 aAnim = vec2(0.0); const vec4 aPose = vec4(0.0);
#endif
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
// aAnim.x: 0 idle .. 1 walk .. 2 run (blend), 3 jump, 4 swim, 5 sit (getting into a vehicle)
mat3 limbRot() {
  float g = aAnim.x, a = 0.0;
  if (g > 2.5) {
    if (g < 3.5) a = aBone < 0.5 ? 0.0 : aBone < 1.5 ? -0.8 : aBone < 2.5 ? 0.35 : -2.5;                       // jump: one knee up, arms up
    else if (g < 4.5) { float t = uTime * 3.4 + aAnim.y, k = 0.35 * sin(t * 2.6);                               // crawl: windmill arms, flutter kick
      a = aBone < 0.5 ? 0.0 : aBone < 1.5 ? k : aBone < 2.5 ? -k : aBone < 3.5 ? -t : -t + 3.14159; }
    else a = aBone < 0.5 ? 0.0 : aBone < 2.5 ? -1.45 : -1.05;                                                     // seated, hands on the wheel
    return rotX(a);
  }
  float walk = clamp(g, 0.0, 1.0), run = clamp(g - 1.0, 0.0, 1.0);
  float ph = uTime * mix(5.6, 9.6, run) + aAnim.y, s = sin(ph);
  float leg = walk * mix(0.42, 0.85, run) * s, arm = walk * mix(0.32, 0.9, run) * s + (1.0 - walk) * 0.05 * sin(uTime * 1.3 + aAnim.y);
  a = aBone < 0.5 ? 0.0 : aBone < 1.5 ? leg : aBone < 2.5 ? -leg : aBone < 3.5 ? -arm : arm;
  return rotX(a);
}

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
// foot path along the stride (u 0..1, duty d): stance = planted, moves back at ground speed; swing = lifted, eased forward. -> (forward m, lift m)
vec2 footPath(float u, float A, float d, float H) {
  u = fract(u); if (u < d) return vec2(A * (1.0 - 2.0 * u / d), 0.0);
  float t = (u - d) / (1.0 - d); return vec2(-A + 2.0 * A * (t - sin(6.28318 * t) / 6.28318), H * sin(3.14159 * t));
}
// player locomotion (aAnim.x = 6 + gait on foot, 9 airborne): aPose = (stride phase, half stride, crouch m, ground slope) or (vy, 0, crouch, 0) airborne.
// Legs: two-bone IK (hip -> knee -> ankle from the leg pivot; shin / foot weighted by height) onto the foot path; arms counter-swing with bent elbows;
// pelvis bobs and crouches, torso pitches and twists, chest breathes at rest.
vec3 loco(vec3 p) {
  const float HIP = 0.9;
  float g = aAnim.x - 6.0, air = step(2.5, g), walk = clamp(g, 0.0, 1.0), run = clamp(g - 1.0, 0.0, 1.0), cr = aPose.z;
  float ph = aPose.x / 6.28318, A = aPose.y, d = mix(0.6, 0.4, run), H = mix(0.07, 0.13, run) * clamp(A / 0.3, 0.0, 1.0), idle = 1.0 - walk;
  float sw = sin(aPose.x), bob = mix(0.006, 0.015, run) * 0.5 * (1.0 - cos(2.0 * (aPose.x - d * 3.14159))) * clamp(A / 0.3, 0.0, 1.0);
  float dy = -cr - (1.0 - air) * bob, pitch = (1.0 - air) * (0.01 + 0.03 * run) + cr * 1.2, tw = (1.0 - air) * mix(0.03, 0.08, run) * sw * walk;
  vec2 fl = footPath(ph, A, d, H), fr = footPath(ph + 0.5, A, d, H);
  float amp = mix(0.16, 0.6, run) * walk / max(A, 0.2), armL = -amp * fr.x + cr * 1.6, armR = -amp * fl.x + cr * 1.6, bend = mix(0.2, 1.1, run) * walk + 0.12;
  vec3 q = p; float b = uTime;
  if (air > 0.5) {   // jump: knee up, arms up; fall: legs reaching down, arms flailing
    float up = smoothstep(-2.5, 1.0, aPose.x), fl2 = sin(uTime * 14.0) * 0.25;
    float la = aBone < 0.5 ? 0.0 : aBone < 1.5 ? mix(-0.3, -0.8, up) : aBone < 2.5 ? mix(0.3, 0.35, up) : mix(-1.9 + fl2 * (aBone < 3.5 ? 1.0 : -1.0), -2.5, up);
    q = aPivot + rotX(la) * (p - aPivot); q.y += dy;
    return q;
  }
  float w = smoothstep(HIP, HIP + 0.25, p.y);
  if (aBone < 0.5) {   // body: chest breathes, upper part pitches / twists about the hip
    q = p; q.xz *= 1.0 + 0.012 * sin(b * 1.9) * idle * w * step(p.y, 1.42);
    q = vec3(0.0, HIP, 0.0) + rotX(pitch * w) * rotY(tw * w) * (q - vec3(0.0, HIP, 0.0));
  } else if (aBone < 2.5) {   // legs: IK
    float L1 = aPivot.y * 0.4556, L2 = aPivot.y - L1 - 0.085;
    vec2 f = aBone < 1.5 ? fl : fr; float u = fract(aBone < 1.5 ? ph : ph + 0.5);
    float tz = f.x, ty = -(aPivot.y + dy - 0.085) + f.y + aPose.w * f.x;
    float dd = clamp(length(vec2(tz, ty)), 0.15, (L1 + L2) * 0.998), phi = atan(-tz, -ty);
    float al = acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2.0 * L1 * dd), -1.0, 1.0)), ga = acos(clamp((L1 * L1 + L2 * L2 - dd * dd) / (2.0 * L1 * L2), -1.0, 1.0));
    float a = phi - al, kb = 3.14159 - ga, toe = u < d ? 0.45 * smoothstep(0.6, 1.0, u / d) : -0.3 * smoothstep(0.7, 1.0, (u - d) / (1.0 - d));
    vec3 pl = p - aPivot, k0 = vec3(0.0, -L1, 0.0), a0 = vec3(0.0, -(aPivot.y - 0.085), 0.0);
    vec3 thigh = rotX(a) * pl, shin = rotX(a) * (k0 + rotX(kb) * (pl - k0)), foot = rotX(a) * (k0 + rotX(kb) * (a0 - k0 + rotX(-(a + kb) + toe * walk) * (pl - a0)));
    q = aPivot + mix(mix(thigh, shin, smoothstep(aPivot.y * 0.6, aPivot.y * 0.5, p.y)), foot, smoothstep(0.13, 0.08, p.y));
  } else {   // arms: swing from the shoulder, forearm bends at the elbow, then follow the torso
    float ar = aBone < 3.5 ? armL : armR, e = aPivot.y * 0.2086;
    vec3 pl = p - aPivot, e0 = vec3(0.0, -e, 0.0), arm = rotX(ar) * pl, fore = rotX(ar) * (e0 + rotX(-bend) * (pl - e0));
    q = aPivot + mix(arm, fore, smoothstep(aPivot.y * 0.8, aPivot.y * 0.77, p.y));
    q.y += 0.006 * sin(b * 1.9) * idle;
    q = vec3(0.0, HIP, 0.0) + rotX(pitch) * rotY(tw) * (q - vec3(0.0, HIP, 0.0));
  }
  q.y += dy; return q;
}
`;
      s.vertexShader = s.vertexShader
        .replace('#include <begin_vertex>', `vec3 transformed = aAnim.x > 5.5 ? loco(position) : aPivot + limbRot() * (position - aPivot);   // unlit: normals not needed
if (aAnim.x > 5.5) { }
else if (aAnim.x > 4.5) transformed.y -= 0.45;                                          // sitting down
else if (aAnim.x > 3.5) transformed = rotX(1.45) * (transformed - vec3(0.0, 0.95, 0.0)) + vec3(0.0, 0.03 * sin(uTime * 3.0 + aAnim.y), 0.0);   // swimming: face down, hips at the origin
else if (aAnim.x < 2.5) { float walk = clamp(aAnim.x, 0.0, 1.0), run = clamp(aAnim.x - 1.0, 0.0, 1.0), ph = uTime * mix(5.6, 9.6, run) + aAnim.y;
  transformed = rotX(0.16 * run) * transformed;                       // running lean, pivot at the feet
  transformed.y += walk * abs(cos(ph)) * mix(0.025, 0.07, run) + (1.0 - walk) * 0.004 * sin(uTime * 1.7 + aAnim.y); }`);
    }
    s.vertexShader = head + s.vertexShader;
  };
  return m;
}

/** LAMP codes for Builder.style(colour, code): faces that light up (lowpoly material, aLights per instance) */
export const LAMP = { head: -1, tail: -2, indL: -3, indR: -4, glass: -5 };

/** per-instance lights: brake 0..1 (-1 = parked, lamps off), indicator 0 off / 1 left / 2 right / 3 hazard. The geometry must belong to this mesh only, or share the attribute. */
export function setLights(mesh, i, brake, ind) {
  let a = mesh.geometry.getAttribute('aLights');
  if (!a || a.count < mesh.count) { a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(mesh.count, 1) * 2), 2); mesh.geometry.setAttribute('aLights', a); }
  a.setXY(i, brake, ind); a.needsUpdate = true;
}
