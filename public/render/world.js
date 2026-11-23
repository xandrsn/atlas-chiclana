// v2 look (Phase 2): pre-lit worlds in the early-2000s way, with original art.
// - One world program for every baked cell: two pre-lit vertex palettes (day = sun + sky, night = moon + street lamps; bake_cells.mjs)
//   mixed by one uniform, surface kind per vertex -> layer of a procedural texture array (render/textures.js), procedural windows
//   (lit at night), emissive lamp heads, cheap animated water and salt pans, distance fog = draw distance. No lights, no extra draw calls.
// - Sky: one dome drawn last at the far plane (only empty pixels pay): gradient, sun / moon disc, stars, two-layer clouds.
// - TimeCycle: getTimecyc() (data/timecyc.json) drives all of it; game clock accelerated (minutesPerSecond), T jumps one hour.
import * as THREE from 'three';
import { getTimecyc } from './timecyc.js';
import { makeSurfaceLayers } from './textures.js';

const WORLD_VS = /* glsl */`
attribute vec4 dcol; attribute vec4 ncol;
uniform float uNight; uniform vec3 uTint;
varying vec3 vCol; varying vec3 vW; varying float vDepth; varying float vAux;
flat varying float vKind; flat varying float vAng; flat varying float vSeed;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  float a = floor(dcol.a * 255.0 + 0.5); vKind = floor(a / 16.0); vAng = a - vKind * 16.0; vSeed = ncol.a * 255.0; vAux = vSeed;
  vCol = mix(dcol.rgb * uTint, ncol.rgb, uNight);
  vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv;
}`;

// kinds (scripts/bake_cells.mjs KIND): 0 plain 1 grass 2 field 3 forest 4 salina 5 sand 6 dirt 7 water 8 paving 9 asphalt
// 10 wall+windows 11 wall 12 plinth 13 roof tiles 14 azotea 15 lamp head
const WORLD_FS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uTime, uNight, uWin, uLamp, uDay;
uniform vec3 uFog, uHor, uZen, uSunDir, uSunCol; uniform vec2 uFogR;
varying vec3 vCol; varying vec3 vW; varying float vDepth; varying float vAux;
flat varying float vKind; flat varying float vAng; flat varying float vSeed;
const float SC[16] = float[16](4.0, 6.0, 8.0, 6.0, 64.0, 6.0, 5.0, 4.0, 4.0, 4.0, 3.0, 3.0, 2.4, 4.0, 4.0, 4.0);   // metres per texture repeat
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 skyAt(vec3 r) { return mix(uHor, uZen, sqrt(clamp(r.y, 0.0, 1.0))); }
vec3 water(vec3 base, float amp, float refl) {   // two travelling wave trains -> normal; fresnel sky reflection + sun glint
  vec2 p = vW.xz, d = vec2(sin(p.x * 0.31 + uTime * 1.3) + sin(p.x * 0.17 + p.y * 0.23 - uTime * 0.9), cos(p.y * 0.27 - uTime * 1.1) + cos(p.x * 0.13 - p.y * 0.37 + uTime * 0.7));
  vec3 N = normalize(vec3(d.x * amp, 1.0, d.y * amp)), V = normalize(vW - cameraPosition), R = reflect(V, N);
  float fr = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 c = mix(base, skyAt(R), clamp(fr * refl + 0.15, 0.0, 1.0));
  return c + uSunCol * pow(max(dot(R, uSunDir), 0.0), 120.0) * (0.8 * uDay + 0.25 * (1.0 - uDay));
}
// open water (bake_cells.mjs waterSheet): flat sheet at the water level, vAux = depth (96 + 53 / m): shallow -> deep tint, scrolled noise ripples
// (layer 7), fresnel sky reflection, sun glint, animated foam on the shore line (depth ~0). base = pre-lit vertex colour (sun / moon / lamps).
vec3 water2(vec3 base) {
  float dep = clamp((vAux - 96.0) / 53.0, -1.0, 3.0), lit = dot(base, vec3(0.333)) / 0.33;
  vec2 p = vW.xz, n1 = texture(uTex, vec3(p / 31.0 + uTime * vec2(0.011, 0.006), 7.0)).rg - 0.5, n2 = texture(uTex, vec3(p / 7.3 - uTime * vec2(0.019, -0.023), 7.0)).ba - 0.5;
  vec2 d = n1 * 0.9 + n2 * 0.45 + 0.06 * vec2(sin(p.x * 0.23 + uTime * 1.2), cos(p.y * 0.21 - uTime * 0.95));
  vec3 N = normalize(vec3(d.x * 0.35, 1.0, d.y * 0.35)), V = normalize(vW - cameraPosition), R = reflect(V, N);
  R.y = abs(R.y);
  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 c = mix(base * vec3(1.05, 1.22, 1.0) + vec3(0.03, 0.04, 0.02) * lit, base * vec3(0.55, 0.72, 0.9), smoothstep(0.0, 2.2, dep));
  c = mix(c, skyAt(R) * mix(0.35, 1.0, uDay), clamp(fr * 0.7 + 0.05, 0.0, 0.6));
  c += uSunCol * pow(max(dot(R, uSunDir), 0.0), 160.0) * (0.9 * uDay + 0.2 * (1.0 - uDay));
  float fn = texture(uTex, vec3(p / 5.0 + uTime * vec2(0.03, 0.02), 7.0)).g, foam = smoothstep(0.32, 0.02, dep + (fn - 0.5) * 0.18) * (0.55 + 0.45 * sin(uTime * 1.7 + dep * 25.0 + fn * 6.0) * 0.5 + 0.25);
  return mix(c, vec3(0.88, 0.92, 0.94) * min(1.3, lit), clamp(foam, 0.0, 0.85));
}
void main() {
  int k = int(vKind + 0.5); vec3 col = vCol;
  float th = vAng / 16.0 * 3.14159265; vec2 t = vec2(cos(th), sin(th));
  if (k == 7) col = water2(col);
  else if (k == 15) col = mix(col, vec3(1.0, 0.86, 0.58), uLamp);
  else {
    vec2 uv;
    if (k >= 10 && k <= 12) uv = vec2(dot(vW.xz, t), vW.y) / vec2(SC[k], k == 12 ? 1.2 : 3.4);
    else if (k >= 13) uv = vec2(dot(vW.xz, t), dot(vW.xz, vec2(-t.y, t.x))) / SC[k];
    else uv = vW.xz / SC[k];
    vec4 tx = texture(uTex, vec3(uv, float(k)));
    if (k >= 1 && k <= 6 && k != 4) {   // natural ground: a second, rotated and rescaled tap of the same layer, blended by world noise -> no visible repeat
      vec4 tb = texture(uTex, vec3(mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.71 + 0.37, float(k)));
      tx = mix(tx, tb, smoothstep(0.3, 0.7, texture(uTex, vec3(vW.xz / 19.0, 15.0)).g));
    }
    vec3 d = tx.rgb * 2.0;
    if (k < 10) d *= mix(1.0, texture(uTex, vec3(vW.xz / 61.0, 15.0)).r * 2.0, k >= 8 ? 0.18 : 0.35);   // macro variation (layer 15 noise, world metres)
    col *= d;
    if (k == 4) col = mix(col, water(col * 0.9, 0.02, 0.25), 0.35 * (1.0 - smoothstep(0.35, 0.6, dot(col, vec3(0.3, 0.59, 0.11)))));   // salt pan: baked ortho colour (ocre / green / pink pools, white crust) with a shallow-water sheen; no tiled pattern
    if (k == 10) {   // windows: 3 m x 3.4 m cells on every facade, glass by day, some lit at night; fade to the average far away
      vec2 f = vec2(dot(vW.xz, t) / 3.0, vW.y / 3.4), c = floor(f), q = fract(f);
      float w = step(0.3, q.x) * step(q.x, 0.7) * step(0.3, q.y) * step(q.y, 0.78), fw = max(fwidth(f.x), fwidth(f.y)), near = clamp(1.6 - fw * 5.0, 0.0, 1.0);
      float lit = step(hash(c + vSeed * 0.731), 0.45), shut = step(0.72, hash(c * 1.7 + vSeed));
      vec3 glass = mix(vec3(0.16, 0.19, 0.24), skyAt(vec3(0.0, 0.3, 0.0)) * 0.55, 0.35) * (1.0 - 0.75 * uNight);
      vec3 shutter = vec3(0.30, 0.38, 0.26) * mix(1.0, 0.25, uNight);
      vec3 on = mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.9, 1.0), step(0.8, hash(c + 3.1))) * (0.75 + 0.25 * hash(c + 9.0));
      vec3 win = mix(mix(glass, shutter, shut * (1.0 - uWin * lit)), on, lit * uWin);
      vec3 far = mix(glass, on, 0.45 * uWin);
      col = mix(col, mix(far, win, near), mix(0.18, w, near));
    }
  }
  col = mix(col, uFog, smoothstep(uFogR.x, uFogR.y, vDepth));
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeMaterials(renderer) {
  const L = makeSurfaceLayers(), tex = new THREE.DataArrayTexture(L.data, L.size, L.size, L.layers);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() || 1); tex.needsUpdate = true;
  const u = { uTex: { value: tex }, uTime: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uWin: { value: 0 }, uLamp: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    uFog: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogR: { value: new THREE.Vector2(300, 700) } };
  return {
    u,
    world: new THREE.ShaderMaterial({ uniforms: u, vertexShader: WORLD_VS, fragmentShader: WORLD_FS }),
    tree: new THREE.MeshBasicMaterial({ vertexColors: true }),   // merged per-cell tree meshes (render/trees.js), pre-lit, wound outwards
    blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sky: new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }),
  };
}

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;   // at the far plane: drawn after the city, only where nothing else is
const SKY_FS = /* glsl */`
uniform float uTime, uNight, uDay; uniform vec3 uFog, uHor, uZen, uSunDir, uSunCol, uTint;
varying vec3 vDir;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 d = normalize(vDir); float y = d.y;
  vec3 c = mix(uHor, uZen, sqrt(clamp(y, 0.0, 1.0)));
  float s = dot(d, uSunDir);
  if (uNight < 0.5) c += uSunCol * (pow(max(s, 0.0), 8.0) * 0.25 + smoothstep(0.9993, 0.9996, s) * 1.5) * uDay;   // sun halo + disc
  else c += vec3(0.85, 0.88, 0.95) * smoothstep(0.99955, 0.9998, s) + vec3(0.2, 0.22, 0.3) * pow(max(s, 0.0), 30.0) * 0.3;   // moon
  vec2 sp = floor(d.xz / max(y, 0.05) * 90.0);
  c += vec3(step(0.9975, h2(sp))) * smoothstep(0.55, 0.95, uNight) * smoothstep(0.05, 0.3, y) * (0.5 + 0.5 * sin(uTime * 3.0 + h2(sp + 7.0) * 40.0));   // stars
  if (y > 0.0) {   // clouds on a plane: two noise octaves drifting with the wind
    vec2 p = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float n = vn(p) * 0.65 + vn(p * 2.7 + 3.1) * 0.35, cov = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.25, y);
    vec3 cl = mix(uTint * 0.95, uSunCol * uTint + 0.05, 0.4 + 0.6 * uDay) * mix(1.0, 0.82, smoothstep(0.6, 0.9, n));
    c = mix(c, cl * mix(1.0, 0.35, uNight), cov * 0.85);
  }
  c = mix(uFog, c, smoothstep(-0.02, 0.1, y));   // horizon melts into the fog colour: distant city fades into the sky
  gl_FragColor = vec4(c, 1.0);
}`;

/** the sky dome (one draw call, its own small program) */
export function makeSky(mats) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), mats.sky);
  m.frustumCulled = false; m.renderOrder = 1e6; return m;
}

/** time of day: getTimecyc() -> fog (colour + range = draw distance), sky, palette mix, lamps and windows; also scene.fog for the trees */
export class TimeCycle {
  constructor(tc, scene, mats, Q) {
    const qs = new URLSearchParams(location.search);
    this.tc = tc; this.h = +(qs.get('hour') ?? tc.startHour); this.rate = qs.get('clock') === '0' ? 0 : tc.minutesPerSecond / 60;
    this.scene = scene; this.mats = mats; this.Q = Q; this.t = 0; scene.fog = new THREE.Fog(0, Q.drawDist * 0.45, Q.drawDist); scene.background = new THREE.Color();
    this.apply();
  }
  apply() {
    const s = getTimecyc(this.h, this.tc), u = this.mats.u, b = v => v.map(x => x / 255), D = this.Q.drawDist;
    const night = Math.min(1, Math.max(0, (0.85 - s.sunInt) / 0.67));   // sunInt 0.85+ = full day palette, 0.18 = full night palette
    u.uFog.value.setRGB(...b(s.fog)); u.uHor.value.setRGB(...b(s.horizon)); u.uZen.value.setRGB(...b(s.zenith));
    u.uTint.value.setRGB(...s.light); u.uSunCol.value.setRGB(...s.sun); u.uSunDir.value.set(...s.sunDir);
    u.uNight.value = night; u.uDay.value = Math.min(1, s.sunInt); u.uWin.value = s.windows; u.uLamp.value = s.lamps; u.uFogR.value.set(s.fogNear * D, s.fogFar * D);
    this.scene.fog.color.copy(u.uFog.value); this.scene.fog.near = s.fogNear * D; this.scene.fog.far = s.fogFar * D; this.scene.background.copy(u.uFog.value);
    this.mats.tree.color.setRGB(...s.light);
    this.s = s;
  }
  /** advance the game clock (dt real seconds) and the water/cloud time */
  update(dt) { this.t += dt; this.mats.u.uTime.value = this.t % 3600; if (this.rate) { this.h = (this.h + dt * this.rate) % 24; this.apply(); } }
  skip(hours) { this.h = (this.h + hours + 24) % 24; this.apply(); }
  /** HH:MM of the game clock */
  get clock() { const m = Math.floor(this.h * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
}

/** blob shadow: a soft-edged dark disc laid on the ground under a moving object */
export function blobShadow(mats, rx, rz) {
  const g = new THREE.CircleGeometry(1, 16); g.rotateX(-Math.PI / 2); g.scale(rx, 1, rz);
  return new THREE.Mesh(g, mats.blob);
}
