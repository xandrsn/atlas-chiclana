// v2 look (Phase 2): pre-lit worlds in the early-2000s way, with original art.
// - One world program for every baked cell: two pre-lit vertex palettes (day = sun + sky, night = moon + street lamps; bake_cells.mjs)
//   mixed by one uniform, surface kind per vertex -> layer of a photo-detail texture array + normal / roughness array
//   (render/textures.js), sun relit per pixel with the hour, procedural windows
//   (lit at night), emissive lamp heads, cheap animated water and salt pans, distance fog = draw distance. No lights, no extra draw calls.
// - Sky: one dome drawn last at the far plane (only empty pixels pay): gradient, sun / moon disc, stars, fbm clouds.
// - TimeCycle: getTimecyc() (data/timecyc.json) drives all of it; game clock accelerated (minutesPerSecond), T jumps one hour.
import * as THREE from 'three';
import { getTimecyc } from './timecyc.js';
import { leafTexture, surfaceArray } from './textures.js';
import { SH, SHADOW_GLSL } from './shadow.js';

const WORLD_VS = /* glsl */`
attribute vec4 dcol; attribute vec4 ncol;
varying vec3 vDay; varying vec3 vNgt; varying vec3 vW; varying float vDepth; varying float vAux;
flat varying float vKind; flat varying float vAng; flat varying float vSeed;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  float a = floor(dcol.a * 255.0 + 0.5); vKind = floor(a / 16.0); vAng = a - vKind * 16.0; vSeed = ncol.a * 255.0; vAux = vSeed;
  vDay = dcol.rgb; vNgt = ncol.rgb;
  vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv;
}`;

// kinds (scripts/bake_cells.mjs KIND): 0 plain 1 grass 2 field 3 forest 4 salina 5 sand 6 dirt 7 water 8 paving 9 asphalt
// 10 wall+windows 11 wall 12 plinth 13 roof tiles 14 azotea 15 lamp head. Plain + seed 1..8 = sub-material, layer 15 + seed
// (concrete, shutter, wood, hedge, brick, stone, clean asphalt, park dirt); 9 glass (its angle nibble < 6 = lit at night), 10 metal, 11 wire mesh
const WORLD_FS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uTex, uNrm;
uniform float uTime, uNight, uWin, uLamp, uDay, uSunLow;
uniform vec3 uFog, uHor, uZen, uSunDir, uSunCol, uTint; uniform vec2 uFogR;
varying vec3 vDay; varying vec3 vNgt; varying vec3 vW; varying float vDepth; varying float vAux;
flat varying float vKind; flat varying float vAng; flat varying float vSeed;
const float SC[24] = float[24](3.0, 3.0, 5.0, 3.4, 5.0, 4.0, 3.0, 4.0, 2.4, 4.0, 3.0, 3.0, 2.0, 3.6, 1.6, 4.0, 3.0, 1.2, 1.0, 1.3, 2.2, 2.0, 4.0, 3.0);   // metres per texture repeat
const vec3 BS = vec3(-0.4490, 0.7982, -0.3991);   // sun of the bake (data/v2.json bake.sun, normalised)
${SHADOW_GLSL}float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 skyAt(vec3 r) { return mix(uHor, uZen, sqrt(clamp(r.y, 0.0, 1.0))); }
vec2 rip(vec2 p, float s, vec2 v) { return texture(uNrm, vec3(p / s + uTime * v, 7.0)).rg * 2.0 - 1.0; }
// open water (bake_cells.mjs waterSheet): flat sheet, dep = depth in m; L = light of the pre-lit vertex colour (sun / moon / lamps)
vec3 water(vec3 L, float dep, float sh) {
  vec2 p = vW.xz; float dist = length(vW - cameraPosition), calm = smoothstep(0.0, 1.6, dep);
  vec2 d = rip(p, 23.0, vec2(0.010, 0.006)) * 0.5 + rip(p.yx, 9.1, vec2(-0.021, 0.017)) * 0.45 + rip(p, 2.9, vec2(0.037, -0.03)) * 0.35 * smoothstep(90.0, 10.0, dist);
  vec3 N = normalize(vec3(d.x, mix(9.0, 4.2, calm) + dist * 0.012, d.y)), V = normalize(vW - cameraPosition), R = reflect(V, N); R.y = abs(R.y);
  float fr = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 bed = vec3(0.50, 0.45, 0.33) * (0.75 + 0.5 * texture(uTex, vec3(p / 6.0, 5.0)).r), body = mix(vec3(0.20, 0.32, 0.31), vec3(0.085, 0.20, 0.25), smoothstep(0.6, 3.0, dep));
  vec3 c = mix(bed * vec3(0.72, 0.80, 0.74), body, 1.0 - exp(-max(dep + 0.06, 0.0) * 1.7)) * L;
  c = mix(c, skyAt(R) * mix(0.35, 0.92, uDay) * (1.0 - smoothstep(0.10, 0.0, R.y) * 0.25), clamp(fr, 0.0, 0.85));
  vec3 H = reflect(V, normalize(vec3(d.x * 1.5, 4.0, d.y * 1.5)));
  c += uSunCol * pow(max(dot(H, uSunDir), 0.0), 220.0) * (1.3 * uDay * sh + 0.25 * uNight);
  float fn = texture(uTex, vec3(p / 5.0 + uTime * vec2(0.02, 0.013), 7.0)).r, edge = dep + (fn - 0.5) * 0.2 + 0.03 * sin(uTime * 1.1 + p.x * 0.15 + p.y * 0.11);
  return mix(c, vec3(0.86, 0.88, 0.86) * L, smoothstep(0.10, 0.02, edge) * smoothstep(0.30, 0.62, fn + 0.2) * 0.4);
}
void main() {
  int k = int(vKind + 0.5), s = int(vSeed + 0.5), lay = k == 0 && s >= 1 && s <= 8 ? 15 + s : k;
  if (uPass > 0.5) { if (k == 0 && s == 11) discard; gl_FragColor = vec4(1.0); return; }   // shadow map (render/shadow.js)
  vec3 gx = cross(dFdx(vW), dFdy(vW)), N = gx / max(length(gx), 1e-9), V = normalize(vW - cameraPosition); if (dot(N, V) > 0.0) N = -N;
  if (k == 0 && s == 11) {   // chain-link mesh: 6 cm diamonds near, a 50 % screen-door far away
    vec2 q = vec2(dot(vW.xz, normalize(vec2(-N.z, N.x) + 1e-5)), vW.y) * 12.0, d = abs(fract(vec2(q.x + q.y, q.x - q.y)) - 0.5), w = fwidth(q) + 1e-4;
    if (max(w.x, w.y) < 0.5 ? max(d.x, d.y) < 0.5 - max(0.07, 0.6 * max(w.x, w.y)) : mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;
  }
  float nat = k >= 1 && k <= 9 ? smoothstep(0.55, 0.8, N.y) : 0.0; vec3 Ns = normalize(mix(N, vec3(0.0, 1.0, 0.0), nat));   // ground keeps its smooth baked shading
  // relight: baked day light (fixed sun) -> cool sky fill + warm sun that follows the hour
  float o = 0.58 * (0.9 + 0.1 * Ns.y) + 0.42 * max(dot(Ns, BS), 0.0), sh = sunShadow(vW, Ns), sd = min(max(dot(Ns, uSunDir), 0.0) / max(uSunDir.y, 0.22) * 0.8, 1.25) * sh;
  vec3 amb = mix(vec3(0.60, 0.62, 0.66) * (0.80 + 0.22 * Ns.y), vec3(0.80, 0.765, 0.73), 0.6 * (1.0 - abs(Ns.y)));   // sky fill, ground bounce on the walls
  vec3 rel = (amb + vec3(0.46, 0.425, 0.355) * sd * mix(vec3(1.0), vec3(1.08, 0.95, 0.80), uSunLow)) / o, col = mix(vDay * uTint * rel, vNgt, uNight);
  col *= mix(1.06, 1.0, uNight);
  if (k == 7) col = water(mix(vDay * uTint, vNgt * 1.6, uNight) / vec3(0.204, 0.353, 0.439), clamp((vAux - 96.0) / 53.0, -1.0, 3.0), sh);
  else if (k == 15) col = mix(col, vec3(1.0, 0.86, 0.58), uLamp);
  else if (k == 0 && s == 9) {   // glass: dark body + sky reflection, some panes lit at night
    vec3 R = reflect(V, N); float fr = 0.10 + 0.75 * pow(1.0 - max(dot(-V, N), 0.0), 4.0), q = vAng / 16.0;
    col = mix(col * vec3(0.42, 0.46, 0.50), skyAt(vec3(R.x, abs(R.y), R.z)) * mix(0.3, 0.85, uDay), fr);
    col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 60.0) * uDay * 0.6 * sh;
    col = mix(col, mix(vec3(1.0, 0.76, 0.45), vec3(0.85, 0.9, 1.0), step(0.75, hash(vec2(q, 3.0)))) * (0.6 + 0.35 * q), uWin * step(q, 0.4));
  } else {
    vec3 T = vec3(1, 0, 0), B = vec3(0, 0, -1); float th = vAng / 16.0 * 3.14159265; vec2 t = vec2(cos(th), sin(th));   // T, B = right and up of the image
    if (k >= 10 && k <= 12) { T = vec3(t.x, 0.0, t.y); B = vec3(0, 1, 0); }
    else if (k >= 13) { T = vec3(t.x, 0.0, t.y); B = vec3(t.y, 0.0, -t.x); }
    else if (k == 0 && abs(N.y) < 0.75) { T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0, 1, 0); }
    vec2 uv = vec2(dot(vW, T), -dot(vW, B)) / SC[lay];
    vec3 tx = texture(uTex, vec3(uv, float(lay))).rgb, nm = texture(uNrm, vec3(uv, float(lay))).rgb;
    if (k >= 1 && k <= 9) {
      vec3 mac = texture(uTex, vec3(vW.xz / 61.0, 15.0)).rgb;
      if (k != 8) {   // a second, rotated and rescaled tap blended by world noise -> no visible repeat
        mat2 R2 = mat2(0.8, -0.6, 0.6, 0.8); vec2 u2 = R2 * uv * 0.71 + 0.37; float w = smoothstep(0.38, 0.62, texture(uTex, vec3(vW.xz / 17.0, 15.0)).g);
        vec3 n2 = texture(uNrm, vec3(u2, float(lay))).rgb; n2.rg = (n2.rg - 0.5) * R2 + 0.5;
        tx = mix(tx, texture(uTex, vec3(u2, float(lay))).rgb, w); nm = mix(nm, n2, w);
      }
      col *= mix(vec3(1.0), vec3(mac.r * 1.1, mac.r, mac.r * 0.85) * 2.0, k >= 8 ? 0.16 : 0.38) * (0.9 + 0.2 * mac.g);
    }
    if (lay == 0) { tx = mix(vec3(0.502), tx, 0.45); nm = mix(vec3(0.502, 0.502, 0.6), nm, 0.35); }
    if (k == 0 && s >= 10) { tx = vec3(0.502); nm = vec3(0.502, 0.502, 0.35); }
    if (k == 10 || k == 11) { tx = mix(vec3(0.502), tx, 0.55); tx += (dot(textureLod(uTex, vec3(vW.xz / 37.0 + vW.y / 23.0, 15.0), 2.0).rg, vec2(0.5)) - 0.5) * 0.07; }   // lime wash: light stains only
    if (k == 1) { float lu = dot(col, vec3(0.3, 0.59, 0.11)); col = mix(vec3(lu), col, 0.72) * vec3(1.03, 0.97, 0.95); }   // lawn: less acid
    col *= tx * 2.0;
    vec2 nn = nm.rg * 2.0 - 1.0; vec3 Np = normalize(T * nn.x + B * nn.y + N * sqrt(max(0.05, 1.0 - dot(nn, nn)))), Lg = mix(BS, uSunDir, 0.8);
    col *= clamp(1.0 + (dot(Np, Lg) - dot(N, Lg)) * mix(0.4, 0.85, sh), 0.45, 1.5);
    float gl = 1.0 - nm.b; vec3 H = normalize(uSunDir - V);
    col += uSunCol * col * pow(max(dot(Np, H), 0.0), mix(6.0, 50.0, gl)) * gl * 0.55 * uDay * sh * step(0.0, dot(N, uSunDir));
    if (k == 4) {   // salt pan: baked ortho colour; the dark pools get a calm-water sheen
      float pool = 1.0 - smoothstep(0.42, 0.62, dot(col, vec3(0.3, 0.59, 0.11))); vec2 d = rip(vW.xz, 11.0, vec2(0.008, 0.006)); vec3 Nw = normalize(vec3(d.x, 12.0, d.y)), R = reflect(V, Nw); R.y = abs(R.y);
      col = mix(col, skyAt(R) * mix(0.35, 0.9, uDay), pool * clamp(0.04 + 0.6 * pow(1.0 - max(dot(-V, Nw), 0.0), 4.0), 0.0, 0.5));
    }
    if (k == 10) {   // windows on the facades without modelled ones: 3 m x 3.4 m bays, recessed frame, mullion, sill, blind; far away = their average
      vec2 f = vec2(dot(vW.xz, t) / 3.0, vW.y / 3.4), c = floor(f), q = fract(f), fw2 = fwidth(f); float fw = max(fw2.x, fw2.y), near = clamp(1.6 - fw * 5.0, 0.0, 1.0);
      float balc = step(0.62, hash(vec2(c.x, vSeed))); vec2 lo = vec2(0.31, mix(0.32, 0.08, balc)), hi = vec2(0.69, 0.74), e = fw2 * 0.75 + 1e-4;
      #define BOX(a, b) (smoothstep((a).x - e.x, (a).x + e.x, q.x) * smoothstep((b).x + e.x, (b).x - e.x, q.x) * smoothstep((a).y - e.y, (a).y + e.y, q.y) * smoothstep((b).y + e.y, (b).y - e.y, q.y))
      vec2 fr = vec2(0.022, 0.02); float op = BOX(lo, hi), in1 = BOX(lo + fr, hi - fr), mul = 1.0 - smoothstep(0.011 - e.x, 0.011 + e.x, abs(q.x - 0.5));
      float h1 = hash(c + vSeed * 0.731), h2 = hash(c * 1.7 + vSeed), drop = h2 > 0.45 ? mix(0.15, 1.0, fract(h2 * 7.3)) : 0.0, bl = step(hi.y - fr.y - (hi.y - lo.y) * drop, q.y);
      vec3 R = reflect(V, N), glass = mix(vec3(0.07, 0.085, 0.10), skyAt(vec3(R.x, abs(R.y), R.z)) * 0.8, 0.22 + 0.5 * pow(1.0 - max(dot(-V, N), 0.0), 3.0)) * mix(1.0, 0.25, uNight);
      vec3 wl = mix(vec3(0.92), vec3(0.16), uNight) * mix(vec3(1.0), rel * uTint * 0.8, 1.0 - uNight), hue = hash(vec2(vSeed, 2.0)) > 0.35 ? vec3(0.83, 0.82, 0.78) : hash(vec2(vSeed, 5.0)) > 0.5 ? vec3(0.30, 0.38, 0.28) : vec3(0.40, 0.27, 0.18);
      vec3 blind = hue * wl * (0.82 + 0.18 * sin(q.y * 3.4 / 0.05 * 6.283) * near), on = mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.9, 1.0), step(0.8, hash(c + 3.1))) * (0.7 + 0.25 * h2);
      glass = mix(glass, on, step(h1, 0.45) * uWin); vec3 pane = mix(mix(glass, blind, bl), hue * wl, max(1.0 - in1, mul * (1.0 - bl)));
      pane *= 1.0 - 0.38 * smoothstep(hi.y - 0.07, hi.y, q.y) - 0.2 * smoothstep(lo.x + 0.04, lo.x, q.x);   // reveal shadow
      float sill = BOX(vec2(lo.x - 0.025, lo.y - 0.035), vec2(hi.x + 0.025, lo.y)), under = BOX(vec2(lo.x - 0.02, lo.y - 0.10), vec2(hi.x + 0.02, lo.y - 0.035));
      vec3 wall = col * (1.0 + 0.12 * sill - 0.16 * under), far = mix(mix(vec3(0.16, 0.18, 0.2), hue * wl, 0.4), on, 0.4 * uWin);
      col = mix(wall, mix(far, pane, near), mix(0.17, op, near));
    }
  }
  col = clamp(col, 0.0, 1.0); col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);   // light contrast curve
  col = mix(col, uFog, smoothstep(uFogR.x, uFogR.y, vDepth));
  gl_FragColor = vec4(col, 1.0);
}`;

// merged per-cell tree meshes (render/trees.js): pre-lit vertex colour; alpha byte = 255 plain, else cell * 16 + u * 8 + v7 of leaf.webp (4 x 2 cells)
const TREE_VS = /* glsl */`
attribute vec4 color; uniform float uTime, uNight; uniform vec3 uTint;
varying vec3 vC, vW; varying vec2 vUv; varying float vD; flat varying float vCell, vBlob;
void main() {
  float a = floor(color.a * 255.0 + 0.5), cl = floor(a / 16.0), r = a - cl * 16.0, u = floor(r / 8.0);
  vCell = a > 127.0 ? -1.0 : cl; vUv = vec2(u, (r - u * 8.0) / 7.0); vC = color.rgb * uTint; vBlob = step(dot(abs(color.rgb * 255.0 - vec3(40.0, 42.0, 35.0)), vec3(1.0)), 0.5);   // trees.js BLOB
  vec4 w = modelMatrix * vec4(position, 1.0);
  if (vCell >= 0.0 && cl < 7.0) w.xz += 0.05 * vec2(sin(uTime * 1.3 + w.x * 0.35 + w.y * 0.5), cos(uTime * 1.1 + w.z * 0.4 + w.y * 0.4));
  vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const TREE_FS = /* glsl */`
uniform sampler2D uLeaf; uniform float uDay; uniform vec3 uFog, uSunDir; uniform vec2 uFogR;
${SHADOW_GLSL}varying vec3 vC, vW; varying vec2 vUv; varying float vD; flat varying float vCell, vBlob;
void main() {
  if (vBlob > 0.5) {   // dappled soft shadow, blended over the ground (the only fragments with alpha < 1)
    if (uPass > 0.5) discard;
    vec2 q = vUv * 2.0 - 1.0; float h = texture2D(uLeaf, vec2(0.0, 0.5) + vec2(0.25, 0.5) * clamp(vUv, 0.01, 0.99)).g, a = (0.25 + 0.35 * uDay) * (1.0 - 0.85 * uShd) * smoothstep(1.0, 0.35, length(q) + (h - 0.5) * 0.35) * (1.0 - smoothstep(uFogR.x * 0.5, uFogR.x, vD));
    gl_FragColor = vec4(vec3(0.07, 0.08, 0.10), a); return;
  }
  vec3 c = vC;
  if (vCell >= 0.0) {
    vec2 at = (vec2(mod(vCell, 4.0), floor(vCell / 4.0 + 0.01)) + clamp(vUv, 0.008, 0.992)) / vec2(4.0, 2.0); vec4 t = texture2D(uLeaf, at);
    float lod = log2(max(1.0, length(fwidth(vUv)) * 256.0)), g = min(lod, 2.0) * 0.5; vec2 jc = floor(vUv * 256.0 / exp2(floor(lod) + 1.0)); float j = fract(sin(dot(jc, vec2(12.99, 78.23)) + vCell + vC.g * 9.0) * 43758.5);   // leaf-clump grain of about two pixels
    if (vCell < 6.5) { if (t.a * (1.0 + 0.22 * min(lod, 5.0)) - (j - 0.35) * 0.7 * g < 0.5) discard; c *= 1.0 + (j - 0.42) * 0.55 * g; }   // mips thin the leaves out: keep the coverage, ragged edge
    c *= t.rgb * 1.5; if (vCell < 6.5) c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.80) * vec3(1.10, 1.0, 0.88);   // sun-bleached greens
  }
  if (uPass < 0.5) c *= mix(0.62, 1.0, sunShadow(vW + uSunDir * 0.8, uSunDir));
  gl_FragColor = vec4(mix(c, uFog, smoothstep(uFogR.x, uFogR.y, vD)), 1.0);
}`;

export function makeMaterials(renderer) {
  const an = Math.min(4, renderer?.capabilities.getMaxAnisotropy() || 1), tex = surfaceArray('surf.webp', an, 0xff808080), nrm = surfaceArray('surf_n.webp', an, 0xffe08080), leaf = leafTexture('leaf.webp', 2);
  const u = { ...SH, uTex: { value: tex }, uNrm: { value: nrm }, uLeaf: { value: leaf }, uTime: { value: 0 }, uDay: { value: 1 }, uWin: { value: 0 }, uLamp: { value: 0 }, uSunLow: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    uFog: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uFogR: { value: new THREE.Vector2(300, 700) } };
  return {
    u, ready: Promise.all([tex, nrm, leaf].map(t => t.userData.ready)),
    world: new THREE.ShaderMaterial({ uniforms: u, vertexShader: WORLD_VS, fragmentShader: WORLD_FS }),
    tree: new THREE.ShaderMaterial({ uniforms: u, vertexShader: TREE_VS, fragmentShader: TREE_FS, side: THREE.DoubleSide, blending: THREE.CustomBlending }),
    blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sky: new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }),
  };
}

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;   // at the far plane: drawn after the city, only where nothing else is
const SKY_FS = /* glsl */`
uniform float uTime, uNight, uDay, uSunLow; uniform vec3 uFog, uHor, uZen, uSunDir, uSunCol, uTint;
varying vec3 vDir;
float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir); float y = d.y, s = dot(d, uSunDir);
  vec3 c = mix(uHor, uZen, pow(clamp(y, 0.0, 1.0), 0.55));
  if (uNight < 0.5) c += uSunCol * (pow(max(s, 0.0), 6.0) * 0.10 + pow(max(s, 0.0), 90.0) * 0.35 + smoothstep(0.9993, 0.9997, s) * 1.5) * uDay;   // haze around the sun + disc
  else c += vec3(0.85, 0.88, 0.95) * smoothstep(0.99955, 0.9998, s) + vec3(0.2, 0.22, 0.3) * pow(max(s, 0.0), 30.0) * 0.3;   // moon
  vec2 sp = floor(d.xz / max(y, 0.05) * 90.0);
  c += vec3(step(0.9975, h2(sp))) * smoothstep(0.55, 0.95, uNight) * smoothstep(0.05, 0.3, y) * (0.5 + 0.5 * sin(uTime * 3.0 + h2(sp + 7.0) * 40.0));   // stars
  if (y > 0.0) {   // fair-weather cumulus on a plane (fbm, lit from the sun side) under a thin cirrus veil
    vec2 p = d.xz / (y + 0.16) * 1.15 + vec2(uTime * 0.006, uTime * 0.002), sh = normalize(uSunDir.xz + 1e-4) * 0.16; float w = 0.5 * fbm(p * 1.7);
    float n = fbm(p + w), n2 = fbm(p + sh + w), cov = smoothstep(0.50, 0.70, n) * smoothstep(0.03, 0.22, y);
    float ci = smoothstep(0.45, 0.9, fbm(vec2(p.x * 0.45 + p.y * 0.3, p.y * 2.2) + 9.0)) * 0.22 * smoothstep(0.05, 0.5, y), lit = clamp(0.62 + (n - n2) * 3.2, 0.0, 1.0);
    vec3 hi = min(uSunCol * vec3(1.02, 1.0, 0.98) + 0.05, 1.0) * uTint, lo = mix(uZen, uHor, 0.6) * vec3(0.86, 0.86, 0.88);
    vec3 cl = mix(lo, hi, lit) * mix(1.0, 0.30, uNight);
    c = mix(c, mix(uHor, vec3(1.0), 0.5) * mix(1.0, 0.25, uNight), ci); c = mix(c, cl, cov * 0.9);
  }
  c = mix(uFog, c, smoothstep(-0.02, 0.12, y));   // horizon melts into the fog colour: distant city fades into the sky
  c += (h2(gl_FragCoord.xy * 0.37) - 0.5) / 255.0;   // no banding
  gl_FragColor = vec4(c, 1.0);
}`;

/** the sky dome (one draw call, its own small program) */
export function makeSky(mats) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), mats.sky);
  m.frustumCulled = false; m.renderOrder = 1e6; return m;
}

/** time of day: getTimecyc() -> fog (colour + range = draw distance), sky, palette mix, lamps and windows; also scene.fog for vehicles and people */
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
    u.uSunLow.value = Math.max(0, 1 - s.sunDir[1] / 0.6);
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
