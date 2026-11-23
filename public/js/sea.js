import * as THREE from 'three';
import { K } from './geo.js';

export const SEA_LEVEL = 0.25;      // DEM cells at or below this are water

// -------------------------------------------------------------- coarse land analysis (islets + distance to shore)
export function analyzeSea(hf) {
  const cw = hf.W >> 1, ch = hf.H >> 1, N = cw * ch, g = hf.grid, W = hf.W;
  const land = new Uint8Array(N);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const o = 2 * j * W + 2 * i;
    land[j * cw + i] = Math.max(g[o], g[o + 1], g[o + W], g[o + W + 1]) > SEA_LEVEL ? 1 : 0;
  }
  // connected components of land -> small ones are islets
  const comp = new Int32Array(N), q = new Int32Array(N), size = [0];
  let nc = 0;
  for (let s = 0; s < N; s++) {
    if (!land[s] || comp[s]) continue;
    nc++; let h = 0, t = 0; q[t++] = s; comp[s] = nc;
    while (h < t) {
      const c = q[h++], x = c % cw, y = (c / cw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx; if (land[n] && !comp[n]) { comp[n] = nc; q[t++] = n; }
      }
    }
    size.push(t);
  }
  const small = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (comp[i] && size[comp[i]] < 8000) small[i] = 1;
  // chamfer distance (metres) from land
  const cell = 2 * hf.s * K, dist = new Float32Array(N), A = 1, B = 1.414, INF = 1e9;
  for (let i = 0; i < N; i++) dist[i] = land[i] ? 0 : INF;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x; let d = dist[i]; if (!d) continue;
    if (x > 0) d = Math.min(d, dist[i - 1] + A);
    if (y > 0) { d = Math.min(d, dist[i - cw] + A); if (x > 0) d = Math.min(d, dist[i - cw - 1] + B); if (x < cw - 1) d = Math.min(d, dist[i - cw + 1] + B); }
    dist[i] = d;
  }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) {
    const i = y * cw + x; let d = dist[i]; if (!d) continue;
    if (x < cw - 1) d = Math.min(d, dist[i + 1] + A);
    if (y < ch - 1) { d = Math.min(d, dist[i + cw] + A); if (x < cw - 1) d = Math.min(d, dist[i + cw + 1] + B); if (x > 0) d = Math.min(d, dist[i + cw - 1] + B); }
    dist[i] = d;
  }
  for (let i = 0; i < N; i++) dist[i] = Math.min(dist[i] * cell, 3000);
  // water not connected to the open sea (marshes, salinas, ponds): calm, no shore foam
  const open = new Uint8Array(N); { let h = 0, t = 0;
    const push = i => { if (!land[i] && !open[i]) { open[i] = 1; q[t++] = i; } };
    for (let x = 0; x < cw; x++) { push(x); push((ch - 1) * cw + x); } for (let y = 0; y < ch; y++) { push(y * cw); push(y * cw + cw - 1); }
    while (h < t) { const c = q[h++], x = c % cw, y = (c / cw) | 0; if (x > 0) push(c - 1); if (x < cw - 1) push(c + 1); if (y > 0) push(c - cw); if (y < ch - 1) push(c + cw); } }
  for (let i = 0; i < N; i++) if (!land[i] && !open[i]) dist[i] = 160;
  const r = hf.worldRect();
  const isSmallLand = (x, z) => {
    const i = Math.floor((x - r.x0) / r.w * cw), j = Math.floor((z - r.z0) / r.h * ch);
    return i >= 0 && j >= 0 && i < cw && j < ch && small[j * cw + i] === 1;
  };
  return { cw, ch, dist, rect: r, isSmallLand };
}

// -------------------------------------------------------------- water material
export const waterTime = { value: 0 };
const VERT = /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */`
uniform float time; uniform vec3 sunDir; uniform vec3 fogColor; uniform float fogDensity;
uniform float lite; uniform sampler2D mask; uniform vec4 maskRect; uniform sampler2D shore; uniform vec4 shoreRect; uniform float useShore;
varying vec3 vW;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec2 wave(vec2 p, vec2 d, float k, float sp, float a, float dist){
  float f = smoothstep(140.0, 28.0, dist * k);                       // fade short waves with distance -> no moire, calm horizon
  return d * (a * k * cos(k * dot(d, p) + sp * time) * f);
}
void main(){
  vec2 mu = (vW.xz - maskRect.xy) / maskRect.zw;
  if (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0 || texture2D(mask, mu).r < 0.5) discard;
  float dist = length(vW - cameraPosition);
  vec3 V = (cameraPosition - vW) / dist;
  vec2 p = vW.xz;
  if (lite > 0.5) {                                                // cheap water: flat shore->deep gradient + fog, no waves / foam
    float sdl = (useShore > 0.5) ? texture2D(shore, (vW.xz - shoreRect.xy) / shoreRect.zw).r : 200.0;
    float tl = smoothstep(0.0, 700.0, sdl);
    vec3 cl = tl < 0.3 ? mix(vec3(0.36, 0.80, 0.74), vec3(0.10, 0.55, 0.66), tl / 0.3) : mix(vec3(0.10, 0.55, 0.66), vec3(0.025, 0.26, 0.47), (tl - 0.3) / 0.7);
    float dl = dist * fogDensity; cl = mix(cl, fogColor, 1.0 - exp(-dl * dl));
    gl_FragColor = vec4(cl, (useShore > 0.5) ? smoothstep(0.0, 14.0, sdl) : 1.0); return;
  }
  vec2 g = wave(p, normalize(vec2(1.0, 0.35)), 0.045, 0.7, 1.6, dist) + wave(p, normalize(vec2(-0.4, 1.0)), 0.11, 1.0, 0.55, dist)
         + wave(p, normalize(vec2(0.8, -0.7)), 0.29, 1.4, 0.16, dist) + wave(p, normalize(vec2(-1.0, -0.3)), 0.7, 1.9, 0.045, dist);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float sd = 200.0;
  if (useShore > 0.5) sd = texture2D(shore, (vW.xz - shoreRect.xy) / shoreRect.zw).r;
  float t = smoothstep(0.0, 700.0, sd);
  vec3 shallow = vec3(0.36, 0.80, 0.74), mid = vec3(0.10, 0.55, 0.66), deep = vec3(0.025, 0.26, 0.47);
  vec3 base = t < 0.3 ? mix(shallow, mid, t / 0.3) : mix(mid, deep, (t - 0.3) / 0.7);
  base *= 0.94 + 0.06 * sin(p.x * 0.011 + time * 0.1) * sin(p.y * 0.013 - time * 0.08);    // slow large-scale tint drift
  vec3 R = reflect(-V, N);
  vec3 sky = mix(fogColor, vec3(0.34, 0.58, 0.90), clamp(R.y * 1.8, 0.0, 1.0));
  vec3 col = mix(base, sky, fres * 0.85);
  vec3 H = normalize(sunDir + V);
  col += vec3(1.0, 0.95, 0.80) * pow(max(dot(N, H), 0.0), 90.0) * 0.9;
  float foam = 0.0;
  if (useShore > 0.5) {                                           // swash: foam lines that travel towards the beach
    float line = 0.5 + 0.5 * sin(sd * 0.55 - time * 1.4);
    float band = 1.0 - smoothstep(4.0, 40.0, sd);
    foam = band * smoothstep(0.55, 0.95, line * (0.45 + 0.55 * band) + 0.35 * band) * smoothstep(0.0, 6.0, sd) + (1.0 - smoothstep(0.0, 9.0, sd)) * 0.9;
    foam = clamp(foam, 0.0, 1.0) * 0.8;
    col = mix(col, vec3(0.98), foam);
  }
  float alpha = (useShore > 0.5) ? smoothstep(0.0, 14.0, sd) * 0.97 : 0.93;
  alpha = clamp(max(alpha, foam * 0.85), 0.0, 1.0);
  float d = dist * fogDensity;
  col = mix(col, fogColor, 1.0 - exp(-d * d));
  gl_FragColor = vec4(col, alpha);
}`;

export function makeWaterMaterial(shared, useShore) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    uniforms: { ...shared, time: waterTime, useShore: { value: useShore ? 1 : 0 } },
  });
  return m;
}

export class Sea {
  constructor(scene, hf, mask, info, fog, sunDir) {
    const half = new Uint16Array(info.dist.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(info.dist[i]);
    const tex = new THREE.DataTexture(half, info.cw, info.ch, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    const r = info.rect;
    this.shared = {
      mask: { value: mask.texture }, maskRect: { value: new THREE.Vector4(mask.x0, mask.z0, mask.w, mask.h) },
      shore: { value: tex }, shoreRect: { value: new THREE.Vector4(r.x0, r.z0, r.w, r.h) },
      fogColor: { value: new THREE.Vector3(...fog.color) }, fogDensity: { value: fog.density }, sunDir: { value: sunDir }, lite: { value: 0 },
    };
    this.material = makeWaterMaterial(this.shared, true);
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.scale.set(mask.w, 1, mask.h);
    this.mesh.position.set(mask.x0 + mask.w / 2, SEA_LEVEL, mask.z0 + mask.h / 2);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }
  inlandMaterial() { return makeWaterMaterial(this.shared, false); }
  update(t) { waterTime.value = t; }
}
