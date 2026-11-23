import * as THREE from 'three';
import { R, K, merc, toLocal, TILE_M, lonLatToTile, tileRect, clamp, ORIGIN } from './geo.js';

const DEM_Z = 14;      // elevation tiles (~7.7 m/px at this latitude)
const ROOT_Z = 14;     // quadtree roots (~2 km)
const MAX_Z = 19;      // finest imagery level: ~0.24 m/px, 61 m tiles
const GRID = 24;       // quads per node edge

// ---------------------------------------------------------------- heightfield
const VEXAG = Number(new URLSearchParams(location.search).get('vex')) || (new URLSearchParams(location.search).get('map') === 'madrid' ? 3 : 1.875);   // ?vex=1 for real relief
const OUT = new URLSearchParams(location.search).get('map') === 'madrid' ? 1000 : 0;   // Madrid: keep (dimmed) ground beyond the M-30 ring so roads/buildings there don't float
export class Heightfield {
  constructor(bounds) {
    const [minlon, minlat, maxlon, maxlat] = bounds;
    [this.tx0, this.ty0] = lonLatToTile(minlon, maxlat, DEM_Z);
    const [tx1, ty1] = lonLatToTile(maxlon, minlat, DEM_Z);
    this.nx = tx1 - this.tx0 + 1; this.ny = ty1 - this.ty0 + 1;
    this.W = this.nx * 256; this.H = this.ny * 256;
    this.grid = new Float32Array(this.W * this.H);
    this.s = TILE_M(DEM_Z) / 256;       // mercator metres per DEM pixel
  }
  async load(onProgress) { await this._load(onProgress); this.bathymetry(); }
  /** the DEM is clamped at 0 m over water: give the sea / marsh bed a depth that grows with distance from the shore (chamfer distance transform) */
  bathymetry() { if (new URLSearchParams(location.search).has('nobathy')) return;
    const W = this.W, H = this.H, g = this.grid, cell = this.s * K, N = W * H, d = new Float32Array(N), SL = 0.25, A = 1, B = 1.4142;
    for (let i = 0; i < N; i++) d[i] = g[i] > SL ? 0 : 1e9;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const o = j * W + i; let m = d[o]; if (!m) continue;
      if (i > 0) m = Math.min(m, d[o - 1] + A); if (j > 0) { m = Math.min(m, d[o - W] + A); if (i > 0) m = Math.min(m, d[o - W - 1] + B); if (i < W - 1) m = Math.min(m, d[o - W + 1] + B); } d[o] = m; }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) { const o = j * W + i; let m = d[o]; if (!m) continue;
      if (i < W - 1) m = Math.min(m, d[o + 1] + A); if (j < H - 1) { m = Math.min(m, d[o + W] + A); if (i < W - 1) m = Math.min(m, d[o + W + 1] + B); if (i > 0) m = Math.min(m, d[o + W - 1] + B); } d[o] = m; }
    for (let i = 0; i < N; i++) if (d[i] > 0 && d[i] < 1e8) g[i] = -Math.min(16, 0.15 + d[i] * cell * 0.02);   // ~1 m at 50 m off shore, 16 m max (0.02 slope, shallow marshes stay knee-deep)
  }
  async _load(onProgress) {
    // preferred source: data/dem.bin = IGN MDT05 (5 m LiDAR terrain model) resampled on this very grid by scripts/dem_ign.mjs. One download instead of
    // ~150 PNG tiles decoded through a canvas. ?dem=aws forces the old AWS terrarium tiles.
    if (new URLSearchParams(location.search).get('dem') !== 'aws') try {
      const r = await fetch('/data/dem.bin');
      if (r.ok) {
        const ab = await r.arrayBuffer(), h = new DataView(ab);
        if (h.getUint32(0, true) === 0x314d4544 && h.getUint32(4, true) === this.W && h.getUint32(8, true) === this.H && h.getInt32(12, true) === this.tx0 && h.getInt32(16, true) === this.ty0) {
          const u = new Uint16Array(ab, 32, this.W * this.H), k = h.getUint32(24, true) / 1000, g = this.grid;
          for (let i = 0; i < u.length; i++) { const h0 = u[i] * k; g[i] = h0 < 1 ? h0 : 1 + (h0 - 1) * VEXAG; }
          this.source = 'IGN MDT05'; onProgress?.(1); return;
        }
        console.warn('data/dem.bin does not match the current grid: using elevation tiles (re-run scripts/dem_ign.mjs)');
      }
    } catch (e) { console.warn('dem.bin', e); }
    this.source = 'AWS terrarium';
    const jobs = [];
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) jobs.push([i, j]);
    let done = 0;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const worker = async () => {
      while (jobs.length) {
        const [i, j] = jobs.pop();
        try {
          const r = await fetch(`/tiles/dem/${DEM_Z}/${this.tx0 + i}/${this.ty0 + j}.png`);
          if (r.ok) {
            const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
            ctx.clearRect(0, 0, 256, 256); ctx.drawImage(bmp, 0, 0); bmp.close();
            const d = ctx.getImageData(0, 0, 256, 256).data;
            for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
              const o = (y * 256 + x) * 4;
              const h0 = Math.max(0, d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768);
              this.grid[(j * 256 + y) * this.W + i * 256 + x] = h0 < 1 ? h0 : 1 + (h0 - 1) * VEXAG;   // vertical exaggeration above 1 m
            }
          }
        } catch (e) { console.warn('DEM tile failed', e); }
        onProgress?.(++done / (this.nx * this.ny));
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }
  /** world-space rectangle covered by the DEM pixel grid */
  worldRect() {
    const mx0 = this.tx0 * 256 * this.s - Math.PI * R, myTop = Math.PI * R - this.ty0 * 256 * this.s;
    return { x0: (mx0 - this._mx0) * K, z0: (this._my0 - myTop) * K, w: this.W * this.s * K, h: this.H * this.s * K };
  }
  /** carve a channel: lower DEM cells within r metres of (x,z) towards `bed` (blending up to the old height over `bank` metres) */
  carve(x, z, r, bank, bed, skip) {
    const mx = x / K + this._mx0, my = this._my0 - z / K, W = this.W, H = this.H, g = this.grid;
    const u = (mx + Math.PI * R) / this.s - this.tx0 * 256 - 0.5, v = (Math.PI * R - my) / this.s - this.ty0 * 256 - 0.5, cell = this.s * K, n = Math.ceil((r + bank) / cell) + 1;
    for (let j = Math.floor(v) - n; j <= Math.ceil(v) + n; j++) for (let i = Math.floor(u) - n; i <= Math.ceil(u) + n; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const d = Math.hypot(i - u, j - v) * cell, o = j * W + i;
      if (skip && skip(x + (i - u) * cell, z + (j - v) * cell)) continue;   // e.g. under at-grade roads: no channel there
      if (d <= r) g[o] = Math.min(g[o], bed);
      else if (d < r + bank) { const t = (d - r) / bank, e = t * t * (3 - 2 * t); g[o] = Math.min(g[o], bed + (g[o] - bed) * e); }
    }
  }
  /** level the DEM to height y within r metres of (x,z) (raises or lowers), blending to the old height over `bank` metres: flat promenade beside rivers */
  level(x, z, r, bank, y, skip) {
    const mx = x / K + this._mx0, my = this._my0 - z / K, W = this.W, H = this.H, g = this.grid;
    const u = (mx + Math.PI * R) / this.s - this.tx0 * 256 - 0.5, v = (Math.PI * R - my) / this.s - this.ty0 * 256 - 0.5, cell = this.s * K, n = Math.ceil((r + bank) / cell) + 1;
    for (let j = Math.floor(v) - n; j <= Math.ceil(v) + n; j++) for (let i = Math.floor(u) - n; i <= Math.ceil(u) + n; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const d = Math.hypot(i - u, j - v) * cell, o = j * W + i;
      if (skip && skip(x + (i - u) * cell, z + (j - v) * cell)) continue;
      if (d <= r) g[o] = y; else if (d < r + bank) { const t = (d - r) / bank, e = t * t * (3 - 2 * t); g[o] = y + (g[o] - y) * e; }
    }
  }
  /** bilinear height (m above sea level) at world x,z */
  height(x, z) {
    const mx = x / K + this._mx0, my = this._my0 - z / K;
    let u = (mx + Math.PI * R) / this.s - this.tx0 * 256 - 0.5;
    let v = (Math.PI * R - my) / this.s - this.ty0 * 256 - 0.5;
    u = clamp(u, 0, this.W - 1.001); v = clamp(v, 0, this.H - 1.001);
    const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv, W = this.W, g = this.grid, o = iv * W + iu;
    return (g[o] * (1 - fu) + g[o + 1] * fu) * (1 - fv) + (g[o + W] * (1 - fu) + g[o + W + 1] * fu) * fv;
  }
}
{ const [mx0, my0] = merc(ORIGIN.lon, ORIGIN.lat); Heightfield.prototype._mx0 = mx0; Heightfield.prototype._my0 = my0; }

// ---------------------------------------------------------------- municipality mask
export class Mask {
  constructor(boundary, opts) {
    const [minlon, minlat, maxlon, maxlat] = boundary.bounds;
    const [x0, z0] = toLocal(minlon, maxlat), [x1, z1] = toLocal(maxlon, minlat);
    this.x0 = x0 - 200; this.z0 = z0 - 200; this.w = x1 - x0 + 400; this.h = z1 - z0 + 400;
    this.px = 2048; this.py = Math.round(2048 * this.h / this.w);
    this.rings = boundary.rings.map(r => r.map(([lon, lat]) => toLocal(lon, lat)));
    const c = this.canvas = document.createElement('canvas'); c.width = this.px; c.height = this.py;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, this.px, this.py);
    g.fillStyle = '#fff'; g.beginPath();
    for (const r of this.rings) r.forEach(([x, z], i) => {
      const X = (x - this.x0) / this.w * this.px, Y = (z - this.z0) / this.h * this.py;
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    });
    if (OUT) g.filter = 'blur(60px)';   // Madrid: soft limit (~0.7 km ramp) so the shader can fade the ground beyond the ring into the haze; inside() keeps the same 50 % contour
    g.fill('evenodd'); g.filter = 'none';
    if (opts?.unlock) {   // open the sea (and islets) beyond the coast, up to `margin` metres from the municipal limit
      const c2 = document.createElement('canvas'); c2.width = this.px; c2.height = this.py;
      const g2 = c2.getContext('2d', { willReadFrequently: true });
      g2.strokeStyle = '#fff'; g2.lineJoin = 'round'; g2.lineWidth = 2 * opts.margin * this.px / this.w; g2.beginPath();
      for (const r of this.rings) r.forEach(([x, z], i) => {
        const X = (x - this.x0) / this.w * this.px, Y = (z - this.z0) / this.h * this.py; i ? g2.lineTo(X, Y) : g2.moveTo(X, Y);
      });
      g2.stroke();
      const near = g2.getImageData(0, 0, this.px, this.py).data, im = g.getImageData(0, 0, this.px, this.py), d = im.data;
      for (let y = 0; y < this.py; y++) for (let x = 0; x < this.px; x++) {
        const i = (y * this.px + x) * 4;
        if (near[i] > 127 && d[i] < 128 && opts.unlock(this.x0 + (x + 0.5) / this.px * this.w, this.z0 + (y + 0.5) / this.py * this.h)) d[i] = d[i + 1] = d[i + 2] = 255;
      }
      g.putImageData(im, 0, 0);
    }
    this.data = g.getImageData(0, 0, this.px, this.py).data;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.texture.flipY = false;   // canvas row 0 (north) = v 0, matches (z - z0) / h in the shader
  }
  inside(x, z) {
    const X = ((x - this.x0) / this.w * this.px) | 0, Y = ((z - this.z0) / this.h * this.py) | 0;
    return X >= 0 && Y >= 0 && X < this.px && Y < this.py && this.data[(Y * this.px + X) * 4] > 127;
  }
  intersectsRect(x, z, size) {
    const step = Math.max(8, size / 40);
    for (let a = 0; a <= size; a += step) for (let b = 0; b <= size; b += step) if (this.inside(x + a, z + b)) return true;
    return false;
  }
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */`
uniform float lite; uniform float mad; uniform sampler2D map; uniform sampler2D mask; uniform vec4 maskRect; uniform vec3 fogColor; uniform float fogDensity; uniform vec3 sunDir; uniform sampler2D urban; uniform vec4 urbanRect; uniform float urbanOn; uniform sampler2D land; uniform float landOn; uniform sampler2D noise; uniform sampler2D ugHole; uniform vec4 ugRect; uniform float ugOn;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
// All procedural detail comes from ONE small tileable noise texture (rg = two independent fbm fields, ba = two value-noise fields; 4 texels per unit,
// mip-mapped so it fades to its mean far away). The previous version evaluated ~90 sin() hashes per pixel; this is 7 texture taps, 0 with ?lite.
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 T(vec2 p){ return texture2D(noise, p * 0.015625); }
void main(){
  if (ugOn > 0.5) { vec2 hu = (vW.xz - ugRect.xy) / ugRect.zw; if (hu.x > 0.0 && hu.x < 1.0 && hu.y > 0.0 && hu.y < 1.0 && texture2D(ugHole, hu).r > 0.5) discard; }   // camera in a tunnel: no ground over it (underground.js hole())
  vec3 c0 = texture2D(map, vUv).rgb;                              // sRGB passthrough
  float dcam = length(vW - cameraPosition), near = (1.0 - smoothstep(60.0, 650.0, dcam)) * (1.0 - lite);
  vec2 P = vW.xz;
  vec4 S1 = vec4(0.5), S2 = vec4(0.5), S3 = vec4(0.5), S4 = vec4(0.5), S5 = vec4(0.5), S6 = vec4(0.5), S7 = vec4(0.5);
  vec3 c = c0;
  if (lite < 0.5) {                                               // uniform branch: the cheap preset skips every detail tap
    S1 = T(P * 0.9); S2 = T(P * 5.0); S3 = T(P * 0.035); S4 = T(P * 0.12); S5 = T(P * 11.0); S6 = T(P * 0.35); S7 = T(vec2(P.x * 0.8 - P.y * 0.6, P.x * 0.6 + P.y * 0.8) * 0.13 + 17.0);
    vec2 t = vec2(1.0 / 256.0);                                   // unsharp mask: the printed orthophoto is blurry up close (weight -> 0 beyond 650 m)
    vec3 bl = 0.25 * (texture2D(map, vUv + vec2(t.x, 0.0)).rgb + texture2D(map, vUv - vec2(t.x, 0.0)).rgb + texture2D(map, vUv + vec2(0.0, t.y)).rgb + texture2D(map, vUv - vec2(0.0, t.y)).rgb);
    c = clamp(c0 + (c0 - bl) * 1.3 * near, 0.0, 1.0);
  }
  float lum = dot(c, vec3(0.30, 0.59, 0.11)), gr = c.g - max(c.r, c.b), veg = smoothstep(0.0, 0.07, gr);
  float uu0 = urbanOn > 0.5 ? texture2D(urban, (P - urbanRect.xy) / urbanRect.zw).r : 0.0;
  float rural = 1.0 - smoothstep(0.35, 0.65, uu0);
  // procedural ground detail (world-space, fades with distance)
  float n1 = mix(S1.r, S6.g, 0.3), n2 = S2.r, n3 = S2.g, nb = S3.r;
  float det = (n1 - 0.5) * 0.30 + (n2 - 0.5) * 0.22;
  // grass / scrub: richer green, mown stripes in parks, tufts
  vec3 grass = vec3(0.27, 0.54, 0.16) * (0.80 + 0.5 * n1) + vec3(0.04, 0.03, 0.0) * (nb - 0.5);
  float stripe = 0.5 + 0.5 * sin(dot(P, vec2(0.8, 0.6)) * 0.9);
  grass *= 0.95 + 0.07 * stripe * smoothstep(0.08, 0.2, gr);
  c = mix(c, grass * (0.7 + 0.6 * lum), veg * mix(0.78, 0.55, mad) * near * rural);   // Chiclana: greener fields (user request); Madrid unchanged
  // farmland / bare soil: patchwork of plots with furrows and tonal variation per plot
  vec2 pc = floor(P / 45.0); float ph = h21(pc), ang = ph * 3.14159;
  float fur = 0.5 + 0.5 * sin(dot(P, vec2(cos(ang), sin(ang))) * 2.4 + ph * 40.0);
  float soil = (1.0 - veg) * smoothstep(0.35, 0.5, lum) * (1.0 - smoothstep(0.78, 0.9, lum)) * rural;
  c *= 1.0 + soil * near * ((ph - 0.5) * 0.18 + (fur - 0.5) * 0.10);
  c *= 1.0 + det * near * rural * (0.5 + 0.5 * veg);
  c = mix(vec3(lum), c, 1.12);                                    // slight saturation lift
  vec2 rel = vec2(0.0);                                           // relief gradient (normal perturbation) from the land style
  if (urbanOn > 0.5 && landOn > 0.5) {                            // land-use styles (data-driven by landclass.bin) replace the printed orthophoto
    vec2 jit = (S4.ba - 0.5) * 16.0;
    float cl = floor(texture2D(land, (P + jit - urbanRect.xy) / urbanRect.zw).r * 255.0 + 0.5);
    float shade = clamp(lum / 0.45, 0.65, 1.35), hi = S5.b, hi2 = S5.a, lo = clamp(S6.r + (S7.r - 0.5) * 0.5, 0.0, 1.0);
    vec3 st = c; float amt = 0.0;
    if (cl < 0.5) {                                               // farmland / bare field: per-plot kind (ploughed, stubble, crop rows, vines, olive grid, fallow)
      float pk = h21(pc + 9.0), crop = step(0.5, h21(pc + 3.0)); vec2 dv = vec2(cos(ang), sin(ang)); float al = dot(P, dv), ac = dot(P, vec2(-dv.y, dv.x));
      vec3 soilC = mix(vec3(0.62, 0.50, 0.34), vec3(0.74, 0.64, 0.45), ph), cropC = vec3(0.45, 0.55, 0.24) * (0.85 + 0.3 * ph);
      if (pk < 0.2) { st = soilC * vec3(0.82, 0.74, 0.68) * (0.85 + 0.3 * lo) * (0.78 + 0.34 * (0.5 + 0.5 * sin(ac * 3.1))); rel = dv * (fur - 0.5) * 0.5; }                      // ploughed: dark furrows
      else if (pk < 0.4) { st = mix(vec3(0.78, 0.66, 0.38), vec3(0.70, 0.58, 0.32), lo) * (0.92 + 0.12 * sin(ac * 9.0) * near); }                                              // stubble: straw yellow
      else if (pk < 0.58) { st = mix(soilC * 0.9, cropC, 0.55 + 0.4 * (0.5 + 0.5 * sin(ac * 7.0))) * (0.88 + 0.24 * lo); }                                                    // green crop rows
      else if (pk < 0.72) { vec2 vq = vec2(ac, al) / vec2(2.2, 1.4); vec2 vf = fract(vq) - 0.5; float vine = 1.0 - smoothstep(0.1, 0.26, abs(vf.x)) * smoothstep(0.5, 0.2, abs(vf.y * 0.8)); st = mix(vec3(0.30, 0.42, 0.16), soilC, smoothstep(0.0, 0.8, vine)) * (0.9 + 0.2 * lo); }  // vineyard rows
      else if (pk < 0.84) { vec2 oq = P / 5.5, of = fract(oq) - 0.5; float tr = 1.0 - smoothstep(0.16, 0.3, length(of)); st = mix(soilC * 0.95, vec3(0.34, 0.38, 0.2), tr * 0.85) * (0.9 + 0.2 * lo); }   // olive grove grid
      else { st = mix(vec3(0.66, 0.58, 0.38), vec3(0.50, 0.50, 0.26), smoothstep(0.5, 0.75, S1.g)) * (0.88 + 0.24 * lo); }                                                      // fallow: dry weeds
      st *= 1.0 + (fur - 0.5) * 0.08 * near; amt = 0.88;
    } else if (cl < 1.5) {                                        // scrub: olive mottled with dark bushes
      st = mix(vec3(0.43, 0.42, 0.25), vec3(0.50, 0.46, 0.28), lo) * (0.8 + 0.4 * n2); st = mix(st, vec3(0.24, 0.30, 0.15), smoothstep(0.62, 0.78, S1.g)); rel = (S2.ba - 0.5) * 0.7; amt = 0.88;
    } else if (cl < 2.5) {                                        // forest / pine floor: needles, moss, shade
      st = mix(vec3(0.34, 0.27, 0.16), vec3(0.28, 0.33, 0.17), smoothstep(0.45, 0.7, lo)) * (0.75 + 0.45 * hi); rel = (vec2(hi, hi2) - 0.5) * 0.4; amt = 0.9;
    } else if (cl < 3.5) {                                        // marsh / salina: mud, salt crust, channels
      st = mix(vec3(0.47, 0.44, 0.33), vec3(0.60, 0.57, 0.45), lo); st = mix(st, vec3(0.90, 0.89, 0.84), smoothstep(0.58, 0.72, S4.r)); st *= 1.0 - 0.35 * smoothstep(0.02, 0.0, abs(S3.g - 0.5)); amt = 0.88;
    } else if (cl < 4.5) {                                        // beach sand: ripples and damp patches
      float rip = sin(dot(P, vec2(0.7, 0.35)) * 2.0 + lo * 9.0); st = mix(vec3(0.86, 0.77, 0.58), vec3(0.93, 0.86, 0.69), lo) * (1.0 + 0.04 * rip) * (1.0 - 0.18 * smoothstep(0.6, 0.8, S4.g)); rel = vec2(0.35, 0.17) * rip * 0.3; amt = 0.9;
    } else if (cl < 5.5) {                                        // park lawn: mown stripes OR wild meadow per patch, flowerbeds, gravel paths
      float wild = smoothstep(0.45, 0.6, h21(floor(P / 38.0) + 5.0)), stp = 0.5 + 0.5 * sin(dot(P, vec2(0.74, 0.67)) * 1.1);
      st = mix(vec3(0.30, 0.50, 0.17) * (0.82 + 0.32 * lo) * (0.93 + 0.14 * stp), mix(vec3(0.52, 0.52, 0.24), vec3(0.40, 0.48, 0.20), lo) * (0.85 + 0.3 * hi), wild) * (0.9 + 0.2 * hi);
      float fl = smoothstep(0.80, 0.84, S1.b) * step(0.62, S2.b); st = mix(st, mix(vec3(0.85, 0.2, 0.3), vec3(0.95, 0.8, 0.2), h21(floor(P * 1.4))), fl * (0.85 - 0.5 * wild));
      float pth = (1.0 - smoothstep(0.004, 0.02, abs(S3.g - 0.5))) * (1.0 - wild); st = mix(st, vec3(0.80, 0.74, 0.60) * (0.92 + 0.12 * hi), pth); rel = (vec2(hi, hi2) - 0.5) * 0.3 * (1.0 - pth); amt = 0.92;
    } else if (cl < 6.5) {                                        // dirt: albero (ochre), gravel (grey stones) or packed earth with stones, per patch
      float dk = h21(floor(P / 30.0) + 11.0);
      if (dk < 0.34) st = vec3(0.80, 0.62, 0.38) * (0.9 + 0.2 * lo) * (1.0 + 0.06 * (hi - 0.5));                                    // albero
      else if (dk < 0.62) st = mix(vec3(0.58, 0.57, 0.54), vec3(0.72, 0.70, 0.66), hi) * (0.85 + 0.25 * lo) * (1.0 + 0.25 * (step(0.78, hi2) - 0.5));   // gravel
      else st = vec3(0.63, 0.51, 0.37) * (0.85 + 0.3 * lo) * (1.0 + 0.2 * (step(0.85, hi) - 0.5));
      rel = (vec2(hi, hi2) - 0.5) * 0.35; amt = 0.88;
    }
    c = mix(c, st * mix(1.0, shade, 0.3), amt * mix(0.55, 1.0, near));
  }
  {                                                               // sea cliff (La Barrosa - Sancti Petri, 1a pista): steep faces become layered limestone / calcarenite
    vec2 cq = step(vec2(-8500.0, 2100.0), P) * step(P, vec2(-6600.0, 3350.0));
    float inCliff = cq.x * cq.y, slope = 1.0 - vN.y;
    float rk = inCliff * smoothstep(0.07, 0.2, slope) * smoothstep(1.0, 2.5, vW.y);
    float band = 0.5 + 0.5 * sin(vW.y * 5.5 + S3.r * 6.0), band2 = 0.5 + 0.5 * sin(vW.y * 17.0 + S1.g * 4.0);
    vec3 rockC = mix(vec3(0.62, 0.52, 0.38), vec3(0.78, 0.68, 0.50), band) * (0.88 + 0.16 * band2) * (0.85 + 0.3 * S2.r);
    rockC = mix(rockC, vec3(0.36, 0.30, 0.22), smoothstep(0.5, 0.9, S4.g) * 0.5);
    c = mix(c, rockC, rk * 0.92);
    c *= 1.0 - 0.25 * inCliff * smoothstep(0.25, 0.6, slope);   // darker, self-shadowed face
  }
  if (urbanOn > 0.5) {                                            // built-up land: warm Andalusian paving (slabs, joints, patches) instead of flat grey
    float uw = smoothstep(0.35, 0.65, uu0);
    if (uw > 0.001) {
      float far = smoothstep(90.0, 600.0, dcam), nj = 1.0 - smoothstep(25.0, 160.0, dcam);
      vec2 q = P / 2.4, cell = floor(q), fq = fract(q); float hc = h21(cell), hd = h21(cell + 7.0);
      vec3 stone = vec3(0.74, 0.70, 0.61), ochre = vec3(0.72, 0.60, 0.43), terra = vec3(0.68, 0.54, 0.44), granite = vec3(0.62, 0.59, 0.57);
      float sel = S3.r * 1.6 + (S4.g - 0.5) * 0.9;                // large-scale patches (squares, streets, courtyards)
      vec3 pv = mix(stone, ochre, smoothstep(0.35, 0.65, sel)); pv = mix(pv, terra, smoothstep(0.75, 1.0, sel) * 0.8); pv = mix(pv, granite, smoothstep(0.35, 0.05, sel) * 0.9);
      pv *= 0.90 + 0.20 * hc * (1.0 - far) + 0.10 * far;           // per-slab tone
      pv = mix(pv, pv * vec3(1.06, 0.98, 0.9), step(0.8, hd) * (1.0 - far));
      pv *= 1.0 + (S2.r - 0.5) * 0.14 * near + (S5.r - 0.5) * 0.08 * near;   // grain / wear
      float jn = min(min(fq.x, fq.y), min(1.0 - fq.x, 1.0 - fq.y));
      pv *= 1.0 - 0.22 * nj * (1.0 - smoothstep(0.0, 0.035, jn));  // dark joints, fade out with distance (no moire)
      pv *= mix(1.0, clamp(lum / 0.42, 0.8, 1.22), 0.35);          // keep a little of the real orthophoto shading (shadows, wear)
      pv = mix(pv, vec3(dot(pv, vec3(0.30, 0.59, 0.11))) * vec3(0.96, 0.98, 1.02), 0.75 * mad);   // Madrid: grey granite slabs, not albero tones
      c = mix(c, pv, uw);
    }
  }
  vec3 nrm = normalize(vN + vec3(n2 - 0.5, 0.0, n3 - 0.5) * 0.35 * near * rural + vec3(rel.x, 0.0, rel.y) * near * rural);
  float l = dot(nrm, sunDir);
  c *= 0.82 + 0.30 * clamp(l, 0.0, 1.0);
  vec2 mu = (P - maskRect.xy) / maskRect.zw;
  float m = texture2D(mask, mu).r;
  float g = dot(c, vec3(0.30, 0.59, 0.11));
  if (mad > 0.5) c = mix(mix(vec3(g) * 0.9, fogColor, 0.8 - 0.5 * smoothstep(0.0, 0.45, m)), c, smoothstep(0.40, 0.5, m));   // Madrid: beyond the M-30 the ground greys out and melts into the haze (no black rim, no floating streets)
  else c = mix(vec3(g) * 0.32, c, m);                             // outside the municipality: dim + desaturate
  float d = dcam * fogDensity;
  c = mix(c, fogColor, 1.0 - exp(-d * d));
  gl_FragColor = vec4(c, 1.0);
}`;

/** 256x256 tileable noise: R,G = fbm (octaves at 4/2/1 texels, weights .5/.3/.2), B,A = smooth value noise (4-texel lattice). Deterministic. */
function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4); let seed = 1234567;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0) >>> 8) / 16777216;
  const lattice = n => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const sample = (a, n, x, y) => {   // smooth (smoothstep) bilinear, wrapping
    const fx = x * n / N, fy = y * n / N, ix = Math.floor(fx), iy = Math.floor(fy); let u = fx - ix, v = fy - iy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const x0 = ix % n, x1 = (ix + 1) % n, y0 = iy % n, y1 = (iy + 1) % n;
    return (a[y0 * n + x0] * (1 - u) + a[y0 * n + x1] * u) * (1 - v) + (a[y1 * n + x0] * (1 - u) + a[y1 * n + x1] * u) * v;
  };
  for (let ch = 0; ch < 4; ch++) {
    const A = lattice(64), B = lattice(128), C = lattice(256);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = ch < 2 ? 0.5 * sample(A, 64, x, y) + 0.3 * sample(B, 128, x, y) + 0.2 * C[y * N + x] : sample(A, 64, x, y);
      data[(y * N + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- quadtree LOD terrain
class Node {
  constructor(t, z, x, y, parent) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    [this.x0, this.z0, this.size] = tileRect(z, x, y);
    this.cx = this.x0 + this.size / 2; this.cz = this.z0 + this.size / 2;
    let mn = 1e9, mx = -1e9;
    for (const a of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) {
      const h = t.hf.height(this.x0 + a * this.size, this.z0 + b * this.size); mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    this.minY = mn - 2; this.maxY = mx + 2; this.cy = (mn + mx) / 2;
    this.radius = Math.hypot(this.size * 0.5, this.size * 0.5, (mx - mn) / 2 + 2);
    this.children = null; this.mesh = null; this.tex = null;
    this.state = 0;           // 0 idle, 1 queued/loading, 2 ready
    this.last = 0; this.want = 0; this.pri = 0;
  }
}

export class Terrain {
  /** built-up land raster (u8, 255 = urban) from data/urban.bin: buffer + header {x0,z0,w,h,cols,rows} */
  /** land-class raster (u8 per 8 m cell, same grid as urban.bin) from data/landclass.bin */
  setLand(buf) {
    const u = new Uint32Array(buf, 16, 3), tex = new THREE.DataTexture(new Uint8Array(buf, 28), u[0], u[1], THREE.RedFormat);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    this.shared.land.value = tex; this.shared.landOn.value = 1;
  }
  setUrban(buf) {
    const f = new Float32Array(buf, 0, 4), u = new Uint32Array(buf, 16, 3), data = new Uint8Array(buf, 28);
    const tex = new THREE.DataTexture(data, u[0], u[1], THREE.RedFormat); tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    this.shared.urban.value = tex; this.shared.urbanRect.value.set(f[0], f[1], f[2], f[3]); this.shared.urbanOn.value = 1;
  }
  constructor(scene, hf, mask, fog) {
    this.scene = scene; this.hf = hf; this.mask = mask;
    this.shared = {
      mask: { value: mask.texture },
      maskRect: { value: new THREE.Vector4(mask.x0, mask.z0, mask.w, mask.h) },
      fogColor: { value: new THREE.Vector3(...fog.color) },
      fogDensity: { value: fog.density },
      sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.35).normalize() },
      urban: { value: new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat) }, urbanRect: { value: new THREE.Vector4(0, 0, 1, 1) }, urbanOn: { value: 0 }, land: { value: new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat) }, landOn: { value: 0 }, lite: { value: 0 }, mad: { value: OUT ? 1 : 0 }, noise: { value: noiseTexture() },
      ugHole: { value: null }, ugRect: { value: new THREE.Vector4(0, 0, 1, 1) }, ugOn: { value: 0 },   // tunnel footprint mask, set by underground.js
    };
    this.shared.urban.value.needsUpdate = true;
    this.placeholder = new THREE.DataTexture(new Uint8Array([70, 80, 60, 255]), 1, 1); this.placeholder.needsUpdate = true;
    this.settings = { split: 1.5, maxTex: 650, maxDist: 7000 };
    this.frame = 0; this.queue = []; this.active = 0; this.loaded = new Set(); this.drawn = [];
    this.stats = { drawn: 0, tex: 0, queued: 0, deepest: ROOT_Z };
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4(); this.sph = new THREE.Sphere(); this.tmp = new THREE.Vector3();
    this.roots = [];
    for (let ty = hf.ty0; ty < hf.ty0 + hf.ny; ty++) for (let tx = hf.tx0; tx < hf.tx0 + hf.nx; tx++) {
      const n = new Node(this, ROOT_Z, tx, ty, null);
      if (mask.intersectsRect(n.x0 - 250 - OUT, n.z0 - 250 - OUT, n.size + 500 + 2 * OUT)) this.roots.push(n);
    }
  }

  kids(n) {
    if (!n.children) {
      n.children = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const c = new Node(this, n.z + 1, n.x * 2 + i, n.y * 2 + j, n);
        if (this.mask.intersectsRect(c.x0 - 120 - OUT, c.z0 - 120 - OUT, c.size + 240 + 2 * OUT)) n.children.push(c);
      }
    }
    return n.children;
  }

  request(n, pri) {
    n.want = this.frame; n.pri = pri;
    if (n.state === 0) { n.state = 1; this.queue.push(n); }
  }

  pump() {
    while (this.active < 8 && this.queue.length) {
      let bi = -1, bp = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const n = this.queue[i];
        if (n.want < this.frame - 20) { n.state = 0; this.queue.splice(i--, 1); continue; }   // no longer needed
        if (n.pri < bp) { bp = n.pri; bi = i; }
      }
      if (bi < 0) break;
      const [n] = this.queue.splice(bi, 1);
      this.load(n);
    }
  }

  async load(n) {
    this.active++;
    let bmp = null;
    try {
      const r = await fetch(`/tiles/ortho/${n.z}/${n.x}/${n.y}.jpg`);
      if (r.ok) bmp = await createImageBitmap(await r.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch { /* fall through with placeholder */ }
    this.active--;
    this.attach(n, bmp);
  }

  attach(n, bmp) {
    let tex = this.placeholder;
    if (bmp) {
      tex = new THREE.Texture(bmp);
      tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8; tex.needsUpdate = true;
      tex.onUpdate = () => { tex.onUpdate = null; bmp.close?.(); };
    }
    n.tex = tex; n.state = 2; n.last = this.frame;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: { ...this.shared, map: { value: tex } } });
    n.mesh = new THREE.Mesh(this.geometry(n), mat);
    n.mesh.frustumCulled = false; n.mesh.matrixAutoUpdate = false; n.mesh.visible = false; n.mesh.name = 'terrain';
    this.scene.add(n.mesh);
    this.loaded.add(n);
  }

  geometry(n) {
    const G = n.z <= 16 ? GRID : GRID / 2, W = G + 1, hf = this.hf, e = n.size / G;   // deep levels are small and the relief is gentle: fewer quads
    const nv = W * W + 4 * W, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const k = j * W + i, x = n.x0 + n.size * i / G, z = n.z0 + n.size * j / G;
      pos[k * 3] = x; pos[k * 3 + 1] = hf.height(x, z); pos[k * 3 + 2] = z;
      const hx = hf.height(x + e, z) - hf.height(x - e, z), hz = hf.height(x, z + e) - hf.height(x, z - e), l = Math.hypot(hx, 2 * e, hz);
      nor[k * 3] = -hx / l; nor[k * 3 + 1] = 2 * e / l; nor[k * 3 + 2] = -hz / l;
      uv[k * 2] = (i / G * 255 + 0.5) / 256; uv[k * 2 + 1] = (j / G * 255 + 0.5) / 256;   // half-texel inset: no seams between tiles
    }
    const idx = new Uint16Array(G * G * 6 + 4 * G * 6); let q = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    // skirts hide cracks between neighbouring nodes of different LOD
    const depth = n.size * 0.05 + 1.5;
    const edges = [i => i, i => G * W + i, i => i * W, i => i * W + G];
    edges.forEach((edge, s) => {
      const base = W * W + s * W;
      for (let i = 0; i <= G; i++) {
        const src = edge(i), k = base + i;
        pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - depth; pos[k * 3 + 2] = pos[src * 3 + 2];
        nor[k * 3 + 1] = 1; uv[k * 2] = uv[src * 2]; uv[k * 2 + 1] = uv[src * 2 + 1];
      }
      for (let i = 0; i < G; i++) {
        const a = edge(i), b = edge(i + 1), c = base + i, d = base + i + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  select(n, cp) {
    this.sph.center.set(n.cx, n.cy, n.cz); this.sph.radius = n.radius;
    if (!this.frustum.intersectsSphere(this.sph)) return;
    const dx = Math.max(Math.abs(n.cx - cp.x) - n.size / 2, 0), dz = Math.max(Math.abs(n.cz - cp.z) - n.size / 2, 0);
    const dy = Math.max(cp.y - n.maxY, n.minY - cp.y, 0), d = Math.hypot(dx, dz, dy);
    if (d > this.settings.maxDist) return;   // fully fogged anyway
    if (n.z < MAX_Z && d < n.size * this.settings.split) {
      const ch = this.kids(n); let ready = ch.length > 0;
      for (const c of ch) if (!c.tex) { this.request(c, d); ready = false; }
      if (ready) { for (const c of ch) this.select(c, cp); return; }
    }
    if (!n.tex) { this.request(n, d); return; }
    n.mesh.visible = true; this.drawn.push(n);
    if (n.z > this.stats.deepest) this.stats.deepest = n.z;
    for (let p = n; p; p = p.parent) p.last = this.frame;
  }

  update(camera) {
    this.frame++;
    for (const n of this.drawn) n.mesh.visible = false;
    this.drawn.length = 0; this.stats.deepest = ROOT_Z;
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    for (const r of this.roots) this.select(r, camera.position);
    this.pump();
    if (this.frame % 90 === 0) this.evict();
    this.stats.drawn = this.drawn.length; this.stats.tex = this.loaded.size; this.stats.queued = this.queue.length;
  }

  evict() {
    if (this.loaded.size <= this.settings.maxTex) return;
    const old = [...this.loaded].filter(n => n.z > ROOT_Z && n.last < this.frame - 150).sort((a, b) => a.last - b.last);
    let drop = this.loaded.size - Math.floor(this.settings.maxTex * 0.8);
    for (const n of old) {
      if (drop-- <= 0) break;
      this.scene.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose();
      if (n.tex !== this.placeholder) n.tex.dispose();
      n.mesh = null; n.tex = null; n.state = 0; this.loaded.delete(n);
    }
  }

  /** resolves when every root tile has its texture (so the first frame isn't empty) */
  async preload(camera, onProgress, timeoutMs = 20000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      this.update(camera);
      const done = this.roots.filter(r => r.tex).length;
      onProgress?.(done / this.roots.length);
      if (done === this.roots.length) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /** translucent "curtain" tracing the exact municipal limit */
  addBoundaryCurtain() {
    const pos = [], idx = [], top = [];
    let base = 0;
    for (const ring of this.mask.rings) {
      const pts = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
        for (let s = 0; s < n; s++) pts.push([ax + (bx - ax) * s / n, az + (bz - az) * s / n]);
      }
      pts.push(pts[0]);
      pts.forEach(([x, z], i) => {
        const h = this.hf.height(x, z);
        pos.push(x, h - 4, z, x, h + 260, z); top.push(0, 1);
        if (i < pts.length - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      base += pts.length * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('t', new THREE.Float32BufferAttribute(top, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float t; varying float vT; void main(){ vT = t; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vT; void main(){ float a = pow(1.0 - vT, 2.2) * 0.55; gl_FragColor = vec4(vec3(1.0, 0.72, 0.2) * a, a); }',
    });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5;
    this.scene.add(m);
  }
}
