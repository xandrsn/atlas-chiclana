import * as THREE from 'three';
import { toLocal } from './geo.js';
import { Collide } from './collide.js';
import { FB } from './football.js';
import { CT } from './courts.js';
import { PA } from './places.js';
import { props } from './props.js';
import { GRAN_PLAZA } from './stairs.js';

// Procedural streets, pavements, bridges, pitches, parking, parks, rivers, trees and parked cars built from OSM vectors.
// Everything is meshed from the geometry (no map screenshot): ribbons draped on the heightfield, per 512 m cell, near the camera only.
const CELL = 512, COL = 32, STEP = 4;
const SPEC = {   // highway -> [colour, y-bias, sidewalk width]
  motorway: [0x34363a, 0.14, 0], motorway_link: [0x34363a, 0.14, 0], trunk: [0x35373b, 0.14, 0], trunk_link: [0x35373b, 0.14, 0],
  primary: [0x3a3c40, 0.13, 2.2], primary_link: [0x3a3c40, 0.13, 0], secondary: [0x3e4044, 0.12, 2.2], secondary_link: [0x3e4044, 0.12, 0],
  tertiary: [0x44464a, 0.11, 2.0], tertiary_link: [0x44464a, 0.11, 0], residential: [0x4b4d51, 0.10, 1.9], unclassified: [0x4d4f53, 0.10, 1.7],
  living_street: [0x66625b, 0.09, 1.5], service: [0x55575b, 0.08, 0], track: [0x8a7456, 0.07, 0], pedestrian: [0xb3aa9b, 0.09, 0],
  footway: [0xbab3a6, 0.06, 0], path: [0xa59477, 0.05, 0], cycleway: [0x9c5a4e, 0.06, 0], steps: [0xa8a196, 0.06, 0], bridleway: [0xa59477, 0.05, 0],
};
const DIRT = [0x93805f, 0.06, 0];
const PITCH = { tennis: 0xb2563b, padel: 0x2d6db3, basketball: 0xc4652d, soccer: 0x3f8a3c, football: 0x3f8a3c, rugby: 0x3f8a3c, volleyball: 0xdcc690, beachvolleyball: 0xe0cf9c, running: 0xb5483a, athletics: 0xb5483a, multi: 0x4a8a5a };
const LINED = new Set(['tennis', 'padel', 'basketball', 'soccer', 'football', 'rugby', 'volleyball', 'multi']);
const hex = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255].map(v => Math.pow(v, 2.2));   // sRGB -> linear

// ---- tiny geometry builder (non-indexed triangles with vertex colours)
/** Grass texture for lawns / parks / pitches (the `area` material): blades, clumps and mowing stripes from world position, only on green fragments. */
function grassFx(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGP;
float ah(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float an(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ah(i), ah(i + vec2(1, 0)), f.x), mix(ah(i + vec2(0, 1)), ah(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (diffuseColor.g > diffuseColor.r * 1.12 && diffuseColor.g > diffuseColor.b * 1.12) {
  float dd = length(vGP - cameraPosition), nr = 1.0 - smoothstep(15.0, 90.0, dd); vec2 P = vGP.xz;
  float blades = ah(floor(vec2(P.x * 14.0, P.y * 5.0))) - 0.5, clump = an(P * 0.9) - 0.5, patchy = an(P * 0.13) - 0.5, stripe = step(0.5, fract((P.x + P.y) / 11.0)) - 0.5;
  diffuseColor.rgb *= 1.0 + blades * 0.22 * nr + clump * 0.16 + stripe * 0.05;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.05, 0.72), clamp(patchy * 0.9, 0.0, 0.35));   // dry yellowish patches
}`);
  };
}
/** Procedural surface detail for road / pavement materials, computed in the fragment shader from world position (no extra geometry or draw calls):
 *  dark cool asphalt with wear / patches / grain, warm tiled pavements (slabs + joints) near the camera. Classified by the baked vertex-colour luminance. */
export function groundFx(mat) {
  mat.userData.fx = 'ground1';
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWP; varying float vUp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWP = (modelMatrix * vec4(position, 1.0)).xyz; vUp = normalize(mat3(modelMatrix) * normal).y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; varying float vUp;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float lm = dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11));
  float dd = length(vWP - cameraPosition), nr = 1.0 - smoothstep(20.0, 140.0, dd), fr = 1.0 - smoothstep(60.0, 400.0, dd);
  vec2 P = vWP.xz;
  if (vUp > 0.85) {
    if (lm < 0.115) {                                            // asphalt / dark surfaces
      float w = gn(P * 0.45) * 0.55 + gn(P * 1.7) * 0.3 + gn(P * 6.0) * 0.15;
      float repair = smoothstep(0.62, 0.7, gn(P * 0.11 + 31.0));  // darker repairs
      float g = gh(floor(P * 16.0)) - 0.5;
      diffuseColor.rgb *= (0.86 + 0.28 * w) * (1.0 - 0.14 * repair) * (1.0 + g * 0.05 * nr) * vec3(0.97, 1.0, 1.04);
    } else if (lm > 0.17 && lm < 0.62 && diffuseColor.r - diffuseColor.b < 0.3 * lm) {                          // pavements / pedestrian streets / footways: warm tiled slabs
      float sty = gh(floor(P / 55.0) + 3.0);                       // paving style per ~55 m patch: slabs / hydraulic tiles / brick herringbone / long granite / cobbles
      vec3 warm = diffuseColor.rgb * vec3(1.07, 0.99, 0.87);
      if (sty < 0.34) {
        vec2 q = P / 0.6, cl = floor(q), f = fract(q); float h = gh(cl), jn = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
        warm *= 0.93 + 0.14 * mix(0.5, h, fr) + (gn(P * 0.8) - 0.5) * 0.1 * fr; warm *= 1.0 - 0.2 * nr * (1.0 - smoothstep(0.0, 0.04, jn));
      } else if (sty < 0.5) {                                      // baldosa hidraulica: 0.3 m tiles with a darker diamond
        vec2 q = P / 0.3, cl = floor(q), f = fract(q) - 0.5; float h = gh(cl), dm = abs(f.x) + abs(f.y);
        warm = mix(warm, warm * vec3(0.78, 0.8, 0.86), step(dm, 0.32) * step(0.2, dm) * fr * step(0.4, h + 0.3)); warm *= 0.94 + 0.1 * h * fr; warm *= 1.0 - 0.18 * nr * (1.0 - smoothstep(0.0, 0.03, 0.5 - max(abs(f.x), abs(f.y))));
      } else if (sty < 0.68) {                                     // red brick / adoquin herringbone
        vec2 q = vec2(P.x + P.y, P.x - P.y) / 0.42; vec2 cl = floor(q * vec2(1.0, 0.5)), f = fract(q * vec2(1.0, 0.5)); float h = gh(cl), jn = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
        warm = mix(warm, vec3(0.62, 0.38, 0.30) * (0.85 + 0.3 * h), 0.8); warm *= 1.0 - 0.28 * nr * (1.0 - smoothstep(0.0, 0.07, jn));
      } else if (sty < 0.84) {                                     // long granite kerb-style slabs
        vec2 q = vec2(P.x / 1.1, P.y / 0.45), cl = floor(q), f = fract(q); float h = gh(cl), jn = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
        warm = mix(warm, vec3(0.60, 0.59, 0.58) * (0.88 + 0.24 * h), 0.8); warm *= 1.0 - 0.2 * nr * (1.0 - smoothstep(0.0, 0.05, jn));
      } else {                                                     // cobbles
        vec2 q = P / 0.16, cl = floor(q + 0.5 * mod(floor(q.y), 2.0)), f = fract(q + 0.5 * mod(floor(q.y), 2.0)) - 0.5; float h = gh(cl);
        warm = mix(warm, vec3(0.55, 0.52, 0.48) * (0.8 + 0.4 * h), 0.7); warm *= 1.0 - 0.3 * nr * smoothstep(0.32, 0.5, length(f));
      }
      diffuseColor.rgb = warm;
    }
  }
}`);
  };
  return mat;
}

class Mesher {
  constructor(cap = 256) { this.p = new Float32Array(cap * 9); this.c = new Float32Array(cap * 9); this.n = new Float32Array(cap * 9); this.k = 0; }
  tri(a, b, c, col) {
    const k = this.k; if (k + 9 > this.p.length) { for (const f of ['p', 'c', 'n']) { const o = this[f], g = new Float32Array(o.length * 2); g.set(o); this[f] = g; } }
    const p = this.p, cc = this.c, n = this.n, ax = a[0], ay = a[1], az = a[2], ux = b[0] - ax, uy = b[1] - ay, uz = b[2] - az, vx = c[0] - ax, vy = c[1] - ay, vz = c[2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;   // flat face normal
    p[k] = ax; p[k + 1] = ay; p[k + 2] = az; p[k + 3] = b[0]; p[k + 4] = b[1]; p[k + 5] = b[2]; p[k + 6] = c[0]; p[k + 7] = c[1]; p[k + 8] = c[2];
    for (let i = 0; i < 9; i += 3) { cc[k + i] = col[0]; cc[k + i + 1] = col[1]; cc[k + i + 2] = col[2]; n[k + i] = nx; n[k + i + 1] = ny; n[k + i + 2] = nz; }
    this.k = k + 9;
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  get count() { return this.k / 9; }
  geometry() {
    const g = new THREE.BufferGeometry(), k = this.k;
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, k), 3)); g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, k), 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.n.slice(0, k), 3));
    g.computeBoundingSphere(); return g;
  }
}
function mergeColored(parts) {   // [{geo, color}] -> single non-indexed geometry with colour attribute
  const P = [], N = [], C = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { P.push(p[i]); N.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) C.push(color[0], color[1], color[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
const _tp = new THREE.Vector3(), _ts = new THREE.Vector3();
// ---- vegetation species (instanced, ~20-90 tris each). Tree entries are [x, y, z, scale, species]; species 0 = the generic round tree (treeGeo)
const SP = { GEN: 0, UMB: 1, MAR: 2, CYP: 3, OLV: 4, EUC: 5, SHR: 6, AGA: 7, OPU: 8, FLR: 9, FLY: 10, FLP: 11, OLE: 12, RET: 13 };
function vegGeos() {
  const P = (g, x, y, z, c, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); return { geo: g, color: hex(c) }; };
  const ico = r => new THREE.IcosahedronGeometry(r, 0), cyl = (a, b, h, s = 5) => new THREE.CylinderGeometry(a, b, h, s), cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
  const dots = (cs, n, R, y, r) => { const o = []; for (let i = 0; i < n; i++) { const a = i * 2.4, rr = R * (0.45 + 0.55 * ((i * 0.618) % 1)); o.push(P(ico(r), Math.cos(a) * rr, y + 0.25 * ((i * 0.37) % 1), Math.sin(a) * rr, cs)); } return o; };
  const bush = (c1, c2) => [P(ico(0.75), 0, 0.45, 0, c1, 1, 0.75, 1), P(ico(0.5), 0.6, 0.3, 0.2, c2), P(ico(0.45), -0.5, 0.3, -0.3, c1)];
  const G = [];
  G[SP.UMB] = [P(cyl(0.2, 0.32, 5.2), 0, 2.6, 0, 0x6a4a34), P(ico(3.1), 0, 5.9, 0, 0x3f6e38, 1, 0.42, 1), P(ico(2.0), 1.2, 5.2, 0.6, 0x4a7a3c, 1, 0.4, 1)];   // pino piñonero: tall bole, flat parasol crown
  G[SP.MAR] = [P(cyl(0.17, 0.28, 7), 0, 3.5, 0, 0x6b4a36), P(cone(1.8, 3.2), 0, 6.2, 0, 0x2f5b32), P(cone(1.3, 2.6), 0, 8.0, 0, 0x356536), P(cone(0.8, 2), 0, 9.4, 0, 0x3b6c3a)];   // pino marítimo / carrasco
  G[SP.CYP] = [P(cyl(0.12, 0.2, 0.8, 4), 0, 0.4, 0, 0x4a3a2a), P(ico(1.0), 0, 4, 0, 0x24462a, 0.7, 3.6, 0.7)];
  G[SP.OLV] = [P(cyl(0.2, 0.3, 1.6), 0, 0.8, 0, 0x6a5a48), P(ico(1.9), 0, 2.6, 0, 0x7e8f5c, 1, 0.7, 1), P(ico(1.2), 1, 2.2, 0.5, 0x8a9a66)];
  G[SP.EUC] = [P(cyl(0.14, 0.26, 7, 4), 0, 3.5, 0, 0xbdb4a2), P(ico(1.5), 0, 8, 0, 0x6c8c68, 1, 2, 1), P(ico(1.0), 0.8, 6, 0, 0x7a9a72)];
  G[SP.SHR] = bush(0x4f7d3c, 0x5d8c44);
  G[SP.AGA] = [0, 1, 2, 3, 4, 5, 6, 7].map(k => { const g = new THREE.ConeGeometry(0.2, 1.3, 4); g.translate(0, 0.65, 0); g.rotateZ(0.95); g.rotateY(k * 0.785); return { geo: g, color: hex(k & 1 ? 0x6f9a86 : 0x7aa68f) }; });   // agave rosette
  G[SP.OPU] = [P(cyl(0.55, 0.55, 0.12, 6).rotateX(Math.PI / 2), 0, 0.55, 0, 0x6f8f4a), P(cyl(0.45, 0.45, 0.12, 6).rotateX(Math.PI / 2), 0.35, 1.15, 0, 0x78974f), P(cyl(0.4, 0.4, 0.12, 6).rotateX(Math.PI / 2), -0.35, 1.05, 0.1, 0x6a8a45)];   // chumbera
  for (const [sp, c] of [[SP.FLR, 0xd8372f], [SP.FLY, 0xf0c93a], [SP.FLP, 0xc15fc0]]) G[sp] = [P(ico(0.7), 0, 0.3, 0, 0x4a7a3a, 1.3, 0.5, 1.3), ...dots(c, 7, 0.75, 0.55, 0.17)];   // flower beds
  G[SP.OLE] = [P(ico(0.8), 0, 0.6, 0, 0x4f7d3c, 1, 0.9, 1), ...dots(0xe86a9a, 6, 0.6, 0.85, 0.15)];   // adelfa
  G[SP.RET] = [P(ico(0.9), 0, 0.6, 0, 0x8aa84a, 1, 0.8, 1), ...dots(0xe8d34a, 6, 0.65, 0.85, 0.14)];   // retama
  return G.map(p => p && mergeColored(p));
}
/** species for an orthophoto/OSM tree from the land class (landclass.bin: 0 farm, 1 scrub, 2 pinar, 4 sand, 5 lawn, 8 built) or an explicit context; h in [0,1) */
function pickSp(cls, h, ctx) {
  if (ctx === 'wood' || cls === 2) return h < 0.6 ? SP.UMB : h < 0.88 ? SP.MAR : h < 0.93 ? SP.EUC : 0;
  if (ctx === 'orchard') return h < 0.7 ? SP.OLV : 0;
  if (ctx === 'park' || cls === 5) return h < 0.4 ? 0 : h < 0.5 ? SP.CYP : h < 0.62 ? SP.OLV : h < 0.74 ? SP.UMB : h < 0.8 ? SP.EUC : h < 0.85 ? SP.MAR : 0;
  if (cls === 1) return h < 0.35 ? SP.OLV : h < 0.55 ? SP.UMB : 0;
  if (cls === 0) return h < 0.3 ? SP.OLV : h < 0.36 ? SP.EUC : h < 0.4 ? SP.CYP : 0;
  return h < 0.08 ? SP.CYP : h < 0.18 ? SP.OLV : h < 0.22 ? SP.UMB : h < 0.25 ? SP.EUC : 0;
}
function hash2(x, z) { let h = Math.imul((x * 73856093) ^ (z * 19349663), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

export class World {
  constructor(scene, hf, buildings, osm, waterMat, veg) {
    this.scene = scene; this.hf = hf; this.b = buildings; this.waterMat = waterMat;
    this.settings = { roadR: 700, treeR: 450, carR: 260 };
    this.cells = new Map(); this.active = new Map();
    this.roads = []; this.areas = []; this.rivers = []; this.cellOf = c => c;
    const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    this.key = key;
    const get = (k) => { let c = this.cells.get(k); if (!c) this.cells.set(k, c = { runs: [], areas: [], rivers: [], trees: [] }); return c; };
    this.get = get;
    // ---- roads: project, resample to ~STEP m
    for (const r of [...osm.roads, GRAN_PLAZA]) {
      const pts = r.loc ? r.loc.slice() : []; if (!r.loc) for (let i = 0; i < r.p.length; i += 2) pts.push(toLocal(r.p[i], r.p[i + 1]));
      const P = resample(pts, STEP); if (P.length < 4) continue;
      const spec = r.u ? DIRT : SPEC[r.h] || SPEC.service, road = { cls: r.h, w: r.w, drive: r.d, bridge: r.b, P, n: P.length / 2, spec, name: r.n, lanes: r.l || 0, ow: r.ow, rb: r.rb, u: r.u, swTag: r.sw ?? -1, tier: r.b || /motorway|trunk|primary|secondary/.test(r.h) ? 2 : /residential|unclassified|living|tertiary/.test(r.h) ? 1 : 0 };
      if (!r.b && r.d && !r.u && /primary|secondary|tertiary|residential|unclassified/.test(r.h)) road.w = Math.max(road.w, r.ow ? 5 : 6.8);   // OSM-derived widths ran 10-15% under real streets: cramped for 4.5 m cars
      if (r.b && !r.d) road.w = Math.max(road.w, 2.2);   // footbridge decks: wide enough to stay on (1.4 m paths made walkers slip off the edge)
      if (r.n === 'Puente VII Centenario') { road.w = 20; road.blue = true; }   // "Puente Azul": 57 m steel arch, ~20 m deck
      if (r.b && r.d && Math.hypot(P[(P.length >> 2) << 1] + 3497, P[((P.length >> 2) << 1) + 1] + 2127) < 60) road.walks = true;   // Puente de los Remedios: pavements on both sides
      if (r === GRAN_PLAZA) road.plaza = true;   // flat pedestrian plaza-deck over the Iro: glass balustrade, pergola, benches, planters, statue
      road.G = new Float32Array(road.n); for (let i = 0; i < road.n; i++) road.G[i] = hf.height(P[2 * i], P[2 * i + 1]);
      road.Y = road.G;
      if (r.b && !r.d && road.n > 2 && !road.plaza) {   // a footway tagged bridge that climbs a bank (steep end to end) or is buried by the terrain between its ends is a ramp, not a deck: keep it on the ground
        const m = road.n - 1, G = road.G; let L = 0, hump = 0; for (let i = 1; i <= m; i++) L += Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
        for (let i = 1, a = 0; i < m; i++) { a += Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]); hump = Math.max(hump, G[i] - (G[0] + (G[m] - G[0]) * a / L)); }
        if (Math.abs(G[m] - G[0]) / L > 0.12 || hump > 0.5) road.bridge = 0;
      }
      if (road.plaza) road.Y = new Float32Array(road.n).fill(road.G[road.n - 1]);   // level with Plaza de Andalucía; the south end drops by the gradas (stairs.js)
      else if (road.bridge) { this.deck(road, hf); this.rampEnds(road, hf); }
      this.roads.push(road);
      // assign runs of consecutive points sharing a cell
      let i0 = 0, k0 = key(P[0], P[1]);
      for (let i = 1; i < road.n; i++) {
        const k = key(P[2 * i], P[2 * i + 1]);
        if (k !== k0) { get(k0).runs.push([road, i0, i]); i0 = i; k0 = k; }
      }
      get(k0).runs.push([road, i0, road.n - 1]);
    }
    // ---- at-grade road index (every class, bridges excluded): keeps river carving off roads and gives decks clearance over lower roads
    const ag = new Map(), agS = [];
    for (const r of this.roads) if (!r.bridge) for (let i = 0; i + 1 < r.n; i++) {
      const ax = r.P[2 * i], az = r.P[2 * i + 1], bx = r.P[2 * i + 2], bz = r.P[2 * i + 3], id = agS.length / 7;
      agS.push(ax, az, bx, bz, r.w / 2, r.G[i], r.G[i + 1]);
      const pd = r.w / 2 + 3; for (let gx = Math.floor((Math.min(ax, bx) - pd) / COL); gx <= Math.floor((Math.max(ax, bx) + pd) / COL); gx++) for (let gz = Math.floor((Math.min(az, bz) - pd) / COL); gz <= Math.floor((Math.max(az, bz) + pd) / COL); gz++) { const k = gx + ',' + gz; let l = ag.get(k); if (!l) ag.set(k, l = []); l.push(id); }
    }
    /** highest at-grade road surface under (x,z) within half-width+pad, or -1e9 */
    const agQ = (x, z, pad) => {
      const l = ag.get(Math.floor(x / COL) + ',' + Math.floor(z / COL)); if (!l) return -1e9; let best = -1e9;
      for (const id of l) {
        const o = id * 7, ax = agS[o], az = agS[o + 1], dx = agS[o + 2] - ax, dz = agS[o + 3] - az, l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - x, pz = az + dz * t - z, lim = agS[o + 4] + pad; if (px * px + pz * pz > lim * lim) continue;
        const y = agS[o + 5] + (agS[o + 6] - agS[o + 5]) * t; if (y > best) best = y;
      }
      return best;
    };
    const bEnds = []; for (const r of this.roads) if (r.bridge) { const m = r.n - 1; bEnds.push(r.P[0], r.P[1], r.P[2 * m], r.P[2 * m + 1]); }   // abutments: river banks must not eat the ground a deck end sits on
    const nearEnd = (x, z) => { for (let i = 0; i < bEnds.length; i += 2) if ((x - bEnds[i]) ** 2 + (z - bEnds[i + 1]) ** 2 < 49) return true; return false; };
    const noCarve = (x, z) => agQ(x, z, 2) > -1e8 || nearEnd(x, z);
    // decks that cross OVER a lower at-grade road get >= 5.2 m clearance (ramped at <= 8 % so the ends still meet their approach roads)
    for (const r of this.roads) if (r.bridge && r.n > 3 && !r.plaza) {
      const n = r.n, L = new Float32Array(n); for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(r.P[2 * i] - r.P[2 * i - 2], r.P[2 * i + 1] - r.P[2 * i - 1]);
      const tot = L[n - 1]; let lift = new Float32Array(n), any = false;
      for (let i = 1; i < n - 1; i++) { const o = agQ(r.P[2 * i], r.P[2 * i + 1], r.w / 2 + 1); if (o > -1e8 && o < r.Y[i] - 1.2 && o > r.Y[i] - 7) { lift[i] = Math.max(0, o + 5.2 - r.Y[i]); if (lift[i] > 0) any = true; } }
      if (!any) continue;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j < n; j++) if (lift[j] > 0) m = Math.max(m, lift[j] - 0.08 * Math.abs(L[i] - L[j])); out[i] = Math.min(m, 0.08 * Math.min(L[i], tot - L[i])); }
      const Y = new Float32Array(r.Y); for (let i = 0; i < n; i++) Y[i] += out[i]; r.Y = Y; r.lifted = true;
    }
    // ---- areas, rivers, trees
    for (const a of osm.areas) {
      const pts = []; for (let i = 0; i < a.p.length - 2; i += 2) pts.push(toLocal(a.p[i], a.p[i + 1]));   // drop closing point
      if (pts.length < 3) continue;
      let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [x, z] of pts) { cx += x; cz += z; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const ar = { k: a.k, sport: (a.s || '').split(';')[0], pts, cx: cx / pts.length, cz: cz / pts.length, ext: Math.hypot(x1 - x0, z1 - z0), x0, x1, z0, z1 };
      get(key(ar.cx, ar.cz)).areas.push(ar);
    }
    for (const w of osm.waterways) {
      const pts = []; for (let i = 0; i < w.p.length; i += 2) pts.push(toLocal(w.p[i], w.p[i + 1]));
      const P = resample(pts, 8); if (P.length < 4) continue;
      const rv = { w: w.w, P, n: P.length / 2 };
      {   // smooth water level (running min then average along the course), carve a real channel into the DEM where it is inland
        const n = rv.n, H = new Float32Array(n), Wy = new Float32Array(n);
        for (let i = 0; i < n; i++) H[i] = hf.height(P[2 * i], P[2 * i + 1]);
        for (let i = 0; i < n; i++) { let m = 1e9; for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) m = Math.min(m, H[k]); Wy[i] = m; }
        for (let pass = 0; pass < 2; pass++) { const c = Float32Array.from(Wy); for (let i = 0; i < n; i++) { let a = 0, b = 0; for (let k = Math.max(0, i - 4); k <= Math.min(n - 1, i + 4); k++) { a += c[k]; b++; } Wy[i] = a / b; } }
        rv.Wy = Wy;
        const hw = w.w / 2, dp = Math.min(2.2, 0.5 + hw * 0.14);   // bed profile: shallow banks, deeper centre (channel depth grows with river width)
        if (w.w >= 10) for (let i = 0; i < n; i++) { const x = P[2 * i], z = P[2 * i + 1], yb = Math.max(Wy[i], 0.35) + RIVER_BANK;   // flat promenade (street level) both sides, then the channel is cut back in
          if (URBAN_RIVER(x, z) && Math.abs(hf.height(x, z) - yb) < 10) hf.level(x, z, w.w / 2 + 7, 14, yb, noCarve); }
        for (let i = 0; i < n; i++) { const yw = Math.max(Wy[i], 0.35), x = P[2 * i], z = P[2 * i + 1];
          hf.carve(x, z, hw * 0.3, hw * 0.45, yw - dp, noCarve); hf.carve(x, z, hw * 0.7, hw * 0.3, yw - dp * 0.5, noCarve); hf.carve(x, z, hw, w.w >= 10 && URBAN_RIVER(x, z) ? 2 : Wy[i] >= 0.9 ? 9 : 3, yw - 0.3, noCarve); }   // urban: steep cut so the quay wall stands at the channel edge
      }
      for (let i = 0; i < rv.n; i += 8) get(key(P[2 * i], P[2 * i + 1])).rivers.push([rv, Math.max(0, i - 1), Math.min(rv.n - 1, i + 8)]);
    }
    for (let i = 0; i < osm.trees.length; i += 2) { const [x, z] = toLocal(osm.trees[i], osm.trees[i + 1]); get(key(x, z)).trees.push([x, z]); }
    // ---- detected vegetation (orthophoto): trees (x,z,r) and lawn cells, indexed per 512 m cell
    this.veg = { trees: new Map(), grass: new Map(), nT: 0, nG: 0 };
    if (veg?.treeCells) {   // packed per cell (scripts/pack_world.mjs): no per-tree indexing at start-up, trees pre-shuffled so the first N are an even thinning
      const ab = veg.treeCells, h = new Uint32Array(ab, 0, 4), nC = h[1], nT = h[2], tab = new Int32Array(ab, 16, nC * 4), m = this.veg.trees;
      this.veg.pack = { cell: h[3], xz: new Uint16Array(ab, 16 + nC * 16, nT * 2), rad: new Uint8Array(ab, 16 + nC * 16 + nT * 4, nT) };
      for (let i = 0; i < nC; i++) m.set(tab[i * 4] + ',' + tab[i * 4 + 1], { cx: tab[i * 4], cz: tab[i * 4 + 1], start: tab[i * 4 + 2] >>> 0, count: tab[i * 4 + 3] >>> 0 });
      this.veg.nT = nT;
    } else if (veg?.trees) {
      const T = veg.trees, m = this.veg.trees;
      for (let i = 0; i + 2 < T.length; i += 3) { const k = key(T[i], T[i + 1]); let l = m.get(k); if (!l) m.set(k, l = []); l.push(i); }
      this.veg.nT = T.length / 3; this.veg.T = T;
    }
    if (veg?.grass) {
      const G = veg.grass, m = this.veg.grass, [gx0, gz0] = veg.grassOrigin;
      for (let i = 0; i + 1 < G.length; i += 2) { const x = gx0 + G[i] * 4, z = gz0 + G[i + 1] * 4, k = key(x, z); let l = m.get(k); if (!l) m.set(k, l = []); l.push(x, z); }
      this.veg.nG = G.length / 2;
    }
    // ---- cadastral boundary walls (rural) and detected swimming pools, indexed per cell
    this.veg.walls = new Map(); this.veg.pools = new Map();
    if (veg?.walls) { const W = veg.walls, m = this.veg.walls; for (let i = 0; i + 3 < W.length; i += 4) { const k = key((W[i] + W[i + 2]) / 2, (W[i + 1] + W[i + 3]) / 2); let l = m.get(k); if (!l) m.set(k, l = []); l.push(i); } this.veg.W = W; for (const k of m.keys()) get(k); }
    if (veg?.pools) { const Pl = veg.pools, m = this.veg.pools; for (let i = 0; i < Pl.length; i++) { const k = key(Pl[i].x, Pl[i].z); let l = m.get(k); if (!l) m.set(k, l = []); l.push(i); } this.veg.Pl = Pl; for (const k of m.keys()) get(k); }
    // ---- collision index of drivable surfaces
    this.agQ = agQ;
    const pidx = this.pgrid = new Map(), pseg = this.pseg = [];
    const idx = this.grid = new Map(), seg = [], fidx = this.fgrid = new Map(), fseg = [], parap = [];
    for (const r of this.roads) {
      if (!r.drive && !r.bridge) { for (let i = 0; i + 1 < r.n; i++) { const ax = r.P[2 * i], az = r.P[2 * i + 1], bx = r.P[2 * i + 2], bz = r.P[2 * i + 3], id = pseg.length / 5, pd = r.w / 2 + 2; pseg.push(ax, az, bx, bz, r.w / 2);   // footways / pedestrian streets / paths on the ground: walls must never cut across them
          for (let gx = Math.floor((Math.min(ax, bx) - pd) / COL); gx <= Math.floor((Math.max(ax, bx) + pd) / COL); gx++) for (let gz = Math.floor((Math.min(az, bz) - pd) / COL); gz <= Math.floor((Math.max(az, bz) + pd) / COL); gz++) { const k = gx + ',' + gz; let l = pidx.get(k); if (!l) pidx.set(k, l = []); l.push(id); } } continue; }      // non-drivable bridges (footbridges, cycleways, paths) go into a pedestrian-only index
      const foot = !r.drive, I = foot ? fidx : idx, S = foot ? fseg : seg;
      for (let i = 0; i + 1 < r.n; i++) {
        const ax = r.P[2 * i], az = r.P[2 * i + 1], bx = r.P[2 * i + 2], bz = r.P[2 * i + 3];
        const id = S.length / 7; S.push(ax, az, bx, bz, r.w / 2, r.Y[i] + r.spec[1], r.Y[i + 1] + r.spec[1]);
        const pd = r.w / 2 + 1, gx0 = Math.floor((Math.min(ax, bx) - pd) / COL), gx1 = Math.floor((Math.max(ax, bx) + pd) / COL), gz0 = Math.floor((Math.min(az, bz) - pd) / COL), gz1 = Math.floor((Math.max(az, bz) + pd) / COL);   // padded by half-width: edges near a cell border must still be found
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) { const k = gx + ',' + gz; let l = I.get(k); if (!l) I.set(k, l = []); l.push(id); }
        // parapet walls along both edges of every bridge (skip the 1st/last segment so vehicles can enter); y-tagged: [x1,z1,x2,z2,thick,yA,yB]
        if (r.bridge && i >= 1 && i + 2 < r.n) {
          const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl, hw = r.w / 2 - 0.05;
          for (const sg of [1, -1]) parap.push([ax + nx * sg * hw, az + nz * sg * hw, bx + nx * sg * hw, bz + nz * sg * hw, 0.05, r.Y[i] + r.spec[1], r.Y[i + 1] + r.spec[1], nx * sg, nz * sg]);
        }
      }
    }
    this.seg = new Float32Array(seg); this.fseg = new Float32Array(fseg);
    this.col = new Collide();   // solid props (walls, trunks, traffic cars) for vehicle physics
    // a parapet is dropped where another deck/road joins at the same height just outside the edge (ramps, slip roads, junction on the bridge): it would wall off the connection
    const open = (w, u) => { const x = w[0] + (w[2] - w[0]) * u + w[7] * 0.7, z = w[1] + (w[3] - w[1]) * u + w[8] * 0.7; const y = w[5] + (w[6] - w[5]) * u, o = this.road(x, z, y, 0); return !!o && Math.abs(o.y - y) < 1.2; };
    for (let q = parap.length - 1; q >= 0; q--) if (open(parap[q], 0.25) || open(parap[q], 0.5) || open(parap[q], 0.75)) parap.splice(q, 1);
    this.col.add('bridges', parap, []);
    this.stats = { cells: 0, trees: 0, cars: 0, queued: 0 };
    this.mats = {
      road: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      area: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      tree: new THREE.MeshLambertMaterial({ vertexColors: true }),
      wall: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    };
    this.mats.roadT = [-2, -4, -6, -9].map(o => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: o, polygonOffsetUnits: o }));
    if (!/[?&]nofx/.test(location.search)) { grassFx(this.mats.area); groundFx(this.mats.road); for (const m of this.mats.roadT) groundFx(m); }
    const T = [];
    { const trunk = new THREE.CylinderGeometry(0.16, 0.22, 2.4, 4); trunk.translate(0, 1.2, 0); T.push({ geo: trunk, color: hex(0x5a4128) });
      const c1 = new THREE.IcosahedronGeometry(2.0, 0); c1.scale(1, 1.15, 1); c1.translate(0, 3.9, 0); T.push({ geo: c1, color: hex(0x4f8a3a) }); }
    this.treeGeo = mergeColored(T); this.vegG = vegGeos();
    if (veg?.land) { const f = new Float32Array(veg.land, 0, 2), u = new Uint32Array(veg.land, 16, 3); this.land = { x0: f[0], z0: f[1], cols: u[0], rows: u[1], c8: u[2], d: new Uint8Array(veg.land, 28) }; }   // landclass.bin: u8 per cell, header as urban.bin
    const Cr = [];
    { const body = new THREE.BoxGeometry(1.8, 0.62, 4.2); body.translate(0, 0.72, 0); Cr.push({ geo: body, color: [1, 1, 1] });
      const cab = new THREE.BoxGeometry(1.55, 0.52, 2.2); cab.translate(0, 1.29, 0.2); Cr.push({ geo: cab, color: [0.28, 0.33, 0.38] });
      const wh = new THREE.BoxGeometry(1.9, 0.5, 3.0); wh.translate(0, 0.3, 0); Cr.push({ geo: wh, color: [0.05, 0.05, 0.05] }); }
    this.carGeo = mergeColored(Cr);
    this.carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.queue = []; this.last = { x: 1e9, z: 1e9 };
    for (const r of this.roads) if (r.rb && r.drive && r.n > 8) {   // roundabout: central island (kerb + grass)
      const x0 = r.P[0], z0 = r.P[1], xe = r.P[2 * r.n - 2], ze = r.P[2 * r.n - 1];
      if (Math.hypot(x0 - xe, z0 - ze) > 6) continue;
      let cx = 0, cz = 0; for (let i = 0; i < r.n; i++) { cx += r.P[2 * i]; cz += r.P[2 * i + 1]; } cx /= r.n; cz /= r.n;
      let rad = 0; for (let i = 0; i < r.n; i++) rad += Math.hypot(r.P[2 * i] - cx, r.P[2 * i + 1] - cz); rad = rad / r.n - r.w / 2;
      if (rad > 2.5 && rad < 60) get(key(cx, cz)).areas.push({ k: 'island', sport: '', pts: [[cx, cz]], cx, cz, rad, ext: rad * 2, x0: cx - rad, x1: cx + rad, z0: cz - rad, z1: cz + rad });
    }
    this.landmarks = new THREE.Group(); this.landmarks.visible = false; scene.add(this.landmarks);
    for (const r of this.roads) if (r.blue) this.arch(r);
  }

  // ------------------------------------------------------------------ Puente del VII Centenario ("Puente Azul")
  // Two parabolic steel arches (14 m rise, 60 cm tubes, cobalt blue) with 9 pairs of hanger cables, along the deck of the OSM bridge.
  arch(r) {
    const M = new Mesher(), blue = hex(0x0b46b8), P = r.P, n = r.n, hw = r.w / 2 - 0.7, RISE = 14;
    const tube = (a, b, rad, sides) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1, d = [dx / l, dy / l, dz / l];
      const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
      const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const ring = c => { const o = []; for (let k = 0; k < sides; k++) { const t = k / sides * 6.2832, cs = Math.cos(t) * rad, sn = Math.sin(t) * rad; o.push([c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]); } return o; };
      const A = ring(a), B = ring(b); for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; M.quad(A[k], A[k2], B[k2], B[k], blue); }
    };
    // deck centre line (cumulative length) and its normals
    const L = [0]; for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]));
    const tot = L[n - 1], at = t => { const s = t * tot; let i = 1; while (i < n - 1 && L[i] < s) i++; const f = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1), a = i - 1;
      const x = P[2 * a] + (P[2 * i] - P[2 * a]) * f, z = P[2 * a + 1] + (P[2 * i + 1] - P[2 * a + 1]) * f, y = r.Y[a] + (r.Y[i] - r.Y[a]) * f + r.spec[1];
      const tx = P[2 * i] - P[2 * a], tz = P[2 * i + 1] - P[2 * a + 1], tl = Math.hypot(tx, tz) || 1; return { x, y, z, nx: -tz / tl, nz: tx / tl }; };
    for (const sg of [1, -1]) {
      const pts = []; for (let k = 0; k <= 24; k++) { const t = k / 24, c = at(t), h = RISE * (1 - (2 * t - 1) ** 2); pts.push([c.x + c.nx * sg * hw, c.y + 0.9 + h, c.z + c.nz * sg * hw]); }
      for (let k = 0; k < 24; k++) tube(pts[k], pts[k + 1], 0.3, 8);
      for (let k = 1; k <= 9; k++) { const t = k / 10, c = at(t), top = pts[Math.round(t * 24)] ; const tp = [c.x + c.nx * sg * hw, c.y + 0.9 + RISE * (1 - (2 * t - 1) ** 2), c.z + c.nz * sg * hw]; tube([tp[0], c.y + 0.95, tp[2]], tp, 0.045, 4); }
      tube([pts[0][0], pts[0][1] - 0.9, pts[0][2]], pts[0], 0.3, 8); tube([pts[24][0], pts[24][1] - 0.9, pts[24][2]], pts[24], 0.3, 8);
    }
    // cross bracing between the arches near the crown
    for (const t of [0.35, 0.5, 0.65]) { const c = at(t), h = RISE * (1 - (2 * t - 1) ** 2) + 0.9; tube([c.x + c.nx * hw, c.y + h, c.z + c.nz * hw], [c.x - c.nx * hw, c.y + h, c.z - c.nz * hw], 0.18, 6); }
    const mesh = new THREE.Mesh(M.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.landmarks.add(mesh); this.landmarks.userData.at = at(0.5);
  }

  // ------------------------------------------------------------------ bridges
  /** approach ramps: where a deck end sits above the ground just outside it, extend the road outward (4 m steps, <= 12 % / 30 % for footpaths) down to the terrain so there is no ledge */
  rampEnds(r, hf) {
    const sl = (r.drive || r.w > 3) ? 0.12 : 0.3, ext = e => {
      const n = r.n, j = e ? n - 1 : 0, o = e ? n - 2 : 1, dx = r.P[2 * j] - r.P[2 * o], dz = r.P[2 * j + 1] - r.P[2 * o + 1], l = Math.hypot(dx, dz) || 1, out = [];
      let y = r.Y[j]; if (y - hf.height(r.P[2 * j] + dx / l * 4, r.P[2 * j + 1] + dz / l * 4) < 0.2) return out;
      for (let s = 1; s <= 6; s++) { const x = r.P[2 * j] + dx / l * 4 * s, z = r.P[2 * j + 1] + dz / l * 4 * s, g = hf.height(x, z); y -= sl * 4; if (y <= g + 0.05) { out.push([x, z, g]); break; } out.push([x, z, y]); }
      return out;
    };
    const A = [], B = [];
    for (const e of [0, 1]) (e ? B : A).push(...ext(e));
    if (!A.length && !B.length) return;
    const n0 = r.n, n = n0 + A.length + B.length, P = new Float32Array(2 * n), Y = new Float32Array(n), G = new Float32Array(n);
    let q = 0; for (let i = A.length - 1; i >= 0; i--, q++) { P[2 * q] = A[i][0]; P[2 * q + 1] = A[i][1]; Y[q] = A[i][2]; G[q] = hf.height(A[i][0], A[i][1]); }
    for (let i = 0; i < n0; i++, q++) { P[2 * q] = r.P[2 * i]; P[2 * q + 1] = r.P[2 * i + 1]; Y[q] = r.Y[i]; G[q] = r.G[i]; }
    for (const b of B) { P[2 * q] = b[0]; P[2 * q + 1] = b[1]; Y[q] = b[2]; G[q] = hf.height(b[0], b[1]); q++; }
    r.P = P; r.Y = Y; r.G = G; r.n = n; r.ra = A.length; r.rb2 = B.length;
  }

  deck(r, hf) {
    const n = r.n, Y = new Float32Array(n), L = new Float32Array(n); let tot = 0;
    for (let i = 1; i < n; i++) { tot += Math.hypot(r.P[2 * i] - r.P[2 * i - 2], r.P[2 * i + 1] - r.P[2 * i - 1]); L[i] = tot; }
    // each end meets the highest ground in the first 6 m of the approach (banks/levees in front of the abutment) so walkers do not meet a ledge
    const head = (j, k) => { let h = r.G[j]; const dx = r.P[2 * j] - r.P[2 * k], dz = r.P[2 * j + 1] - r.P[2 * k + 1], l = Math.hypot(dx, dz) || 1; for (const d of [3, 6]) h = Math.max(h, hf.height(r.P[2 * j] + dx / l * d, r.P[2 * j + 1] + dz / l * d)); return h; };
    const big = r.drive || r.w > 3, g0 = big ? head(0, 1) : r.G[0], g1 = big ? head(n - 1, n - 2) : r.G[n - 1];   // footpaths keep the exact end height (their approach paths follow the terrain)
    // the deck is the straight line between its two approach heights (a real bridge does not hump over empty air); it only rises where the terrain
    // between the ends pokes above that line (levees, banks), with ramps of <= 8 % that start from the pinned ends
    const kk = big ? 0.12 : 0.3, raise = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = tot ? L[i] / tot : 0; raise[i] = Math.max(0, r.G[i] + 0.1 - (g0 + (g1 - g0) * t)); }
    for (let i = 0; i < n; i++) { let m = 0; for (let j = 1; j < n - 1; j++) if (raise[j] > 0) m = Math.max(m, raise[j] - kk * Math.abs(L[i] - L[j])); Y[i] = g0 + (g1 - g0) * (tot ? L[i] / tot : 0) + Math.min(m, kk * Math.min(L[i], tot - L[i])); }
    r.Y = Y;
  }

  // ------------------------------------------------------------------ queries used by vehicles
  /** drivable surface under (x,z) closest to yRef, or null */
  road(x, z, yRef = 0, m = 0.2, foot = false) {
    const k = Math.floor(x / COL) + ',' + Math.floor(z / COL); let best = null, bd = 1e9;
    for (let pass = 0; pass < (foot ? 2 : 1); pass++) {
      const l = (pass ? this.fgrid : this.grid).get(k); if (!l) continue; const S = pass ? this.fseg : this.seg;
      for (const id of l) {
        const o = id * 7, ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az, len2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - x, pz = az + dz * t - z;
        if (px * px + pz * pz > (S[o + 4] + m) ** 2) continue;
        const y = S[o + 5] + (S[o + 6] - S[o + 5]) * t, dy = yRef == null ? -y : Math.abs(y - yRef);   // yRef null: highest surface wins
        if (dy < bd) { bd = dy; best = { y, dx, dz }; }
      }
    }
    return best;
  }
  /** height of the surface at (x,z): road / bridge deck within 2.2 m of yRef (null = the highest one), otherwise terrain. foot = pedestrians may also use footbridges */
  /** may detected / scattered vegetation grow at (x,z)? Not on buildings, carriageways + their pavement strip, footways, football pitches / track, courts, place paving / ponds, rivers,
   *  nor (c = the cell being meshed) inside its OSM pitch / parking / water polygons. Street trees planted on purpose by streetDetail do not go through here. */
  grow(x, z, g, c) {
    if (this.b?.hit(x, z) || this.road(x, z, g, 2.2) || this.walkway(x, z, 0.8) || FB.on(x, z) || CT.on(x, z) || PA.on(x, z) || this.waterLevel(x, z) > g - 0.3) return false;
    if (c) for (const a of c.areas) if ((a.k === 'pitch' || a.k === 'parking' || a.k === 'water') && x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1 && inPoly(a.pts, x, z)) return false;
    return true;
  }
  /** true when (x,z) lies on / within m metres of the edge of a footway, pedestrian street or path (ground level) */
  walkway(x, z, m = 0.5) {
    const l = this.pgrid.get(Math.floor(x / COL) + ',' + Math.floor(z / COL)); if (!l) return false; const S = this.pseg;
    for (const id of l) { const o = id * 5, ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; const px = ax + dx * t - x, pz = az + dz * t - z; if (px * px + pz * pz <= (S[o + 4] + m) ** 2) return true; }
    return false;
  }
  surf(x, z, yRef, foot = false) {
    if (foot && this.ug?.pit) { const p = this.ug.pit(x, z); if (p && (yRef == null || yRef < p.e.y + 1.5)) return p.y; }   // metro stairwell treads (metro.js)
    const r = this.road(x, z, yRef, 0.2, foot), ry = r && (yRef == null || Math.abs(r.y - yRef) < 2.2) ? r.y : null;
    if (yRef != null && this.ug) { const u = this.ug.floor(x, z, yRef); if (u != null && (ry == null || Math.abs(u - yRef) < Math.abs(ry - yRef))) return u;   // tunnel / car park floor
      if (ry == null && this.ug.under(x, z, yRef)) return yRef; }   // below ground but off the tube floor (a wheel past the wall line): stay level, never jump up to the terrain

    return ry ?? this.hf.height(x, z);
  }
  /** water surface height at (x,z) (river course within its half-width, else open sea / marsh below SEA_LEVEL), or -Infinity on dry land. Compare with a body's feet y. */
  waterLevel(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [rv, i0, i1] of this.cells.get(this.key((cx + a + 0.5) * CELL, (cz + b + 0.5) * CELL))?.rivers || []) {
      const P = rv.P, hw = rv.w / 2 + 0.5;
      for (let i = i0; i < i1; i++) { const ax = P[2 * i], az = P[2 * i + 1], dx = P[2 * i + 2] - ax, dz = P[2 * i + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < hw) return Math.max(rv.Wy[i], 0.35) + 0.04; }
    }
    return this.hf.height(x, z) < 0.25 ? 0.25 : -Infinity;
  }
  nearestRoad(x, z, maxD = 3000) {
    const S = this.seg; let best = null, bd = maxD * maxD;
    for (let o = 0; o < S.length; o += 7) {
      const px = (S[o] + S[o + 2]) / 2 - x, pz = (S[o + 1] + S[o + 3]) / 2 - z, d = px * px + pz * pz;
      if (d < bd && S[o + 4] >= 2.2) { bd = d; best = { x: (S[o] + S[o + 2]) / 2, z: (S[o + 1] + S[o + 3]) / 2, y: (S[o + 5] + S[o + 6]) / 2, psi: Math.atan2(-(S[o + 2] - S[o]), -(S[o + 3] - S[o + 1])) }; }
    }
    return best;
  }

  // ------------------------------------------------------------------ streaming
  update(cam, budgetMs = 4) {
    const { x, z } = cam, R = Math.max(this.settings.roadR, this.settings.treeR);
    const moved = Math.hypot(x - this.last.x, z - this.last.z) > 20;
    if (moved || this.dirty) {
      const mvx = x - this.last.x, mvz = z - this.last.z, ml = Math.hypot(mvx, mvz) || 1, ax = x + (this.dirty ? 0 : mvx / ml) * R * 0.4, az = z + (this.dirty ? 0 : mvz / ml) * R * 0.4;   // prefetch: also build cells ahead along the heading
      this.last = { x, z }; this.dirty = false;
      const c0 = Math.floor((Math.min(x, ax) - R) / CELL), c1 = Math.floor((Math.max(x, ax) + R) / CELL), d0 = Math.floor((Math.min(z, az) - R) / CELL), d1 = Math.floor((Math.max(z, az) + R) / CELL);
      this.queue.length = 0;
      for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
        const k = cx + ',' + cz, mx = (cx + 0.5) * CELL, mz = (cz + 0.5) * CELL, d = Math.hypot(mx - x, mz - z) - CELL * 0.7;
        const c = this.cells.get(k), dA = Math.hypot(mx - ax, mz - az) - CELL * 0.7; if (!c || (d > R && dA > R) || this.active.has(k)) continue;
        this.queue.push({ k, d, c });
      }
      this.queue.sort((a, b) => b.d - a.d);
      for (const [k, a] of this.active) {       // drop far cells
        const [cx, cz] = k.split(',').map(Number);
        if (Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z) > R * 2.2 + CELL) { this.free(a); this.active.delete(k); }
      }
    }
    // cells are meshed by a resumable generator: a few ms per frame, never a whole cell in one go (a busy cell used to block for up to ~900 ms)
    const t0 = performance.now(), st = this.stats; this.deadline = t0 + budgetMs;
    while (budgetMs > 0 && (this.job || this.queue.length)) {
      if (!this.job) { const q = this.queue.pop(); if (this.active.has(q.k)) continue; this.job = { k: q.k, it: this.build(q.k, q.c), ms: 0 }; }
      const tb = performance.now(), r = this.job.it.next(), db = performance.now() - tb;
      this.job.ms += db; st.buildMs = (st.buildMs || 0) + db; st.maxBuild = Math.max(st.maxBuild || 0, db);   // maxBuild = longest single slice (= the hitch the player feels)
      if (r.done) { const old = this.active.get(this.job.k); if (old) this.free(old); this.active.set(this.job.k, r.value); st.builds = (st.builds || 0) + 1; st.maxCell = Math.max(st.maxCell || 0, this.job.ms); this.job = null; }
      if (performance.now() >= this.deadline) break;
    }
    // per-frame visibility by distance (cheap): roads/areas within roadR, trees within treeR, cars within carR
    for (const [k, a] of this.active) {
      const d = Math.hypot(a.cx - x, a.cz - z) - CELL * 0.5;
      a.road && (a.road.visible = d < this.settings.roadR);
      a.trees && (a.trees.visible = d < this.settings.treeR);
      a.cars && (a.cars.visible = d < this.settings.carR);
      a.walls && (a.walls.visible = d < (this.settings.wallR ?? 600));
    }
    const lm = this.landmarks.userData.at; if (lm) this.landmarks.visible = Math.hypot(lm.x - x, lm.z - z) < 1600;
    this.stats.cells = this.active.size; this.stats.queued = this.queue.length;
  }
  free(a) { this.col.remove(a.k); for (const o of a.objs) { this.scene.remove(o); o.geometry?.dispose(); o.dispose?.(); } }

  // ------------------------------------------------------------------ cell meshing
  /** land class at (x,z) from landclass.bin, 255 when unknown */
  lc(x, z) { const L = this.land; if (!L) return 255; const i = Math.floor((x - L.x0) / L.c8), j = Math.floor((z - L.z0) / L.c8); return i < 0 || j < 0 || i >= L.cols || j >= L.rows ? 255 : L.d[j * L.cols + i]; }
  /** generator: yields whenever the frame budget (this.deadline) is spent; returns the finished cell record */
  *build(k, c) {
    const [cx, cz] = k.split(',').map(Number), hf = this.hf, late = () => performance.now() >= this.deadline;
    const roadM = { t: [new Mesher(), new Mesher(), new Mesher()], mk: new Mesher() }, areaM = new Mesher(), waterM = new Mesher(), trees = [], cars = [], objs = [];
    for (const [r, i0, i1] of c.runs) for (let a = i0; a < i1 || a === i0; a += 16) { this.ribbon(r, a, Math.min(i1, a + 16), roadM, trees, cars); if (late()) yield; }   // long runs in slices of 16 points
    for (const a of c.areas) { this.area(a, areaM, waterM, trees, cars); if (late()) yield; }
    for (const [rv, i0, i1] of c.rivers) this.river(rv, i0, i1, waterM, areaM);
    if (late()) yield;
    for (const [x, z] of c.trees) if (!this.b?.hit(x, z)) trees.push([x, hf.height(x, z), z, 1.1, pickSp(this.lc(x, z), hash2(~~(x * 5), ~~(z * 5)))]);
    // detected trees (orthophoto): thin by hash to a budget, keep off roads and buildings
    const vt = this.veg.trees.get(k);
    if (vt && this.veg.pack) {
      const pk = this.veg.pack, CAP = this.settings.treeCap || 1800, n = Math.min(vt.count, CAP), s = pk.cell / 65536, x0 = vt.cx * pk.cell, z0 = vt.cz * pk.cell;
      for (let q = 0; q < n; q++) {
        if ((q & 63) === 63 && late()) yield;
        const j = vt.start + q, x = x0 + pk.xz[j * 2] * s, z = z0 + pk.xz[j * 2 + 1] * s, rad = pk.rad[j] / 16, g = hf.height(x, z);
        if (g < 0.4 || !this.grow(x, z, g, c)) continue;
        trees.push([x, g, z, Math.min(1.6, Math.max(0.55, rad / 2.4)), pickSp(this.lc(x, z), hash2(~~(x * 5), ~~(z * 5)))]);
      }
    } else if (vt) {
      const T = this.veg.T, CAP = this.settings.treeCap || 1800, step = Math.max(1, vt.length / CAP);
      for (let f = 0, q = 0; f < vt.length; f += step) {
        if ((++q & 63) === 0 && late()) yield;
        const i = vt[Math.floor(f)], x = T[i], z = T[i + 1], rad = T[i + 2], g = hf.height(x, z);
        if (g < 0.4 || !this.grow(x, z, g, c)) continue;
        trees.push([x, g, z, Math.min(1.6, Math.max(0.55, rad / 2.4)), pickSp(this.lc(x, z), hash2(~~(x * 5), ~~(z * 5)))]);
      }
    }
    // understory / scrub: shrubs, retama, agaves, chumberas scattered by land class (scrub 1, pinar 2, sand 4), on an 8 m jittered grid
    if (this.land) {
      const x0 = cx * CELL, z0 = cz * CELL; let ns = 0;
      for (let j = 0; j < CELL / 8 && ns < 900; j++) for (let i = 0; i < CELL / 8; i++) {
        if (((i + 1) & 31) === 0 && late()) yield;
        const h = hash2(cx * 64 + i * 7 + 3, cz * 64 + j * 11 + 5), x = x0 + (i + hash2(i + cx * 977, j + 3)) * 8, z = z0 + (j + hash2(j + cz * 911, i + 7)) * 8, cls = this.lc(x, z);
        const dens = cls === 1 ? 0.3 : cls === 2 ? 0.14 : cls === 4 ? 0.03 : cls === 5 ? 0.08 : cls === 0 ? 0.04 : 0; if (h >= dens) continue;   // cheap instanced scrub, also on open land (0) and green urban plots (5). The `continue` must stay outside this comment: without it every 8 m grid point grew a giant shrub
        const g = hf.height(x, z); if (g < 0.5 || !this.grow(x, z, g, c)) continue;
        const u = h / dens, sp = cls === 4 ? (u < 0.6 ? SP.RET : u < 0.8 ? SP.AGA : SP.OPU) : cls === 2 ? (u < 0.8 ? SP.SHR : SP.RET) : u < 0.4 ? SP.SHR : u < 0.6 ? SP.RET : u < 0.75 ? SP.OLE : u < 0.9 ? SP.AGA : SP.OPU;
        trees.push([x, g, z, 0.7 + u * 0.8, sp]); ns++;
      }
    }
    const vg = this.veg.grass.get(k);
    if (vg) {   // lawns: 4 m cells draped on the terrain
      const G = vg, gc = hex(0x6f9a4e);
      for (let i = 0; i < G.length; i += 2) {
        if ((i & 126) === 0 && late()) yield;
        const x = G[i], z = G[i + 1], cxm = x + 2, czm = z + 2;
        if (this.b?.hit(cxm, czm) || this.road(cxm, czm, hf.height(cxm, czm))) continue;
        const hh = hash2(x * 0.25 | 0, z * 0.25 | 0), v = 0.88 + hh * 0.2, col = [gc[0] * v, gc[1] * v, gc[2] * v], y = 0.12;
        const a = [x, hf.height(x, z) + y, z], b = [x + 4, hf.height(x + 4, z) + y, z], c = [x + 4, hf.height(x + 4, z + 4) + y, z + 4], d = [x, hf.height(x, z + 4) + y, z + 4];
        if (a[1] < 0.35) continue; areaM.quad(a, b, c, d, col);
      }
    }
    // swimming pools: real-shape polygon (convex, <= 8 vertices, from the PNOA z19 detector) with a pale coping ring; water tinted by the sampled ortho colour
    const vp = this.veg.pools.get(k);
    if (vp) for (const i of vp) {
      const P = this.veg.Pl[i], n = P.pts.length >> 1; if (this.b?.hit(P.x, P.z)) continue;
      let hy = 0; for (let j = 0; j < n; j++) hy = Math.max(hy, hf.height(P.pts[2 * j], P.pts[2 * j + 1]));
      if (hy < 0.5) continue;
      let sg = 0; for (let j = 0; j < n; j++) { const a = P.pts[2 * j], b = P.pts[2 * j + 1], c = P.pts[2 * ((j + 1) % n)], d = P.pts[2 * ((j + 1) % n) + 1]; sg += a * d - c * b; }
      const rim = (r, y, col) => { const q = []; for (let j = 0; j < n; j++) { const dx = P.pts[2 * j] - P.x, dz = P.pts[2 * j + 1] - P.z, l = Math.hypot(dx, dz) || 1; q.push([P.pts[2 * j] + dx / l * r, y, P.pts[2 * j + 1] + dz / l * r]); } if (sg < 0) q.reverse(); const c = [P.x, y, P.z]; for (let j = 0; j < n; j++) areaM.tri(c, q[j], q[(j + 1) % n], col); };
      const w = [0.5 * P.rgb[0] + 0.05, 0.5 * P.rgb[1] + 0.35, 0.5 * P.rgb[2] + 0.4];
      rim(0.5, hy + 0.2, [0.84, 0.82, 0.76]); rim(0, hy + 0.26, [Math.min(1, w[0] * 1.05), Math.min(1, w[1] * 1.05), Math.min(1, w[2] * 1.05)]);
    }
    // rural parcel walls (stone, draped, ~1 m)
    const wallSolid = []; let wallM = null; const vw = this.veg.walls.get(k);
    if (vw) {
      wallM = new Mesher(); const W = this.veg.W, col = [0.78, 0.74, 0.66], top = [0.9, 0.87, 0.8];
      let wq = 0; for (const i of vw) {
        if ((++wq & 15) === 0 && late()) yield;
        const x1 = W[i], z1 = W[i + 1], x2 = W[i + 2], z2 = W[i + 3], len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.ceil(len / 6)), tx = (x2 - x1) / len, tz = (z2 - z1) / len, nx = -tz * 0.15, nz = tx * 0.15;
        for (let s = 0; s < n; s++) {
          const ax = x1 + (x2 - x1) * s / n, az = z1 + (z2 - z1) * s / n, bx = x1 + (x2 - x1) * (s + 1) / n, bz = z1 + (z2 - z1) * (s + 1) / n, mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const ya = hf.height(ax, az), yb = hf.height(bx, bz), ym = hf.height(mx, mz); if (this.keep?.(mx, mz, 1.5) || this.keep?.(ax, az, 1) || this.keep?.(bx, bz, 1) || Math.min(ya, yb, ym) < 0.5 || this.b?.hit(mx, mz) || this.b?.hit(ax, az) || this.b?.hit(bx, bz) || this.road(mx, mz, ym, 2.2) || this.road(ax, az, ya, 1.2) || this.road(bx, bz, yb, 1.2) || this.walkway(mx, mz, 1) || this.walkway(ax, az, 0.6) || this.walkway(bx, bz, 0.6)) continue;
          if (hash2(Math.round(mx * 2), Math.round(mz * 2)) < 0.3) trees.push([mx + nx * 6, hf.height(mx, mz), mz + nz * 6, 1.0 + hash2(~~mz, ~~mx) * 0.5, hash2(~~mx, ~~mz) < 0.25 ? SP.OLE : SP.SHR]);   // hedge / bush beside the wall
          const h = 1.3; wallSolid.push([ax, az, bx, bz, 0.25, ya, yb, h]);
           const yo = Math.min(ya, yb, ym) - 0.35; for (const q of [-1, 1]) { const ox = nx * q, oz = nz * q; wallM.quad([ax + ox, yo, az + oz], [bx + ox, yo, bz + oz], [bx + ox, yb + h, bz + oz], [ax + ox, ya + h, az + oz], col); wallM.quad([ax + ox * 1.4, yo, az + oz * 1.4], [bx + ox * 1.4, yo, bz + oz * 1.4], [bx + ox * 1.4, yb + 0.35, bz + oz * 1.4], [ax + ox * 1.4, ya + 0.35, az + oz * 1.4], [0.5, 0.46, 0.4]); }   // two faces (real thickness) + dark plinth: reads as a wall, not a sheet
          wallM.quad([ax - nx * 1.5, ya + h, az - nz * 1.5], [bx - nx * 1.5, yb + h, bz - nz * 1.5], [bx + nx * 1.5, yb + h, bz + nz * 1.5], [ax + nx * 1.5, ya + h, az + nz * 1.5], top);
        }
      }
      if (!wallM.count) wallM = null;
    }
    if (late()) yield;
    let treeSolid = [];
    const res = { k, cx: (cx + 0.5) * CELL, cz: (cz + 0.5) * CELL, objs };
    if (wallM) { const m = new THREE.Mesh(wallM.geometry(), this.mats.wall); m.name = 'cell-walls'; this.scene.add(m); res.walls = m; objs.push(m); }
    const roadN = roadM.t[0].count + roadM.t[1].count + roadM.t[2].count + roadM.mk.count;
    if (roadN || areaM.count || waterM.count) {
      const grp = new THREE.Group();
      if (areaM.count) { const m = new THREE.Mesh(areaM.geometry(), this.mats.area); m.frustumCulled = true; grp.add(m); objs.push(m); }
      for (let q = 0; q < 4; q++) { const Q = q < 3 ? roadM.t[q] : roadM.mk; if (!Q.count) continue; const m = new THREE.Mesh(Q.geometry(), this.mats.roadT[q]); m.renderOrder = 2 + q; grp.add(m); objs.push(m); }
      if (waterM.count) { const m = new THREE.Mesh(waterM.geometry(), this.waterMat); m.renderOrder = 9; grp.add(m); objs.push(m); }
      grp.name = 'cell-road'; this.scene.add(grp); res.road = grp; objs.push(grp); if (late()) yield;
      grp.dispose = () => {}; grp.geometry = null;
    }
    // last gate for EVERY tree of the cell (street trees, OSM trees, park fill, scrub): nothing on the tram corridor, on any carriageway (a pavement tree of one street
    // used to land on the next street / a roundabout lane), on footways, pitches, tracks, courts or place paving, inside a building
    // (the companion shrubs of park / wood trees are offset without a test of their own) or in water
    { let n = 0; for (const t of trees) { const [x, y, z] = t; if (this.keep?.(x, z, 1.0) || this.b?.hit(x, z) || this.waterLevel(x, z) > y - 0.3 || this.road(x, z, y, 0.3) || this.walkway(x, z, 0.2) || FB.on(x, z) || CT.on(x, z) || PA.on(x, z)) continue; trees[n++] = t; } trees.length = n; }
    if (trees.length) {
      const n = Math.min(trees.length, this.settings.treeMax ?? 3200), M = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const by = new Map(); for (let i = 0; i < n; i++) { const sp = trees[i][4] | 0; let l = by.get(sp); if (!l) by.set(sp, l = []); l.push(trees[i]); }
      const tg = new THREE.Group(); tg.name = 'cell-trees'; treeSolid = [];
      for (const [sp, list] of by) {   // one InstancedMesh per species present in this cell
        const im = new THREE.InstancedMesh(sp ? this.vegG[sp] : this.treeGeo, this.mats.tree, list.length);
        for (let i = 0; i < list.length; i++) {
          const [x, y, z, s] = list[i], h = hash2(Math.round(x * 3), Math.round(z * 3)), h2 = hash2(~~(x * 7), ~~(z * 7)), sc = (0.7 + h * 0.7) * s;
          if (!sp) { e.set(0, h * 6.28, 0); col.setHSL(0.27 + (h - 0.5) * 0.09, 0.4 + h * 0.2, 0.78 + (h2 - 0.5) * 0.3); }
          else { e.set((h - 0.5) * 0.12, h * 6.28, (h2 - 0.5) * 0.12); const v = 0.82 + h2 * 0.26; col.setRGB(v * (0.94 + h * 0.1), v, v * (0.94 + (1 - h) * 0.1)); }   // slight lean + tint per tree
          q.setFromEuler(e); _tp.set(x, y, z); _ts.set(sc, sc * (0.9 + hash2(~~z, ~~x) * 0.3), sc); M.compose(_tp, q, _ts);
          im.setMatrixAt(i, M); im.setColorAt(i, col);
          if (sp < SP.SHR && s >= 0.6) { const t = [x, z, sp ? 0.22 + 0.1 * s : 0.28 + 0.12 * s]; t.im = im; t.i = i; t.str = 4000 * sc * sc; treeSolid.push(t); }   // im/i/str: breakable (collide.js tryBreak, ragdoll.js); a rebuilt cell gets fresh, unbroken trees
        }
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.name = 'cell-trees'; tg.add(im);
      }
      tg.dispose = () => { for (const m of tg.children) m.dispose(); };
      this.scene.add(tg); res.trees = tg; objs.push(tg); this.stats.trees += n;
    }
    if (cars.length) {
      const n = Math.min(cars.length, 700), im = new THREE.InstancedMesh(this.carGeo, this.carMat, n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      const PAL = [0xf2f2f0, 0xd9d9d9, 0x8a8f96, 0x2a2d31, 0xb5251c, 0x1f4f8f, 0xe8d9a8, 0x3f5b45, 0x6b6e73];
      for (let i = 0; i < n; i++) {
        const [x, y, z, psi] = cars[i]; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi);
        _tp.set(x, y, z); _ts.set(1, 1, 1); M.compose(_tp, q, _ts); im.setMatrixAt(i, M);
        col.setHex(PAL[Math.floor(hash2(~~(x * 5), ~~(z * 5)) * PAL.length) % PAL.length]); im.setColorAt(i, col);
      }
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = 'cell-cars'; this.scene.add(im); res.cars = im; objs.push(im); this.stats.cars += n;
    }
    if (wallSolid.length || treeSolid.length) this.col.add(k, wallSolid, treeSolid);
    for (const o of objs) if (o.isObject3D) { o.matrixAutoUpdate = false; o.updateMatrix(); }   // static cell content: skip per-frame matrix recompute
    return res;
  }

  /** sidewalk flags per side: true where buildings face the street */
  sidewalks(r) {
    if (r.sw) return r.sw;
    const n = r.n, f = [new Uint8Array(n), new Uint8Array(n)], P = r.P;
    if (this.b && r.spec[2] > 0 && !r.bridge && r.swTag < 0) {
      for (let i = 0; i < n; i++) {
        const j = Math.min(n - 1, i + 1), h = Math.max(0, i - 1), tx = P[2 * j] - P[2 * h], tz = P[2 * j + 1] - P[2 * h + 1], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
        for (let s = 0; s < 2; s++) {
          const sg = s ? -1 : 1;
          for (const off of [r.w / 2 + 4, r.w / 2 + 9, r.w / 2 + 16]) if (this.b.hit(P[2 * i] + nx * sg * off, P[2 * i + 1] + nz * sg * off)) { f[s][i] = 1; break; }
        }
      }
      for (let s = 0; s < 2; s++) {   // dilate (close gaps between plots) then erode a little
        const src = f[s].slice(), R = 4;
        for (let i = 0; i < n; i++) if (src[i]) for (let d = -R; d <= R; d++) { const j = i + d; if (j >= 0 && j < n) f[s][j] = 1; }
      }
    }
    if (r.swTag >= 0 && !r.bridge) {   // explicit OSM sidewalk tags override the geometric guess (right of travel = side 0)
      for (let i = 0; i < n; i++) { f[0][i] = r.swTag & 2 ? 1 : 0; f[1][i] = r.swTag & 1 ? 1 : 0; }
    }
    if (this.keep && !r.bridge) for (let i = 0; i < n; i++) { const j = Math.min(n - 1, i + 1), h = Math.max(0, i - 1), tx = P[2 * j] - P[2 * h], tz = P[2 * j + 1] - P[2 * h + 1], l = Math.hypot(tx, tz) || 1; for (let q = 0; q < 2; q++) { const sg = q ? -1 : 1; if (f[q][i] && this.keep(P[2 * i] - tz / l * sg * (r.w / 2 + 1.2), P[2 * i + 1] + tx / l * sg * (r.w / 2 + 1.2))) f[q][i] = 0; } }   // no pavement on the tram corridor
    return (r.sw = f);
  }

  /** does road r's endpoint e coincide with an endpoint/vertex of another drivable road? (lazy index, 3 m grid) */
  joined(r, e) {
    if (!this._nodes) { const m = this._nodes = new Map(); for (const q of this.roads) { if (!q.drive) continue; for (let i = 0; i < q.n; i++) { const k = Math.round(q.P[2 * i] / 3) + ',' + Math.round(q.P[2 * i + 1] / 3); let l = m.get(k); if (!l) m.set(k, l = new Set()); l.add(q); } } }
    const x = r.P[2 * e], z = r.P[2 * e + 1];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = this._nodes.get((Math.round(x / 3) + a) + ',' + (Math.round(z / 3) + b)); if (l) for (const q of l) if (q !== r) return true; }
    return false;
  }
  /** street furniture per ribbon segment: boundary walls where houses face the road, hedges, lamp posts, zebra crossings, arrows */
  streetDetail(r, p, c, flags, swW, M, MK, trees) {
    const hf = this.hf, hw = r.w / 2, i = c.i, n = r.n, mkc = hex(0xe9e7dc), dark = hex(0x3a3d42), wallC = hex(0xe9e4d6), wallT = hex(0xb5573b), plinthC = hex(0x8a7f6d);
    const box = (x, z, w, h, col, y0) => { const a = w / 2, y = (y0 ?? hf.height(x, z)) - 0.05;
      M.quad([x - a, y, z - a], [x + a, y, z - a], [x + a, y + h, z - a], [x - a, y + h, z - a], col); M.quad([x + a, y, z - a], [x + a, y, z + a], [x + a, y + h, z + a], [x + a, y + h, z - a], col);
      M.quad([x + a, y, z + a], [x - a, y, z + a], [x - a, y + h, z + a], [x + a, y + h, z + a], col); M.quad([x - a, y, z + a], [x - a, y, z - a], [x - a, y + h, z - a], [x - a, y + h, z + a], col); };
    for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, sw = flags && flags[s][i] && flags[s][p.i], d = hw + (sw ? swW : 0) + 0.7;
      // lamp posts every ~32 m on the pavement edge (alternating sides)
      if (sw && i % 8 === (s ? 4 : 0) && r.tier >= 1) { const lx = c.x + c.nx * sg * (hw + 0.35), lz = c.z + c.nz * sg * (hw + 0.35), gy = c.ygc + 0.3; if (!this.keep?.(lx, lz, 1) && !this.b?.hit(lx, lz) && !this.road(lx, lz, gy) && hf.height(lx, lz) > 0.5) { box(lx, lz, 0.14, 5.2, dark, gy); box(lx - c.nx * sg * 0.5, lz - c.nz * sg * 0.5, 0.35, 0.18, hex(0xfff2c0), gy + 5.2); } }
      // boundary wall: where a building stands within ~25 m behind this side of the road
      let near = false; for (const o of [d + 4, d + 10, d + 18, d + 26]) if (this.b?.hit(c.x + c.nx * sg * o, c.z + c.nz * sg * o)) { near = true; break; }
      if (!near || sw && r.tier >= 1 && this.b?.hit(c.x + c.nx * sg * (d + 1.5), c.z + c.nz * sg * (d + 1.5))) continue;
      if (hash2(Math.round(c.x / 12) + s, Math.round(c.z / 12)) < 0.13) continue;                   // gaps = gates / driveways
      const ax = p.x + p.nx * sg * d, az = p.z + p.nz * sg * d, bx = c.x + c.nx * sg * d, bz = c.z + c.nz * sg * d, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (this.b?.hit(mx, mz) || this.road(mx, mz, hf.height(mx, mz)) || this.road(bx, bz, hf.height(bx, bz))) continue;
      if (this.keep?.(mx, mz, 1.5) || this.keep?.(ax, az, 1) || this.keep?.(bx, bz, 1)) continue;
      const ya = hf.height(ax, az), yb = hf.height(bx, bz); if (Math.min(ya, yb) < 0.5) continue;
      const H = 1.5, t = 0.15, ux = c.nx * sg * t, uz = c.nz * sg * t;
      for (const q of [-1, 1]) { const ox = ux * q, oz = uz * q; M.quad([ax + ox, ya - 0.1, az + oz], [bx + ox, yb - 0.1, bz + oz], [bx + ox, yb + H, bz + oz], [ax + ox, ya + H, az + oz], wallC); M.quad([ax + ox * 1.4, ya - 0.1, az + oz * 1.4], [bx + ox * 1.4, yb - 0.1, bz + oz * 1.4], [bx + ox * 1.4, yb + 0.4, bz + oz * 1.4], [ax + ox * 1.4, ya + 0.4, az + oz * 1.4], plinthC); }   // thickness + plinth
      M.quad([ax - ux * 1.5, ya + H, az - uz * 1.5], [bx - ux * 1.5, yb + H, bz - uz * 1.5], [bx + ux * 1.5, yb + H, bz + uz * 1.5], [ax + ux * 1.5, ya + H, az + uz * 1.5], wallT);
      const hh = hash2(Math.round(mx * 2), Math.round(mz * 2));
      if (hh < 0.3) trees.push([mx + c.nx * sg * 1.0, hf.height(mx, mz), mz + c.nz * sg * 1.0, 0.8 + hh * 1.5, hh < 0.08 ? SP.OLE : SP.SHR]);   // hedge / bush by the wall
    }
    // zebra crossing ~12 m from each true end of the road (junction approach), urban two-way streets
    const zEnd = i === 3 ? 0 : i === n - 4 ? n - 1 : -1;   // only where that end of the road joins another road (not dead ends / cul-de-sacs)
    const zb = r.w >= 5.2 && r.w <= 14 && r.tier >= 1 && !r.ow && flags && zEnd >= 0 && n >= 8 && this.joined(r, zEnd) && !this.b?.hit(c.x, c.z);
    if (zb) for (let k = -4; k <= 4; k++) { const o = k * 0.9, wd = 0.28, L = 1.6, mkY = 0.05;
      if (Math.abs(o) > hw - 0.7) continue;
      MK.quad([c.x + c.nx * (o + wd) - c.tx * L, c.yb + mkY, c.z + c.nz * (o + wd) - c.tz * L], [c.x + c.nx * (o + wd) + c.tx * L, c.yb + mkY, c.z + c.nz * (o + wd) + c.tz * L],
        [c.x + c.nx * (o - wd) + c.tx * L, c.yb + mkY, c.z + c.nz * (o - wd) + c.tz * L], [c.x + c.nx * (o - wd) - c.tx * L, c.yb + mkY, c.z + c.nz * (o - wd) - c.tz * L], mkc); }
    // direction arrows on one-way streets
    if (r.ow && r.w >= 5.2 && i % 12 === 6) { const mkY = 0.05, A = [c.x + c.tx * 1.6, c.yb + mkY, c.z + c.tz * 1.6], B = [c.x - c.tx * 1.0 + c.nx * 0.7, c.yb + mkY, c.z - c.tz * 1.0 + c.nz * 0.7], C = [c.x - c.tx * 1.0 - c.nx * 0.7, c.yb + mkY, c.z - c.tz * 1.0 - c.nz * 0.7]; MK.tri(A, B, C, mkc); }
  }

  ribbon(r, i0, i1, RM, trees, cars) {
    const M = RM.t[r.tier], MK = RM.mk;
    const hf = this.hf, P = r.P, w = r.w, hw = w / 2, [colHex, bias, swW0] = r.spec, swW = swW0 || (r.swTag > 0 ? 1.8 : 0), col = r.plaza ? hex(0xb4b1aa) : r.bridge && !r.drive ? hex(0x86694a) : hex(colHex), hy = bias;   // footbridge deck: timber planks
    const a0 = i0, a1 = i1;
    const nrm = i => { const j = Math.min(r.n - 1, i + 1), h = Math.max(0, i - 1), tx = P[2 * j] - P[2 * h], tz = P[2 * j + 1] - P[2 * h + 1], l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l, tx / l, tz / l]; };
    const flags = swW ? this.sidewalks(r) : null;
    const walk = [0.72, 0.7, 0.66].map((v, i) => Math.pow([0.72, 0.7, 0.66][i], 2.2));
    const curb = hex(0x9a968e), outer = hex(0x7e7a73), mark = hex(0xe9e7dc), edge = hex(0xd8d6cc), conc = hex(0xb9b6ae), under = hex(0x55534f);
    const grounded = !r.bridge, pcol = r.blue ? hex(0x0b46b8) : conc;
    let prev = null;
    for (let i = a0; i <= a1; i++) {
      const [nx, nz, tx, tz] = nrm(i), x = P[2 * i], z = P[2 * i + 1];
      const lx = x + nx * hw, lz = z + nz * hw, rx = x - nx * hw, rz = z - nz * hw;
      const yb = r.Y[i] + hy;
      const yl = grounded ? hf.height(lx, lz) + hy : yb, yr = grounded ? hf.height(rx, rz) + hy : yb;
      const cur = { x, z, yb, L: [lx, yl, lz], R: [rx, yr, rz], nx, nz, tx, tz, i, ygc: r.G[i] };
      if (prev && i > a0 - 1) {
        const p = prev;
        if (grounded && p.L[1] < 0.2 && p.R[1] < 0.2 && cur.L[1] < 0.2 && cur.R[1] < 0.2) { prev = cur; continue; }   // never draw roads over the sea
        M.quad(p.L, cur.L, cur.R, p.R, col);
        if (r.drive && !r.u && !r.rb || r.rb) {
          const nl = Math.max(1, r.lanes || Math.round(w / 3.2)), mkY = 0.045;
          const strip = (o, hwid, dash, colr) => { if (dash && i % 3 === 2) return; MK.quad([p.x + p.nx * (o + hwid), p.yb + mkY, p.z + p.nz * (o + hwid)], [cur.x + cur.nx * (o + hwid), cur.yb + mkY, cur.z + cur.nz * (o + hwid)], [cur.x + cur.nx * (o - hwid), cur.yb + mkY, cur.z + cur.nz * (o - hwid)], [p.x + p.nx * (o - hwid), p.yb + mkY, p.z + p.nz * (o - hwid)], colr); };
          const paved = w >= 5.2 && r.cls !== 'service' && r.cls !== 'living_street' && (r.drive || !r.bridge);
          if (paved) {
            if (r.tier >= 1 && nl <= 4) { const wt = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.82]; for (let k = 0; k < nl; k++) for (const sg of [1, -1]) strip(-hw + w * (k + 0.5) / nl + sg * 0.8, 0.17, false, wt); }   // darker tyre-wear tracks in every lane
            if (r.ow) { for (let k = 1; k < nl; k++) strip(-hw + (w * k) / nl, 0.07, true, mark); }                 // one-way: dashed lane dividers
            else if (nl >= 4) { strip(0.14, 0.06, false, mark); strip(-0.14, 0.06, false, mark); for (let k = 1; k < nl / 2; k++) for (const sg of [1, -1]) strip(sg * (hw * k) / (nl / 2), 0.07, true, mark); }   // dual carriageway road: double centre + lane lines
            else if (nl >= 2) strip(0, 0.07, true, mark);                                                         // two-way: dashed centre
            if (w >= 6.4 && r.cls !== 'residential' || r.ow && w >= 6.4) for (const sg of [1, -1]) strip(sg * (hw - 0.4), 0.06, false, edge);   // edge lines
          }
        }
        if (r.bridge) {   // parapets, side beams, underside
          const rail = (P0, P1, o0, o1, y0, y1, t, colr) => { const A = (Q, o, y, k) => [Q[0] + o[0] * t * k, y, Q[2] + o[1] * t * k];
            M.quad(A(P0, o0, y0, 1), A(P1, o1, y0, 1), A(P1, o1, y1, 1), A(P0, o0, y1, 1), colr); M.quad(A(P1, o1, y0, -1), A(P0, o0, y0, -1), A(P0, o0, y1, -1), A(P1, o1, y1, -1), colr);
            M.quad(A(P0, o0, y1, 1), A(P1, o1, y1, 1), A(P1, o1, y1, -1), A(P0, o0, y1, -1), colr); };
          const post = (x, z, y0, y1, t, colr) => { const c4 = [[x + t, z + t], [x - t, z + t], [x - t, z - t], [x + t, z - t]]; for (let q = 0; q < 4; q++) { const A = c4[q], B = c4[(q + 1) % 4]; M.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], colr); } M.quad([c4[0][0], y1, c4[0][1]], [c4[1][0], y1, c4[1][1]], [c4[2][0], y1, c4[2][1]], [c4[3][0], y1, c4[3][1]], colr); };
          const steel = hex(0x2d3a40), light = hex(0xfff0c0);
          if (r.plaza) for (const sg of [1, -1]) {   // plaza deck: glass balustrade on steel posts, steel handrail, white concrete edge slab
            const P0 = sg > 0 ? p.L : p.R, P1 = sg > 0 ? cur.L : cur.R, o0 = [p.nx * sg, p.nz * sg], o1 = [cur.nx * sg, cur.nz * sg];
            rail(P0, P1, o0, o1, P0[1] + 1.0, P1[1] + 1.06, 0.05, steel); rail(P0, P1, o0, o1, P0[1] + 0.1, P1[1] + 0.98, 0.012, hex(0xa9c4c8)); rail(P0, P1, o0, o1, P0[1] - 1.4, P1[1] + 0.1, 0.12, hex(0xe8e6df));
            post(P1[0], P1[2], P1[1], P1[1] + 1.06, 0.04, steel);
          }
          else if (!r.drive) for (const sg of [1, -1]) {   // footbridge: open steel railing (handrail, mid rail, kick plate, balusters), side beam and a lamp post
            const P0 = sg > 0 ? p.L : p.R, P1 = sg > 0 ? cur.L : cur.R, o0 = [p.nx * sg, p.nz * sg], o1 = [cur.nx * sg, cur.nz * sg];
            rail(P0, P1, o0, o1, P0[1] + 1.02, P1[1] + 1.1, 0.06, steel); rail(P0, P1, o0, o1, P0[1] + 0.5, P1[1] + 0.56, 0.025, steel); rail(P0, P1, o0, o1, P0[1] - 0.45, P1[1] + 0.14, 0.09, conc);
            if (i % 2 === 0) post(P1[0], P1[2], P1[1], P1[1] + 1.1, 0.035, steel);
            if (i % 5 === (sg > 0 ? 1 : 3)) { post(P1[0], P1[2], P1[1], P1[1] + 3.4, 0.05, steel); post(P1[0] - o1[0] * 0.15, P1[2] - o1[1] * 0.15, P1[1] + 3.4, P1[1] + 3.65, 0.13, light); }
          }
          if (r.walks && p) for (const sg of [1, -1]) {   // raised pavement strips (1.8 m) along both parapets, kerb face on the carriageway side
            const q = (c, o, dy) => [c.x + c.nx * o * sg, c.yb + dy, c.z + c.nz * o * sg], a = hw - 1.9, b = hw - 0.05, pav = hex(0xcfcac0);
            M.quad(q(p, a, 0.14), q(cur, a, 0.14), q(cur, b, 0.14), q(p, b, 0.14), pav);
            M.quad(q(p, a, 0), q(cur, a, 0), q(cur, a, 0.14), q(p, a, 0.14), curb);
          }
          if (r.plaza) {   // Gran Plaza sobre el Río Iro (Commons photos): slatted pergola on the west edge, wooden benches, green planters with olives, 2-arm black lamps, cyclist statue
            const obox = (x, z, hl, hwd, y0, y1, colr) => { const c = [[hl, hwd], [-hl, hwd], [-hl, -hwd], [hl, -hwd]].map(([a, b]) => [x + cur.tx * a + cur.nx * b, z + cur.tz * a + cur.nz * b]);
              for (let q = 0; q < 4; q++) { const A = c[q], B = c[(q + 1) % 4]; M.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], colr); } M.quad([c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]], colr); };
            const at = (o, a = 0) => [cur.x + cur.nx * o + cur.tx * a, cur.z + cur.nz * o + cur.tz * a], y = cur.yb, sl = Math.hypot(cur.x - p.x, cur.z - p.z);
            const wood = hex(0x8a5a32), stone = hex(0xc9c3b6), bronze = hex(0x5e4e34), granite = hex(0x8d8a85), dark = hex(0x2b2e31), pot = hex(0x3d6b45), olive = hex(0x7d8f62), bark = hex(0x5a4a3a);
            for (const o of [-(hw - 0.9), -(hw - 5.1)]) { const [x, z] = at(o, -sl / 2); obox(x, z, sl / 2, 0.1, y + 3.3, y + 3.5, dark); if (i % 2 === 0) { const [qx, qz] = at(o); obox(qx, qz, 0.1, 0.1, y, y + 3.3, dark); props.circle(qx, qz, 0.2, y + 3.3); } }   // pergola posts + beams
            for (let k = 0; k < sl / 0.45; k++) { const [x, z] = at(-(hw - 3), -k * 0.45); obox(x, z, 0.04, 2.4, y + 3.5, y + 3.62, dark); }   // pergola slats
            const bench = (o, a) => { const [x, z] = at(o, a); obox(x, z, 0.9, 0.24, y + 0.4, y + 0.48, wood); obox(x, z, 0.08, 0.22, y, y + 0.4, dark); };
            if (i % 2 === 1) { bench(-(hw - 3), 0); bench(hw - 2, 0); }
            if (i % 4 === 2) for (const o of [-6, 4, 11]) { const [x, z] = at(o); obox(x, z, 0.75, 0.75, y, y + 0.7, pot); obox(x, z, 0.1, 0.1, y + 0.7, y + 1.8, bark); obox(x, z, 0.8, 0.8, y + 1.8, y + 3.2, olive); props.circle(x, z, 0.85, y + 0.7); }
            if (i % 4 === 0) for (const o of [-(hw - 6.5), 2.5, hw - 4]) { const [x, z] = at(o); obox(x, z, 0.07, 0.07, y, y + 4, dark); obox(x, z, 0.6, 0.03, y + 3.7, y + 3.76, dark); for (const a of [-0.6, 0.6]) { const [lx, lz] = at(o, a); obox(lx, lz, 0.13, 0.13, y + 3.76, y + 4.15, hex(0xfff0c0)); } props.circle(x, z, 0.15, y + 4); }
            if (i === r.n - 4) {   // "Al trabajador chiclanero" (2008): bronze cyclist on a rough granite block, east side near the tram (position approximate)
              const [x, z] = at(hw - 7), t = y + 1.0; obox(x, z, 1.25, 0.6, y, t, granite); props.circle(x, z, 1.3, t);
              for (const a of [-0.55, 0.55]) { const [wx, wz] = at(hw - 7, a); obox(wx, wz, 0.34, 0.025, t, t + 0.68, bronze); }
              obox(x, z, 0.5, 0.03, t + 0.5, t + 0.58, bronze); const [rx, rz] = at(hw - 7, -0.1); obox(rx, rz, 0.14, 0.17, t + 0.6, t + 1.35, bronze); obox(rx, rz, 0.4, 0.2, t + 1.0, t + 1.1, bronze);
              const [hx, hz] = at(hw - 7, 0.05); obox(hx, hz, 0.1, 0.1, t + 1.35, t + 1.58, bronze);
            }
          }
          else if (i % 5 === 2) for (const sg of [1, -1]) { const P1 = sg > 0 ? cur.L : cur.R; post(P1[0], P1[2], P1[1] + 0.95, P1[1] + 4.6, 0.06, steel); post(P1[0] - cur.nx * sg * 0.25, P1[2] - cur.nz * sg * 0.25, P1[1] + 4.6, P1[1] + 4.85, 0.16, light); }   // road bridge: lamp posts on the parapet
          if (r.drive) for (const sg of [1, -1]) {
            const P0 = sg > 0 ? p.L : p.R, P1 = sg > 0 ? cur.L : cur.R, up = 0.95;
            M.quad(P0, P1, [P1[0], P1[1] + up, P1[2]], [P0[0], P0[1] + up, P0[2]], pcol);
            const t = 0.3, ox0 = p.nx * sg * t, oz0 = p.nz * sg * t, ox1 = cur.nx * sg * t, oz1 = cur.nz * sg * t;
            M.quad([P0[0], P0[1] + up, P0[2]], [P1[0], P1[1] + up, P1[2]], [P1[0] + ox1, P1[1] + up, P1[2] + oz1], [P0[0] + ox0, P0[1] + up, P0[2] + oz0], conc);
            M.quad([P0[0] + ox0, P0[1] + up, P0[2] + oz0], [P1[0] + ox1, P1[1] + up, P1[2] + oz1], [P1[0] + ox1, P1[1] - 0.8, P1[2] + oz1], [P0[0] + ox0, P0[1] - 0.8, P0[2] + oz0], conc);
          }
          M.quad([p.L[0], p.L[1] - 0.8, p.L[2]], [cur.L[0], cur.L[1] - 0.8, cur.L[2]], [cur.R[0], cur.R[1] - 0.8, cur.R[2]], [p.R[0], p.R[1] - 0.8, p.R[2]], under);
          if (i % 6 === 0 && cur.yb - cur.ygc > 2.4 && this.agQ(cur.x, cur.z, hw + 1.5) < -1e8) {   // piers (never in the middle of a road passing underneath)
            const sx = hw * 0.55, bt = cur.ygc - 0.5, tp = cur.yb - 0.8, X = cur.x, Z = cur.z, ux = cur.tx * 0.6, uz = cur.tz * 0.6, vx = cur.nx * sx, vz = cur.nz * sx;
            const c = [[X + ux + vx, Z + uz + vz], [X + ux - vx, Z + uz - vz], [X - ux - vx, Z - uz - vz], [X - ux + vx, Z - uz + vz]];
            for (let q = 0; q < 4; q++) { const A = c[q], B = c[(q + 1) % 4]; M.quad([A[0], bt, A[1]], [B[0], bt, B[1]], [B[0], tp, B[1]], [A[0], tp, A[1]], under); }
          }
        }
        if (flags && grounded) for (let s = 0; s < 2; s++) {
          if (!flags[s][i] || !flags[s][p.i]) continue;
          const sg = s ? -1 : 1;
          const inP = sg > 0 ? p.L : p.R, inC = sg > 0 ? cur.L : cur.R;
          const top0 = p.ygc + 0.3, top1 = cur.ygc + 0.3, ox0 = p.nx * sg * swW, oz0 = p.nz * sg * swW, ox1 = cur.nx * sg * swW, oz1 = cur.nz * sg * swW;
          const i0v = [inP[0], top0, inP[2]], i1v = [inC[0], top1, inC[2]], o1 = [inC[0] + ox1, top1, inC[2] + oz1], o0 = [inP[0] + ox0, top0, inP[2] + oz0];
          M.quad(i0v, i1v, o1, o0, walk);
          M.quad(inP, inC, i1v, i0v, curb);
          const gO0 = hf.height(o0[0], o0[2]) - 0.15, gO1 = hf.height(o1[0], o1[2]) - 0.15;
          M.quad(o0, o1, [o1[0], gO1, o1[2]], [o0[0], gO0, o0[2]], outer);
        }
        // trees on pavements
        if (flags && grounded && i % 4 === 0) for (let s = 0; s < 2; s++) {
          if (!flags[s][i]) continue;
          const sg = s ? -1 : 1, hh = hash2(Math.round(x * 2) + s, Math.round(z * 2));
          if (swW >= 1.9 && w < 14 && hh < 0.55) {
            const tx = x + nx * sg * (hw + 0.8), tz = z + nz * sg * (hw + 0.8);
            if (!this.b?.hit(tx, tz)) trees.push([tx, r.G[i] + 0.3, tz, 0.9, hash2(~~tx, ~~tz) < 0.2 ? SP.OLV : 0]);
          }
        }
        // parked cars: in bays beside the carriageway (never on it)
        if (grounded && r.drive && w >= 4.4 && w <= 9.5 && i % 6 === 0) for (let s = 0; s < 2; s++) {
          if (hash2(Math.round(x) + 11 * s, Math.round(z) + 7) >= 0.42) continue;
          const sg = s ? -1 : 1, off = hw + 1.25, cx = x + nx * sg * off, cz = z + nz * sg * off;
          if (this.b?.hit(cx, cz) || this.b?.hit(cx + tx * 2.3, cz + tz * 2.3) || this.b?.hit(cx - tx * 2.3, cz - tz * 2.3)) continue;
          const cy = hf.height(cx, cz) + (flags && flags[s][i] ? 0.3 : 0.05);
          if (cy < 0.3) continue;
          cars.push([cx, cy, cz, Math.atan2(-tx, -tz) + (hash2(~~x, ~~z) < 0.5 ? 0 : Math.PI)]);
        }
        if (grounded && r.drive && !r.rb && !/motorway|trunk|primary/.test(r.cls)) this.streetDetail(r, p, cur, flags, swW, M, MK, trees);
      }
      prev = cur;
    }
  }

  area(a, M, W, trees, cars) {
    const hf = this.hf, pts = a.pts;
    if (a.k === 'island') {   // roundabout centre
      const g = hf.height(a.cx, a.cz), N = 20, y = g + 0.2, kc = hex(0xb4b0a6), gc = hex(0x6a9650);
      for (let k = 0; k < N; k++) {
        const t0 = k / N * 6.2832, t1 = (k + 1) / N * 6.2832, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1), r1 = a.rad, r0 = Math.max(0.1, a.rad - 0.6);
        M.quad([a.cx + c0 * r1, y, a.cz + s0 * r1], [a.cx + c1 * r1, y, a.cz + s1 * r1], [a.cx + c1 * r0, y, a.cz + s1 * r0], [a.cx + c0 * r0, y, a.cz + s0 * r0], kc);
        M.tri([a.cx, y - 0.02, a.cz], [a.cx + c1 * r0, y - 0.02, a.cz + s1 * r0], [a.cx + c0 * r0, y - 0.02, a.cz + s0 * r0], gc);
      }
      if (a.rad > 6) for (let t = 0; t < Math.min(8, a.rad / 3 | 0); t++) { const an = t / 8 * 6.2832, rr = a.rad * 0.55; trees.push([a.cx + Math.cos(an) * rr, g + 0.2, a.cz + Math.sin(an) * rr, 0.9]); }
      return;
    }
    const gAvg = pts.reduce((s, [x, z]) => s + hf.height(x, z), 0) / pts.length;
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tri = a.ext < 600 || a.k === 'water' ? THREE.ShapeUtils.triangulateShape(contour, []) : null;
    const flat = (col, y, mesh = M) => { if (!tri) return; for (const [i, j, k] of tri) mesh.tri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]], col); };
    const inside = (x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    switch (a.k) {
      case 'pitch': {
        if (FB.covers(a.cx, a.cz) || CT.covers(a.cx, a.cz)) break;   // detailed football pitch (football.js)
        const col = hex(PITCH[a.sport] ?? (a.sport ? 0x5d9a4f : 0x7a9a6a)), y = gAvg + 0.07;
        flat(col, y);
        if (LINED.has(a.sport)) this.pitchLines(a, M, y + 0.03);
        break;
      }
      case 'parking': {
        if (a.ext > 250) break;
        const y = gAvg + 0.07; flat(hex(0x4c4e53), y);
        // rows of parked cars
        const ang = principalAngle(pts), c = Math.cos(ang), s = Math.sin(ang); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        for (let u = u0 + 3; u < u1 - 2; u += 2.6) for (let v = v0 + 3; v < v1 - 3; v += 5.3) {
          if (Math.floor((v - v0) / 5.3) % 3 === 2) continue;   // aisles
          const x = u * c - v * s, z = u * s + v * c;
          if (inside(x, z) && hash2(Math.round(x), Math.round(z)) < 0.55) cars.push([x, y + 0.02, z, Math.atan2(-s, -c) + Math.PI / 2 + (hash2(~~x + 3, ~~z) < 0.5 ? 0 : Math.PI)]);
        }
        break;
      }
      case 'park': {
        if (a.ext < 200) flat(hex(0x739f5e), gAvg + 0.05);
        let n = 0; const area = Math.max(1, polyArea(pts)), want = Math.min(260, Math.floor(area / 160));
        for (let t = 0; t < want * 3 && n < want; t++) {
          const x = a.x0 + hash2(t * 31 + 1, ~~a.cx) * (a.x1 - a.x0), z = a.z0 + hash2(t * 17 + 5, ~~a.cz) * (a.z1 - a.z0);
          if (inside(x, z) && this.grow(x, z, hf.height(x, z))) { const h = hash2(t * 7 + 2, ~~a.cx); trees.push([x, hf.height(x, z), z, 1.0, pickSp(255, h, 'park')]); n++; if (h < 0.5 && trees.length < 9000) { const o = hash2(t * 3, n) * 6.28; trees.push([x + Math.cos(o) * 2.2, hf.height(x, z), z + Math.sin(o) * 2.2, 0.9 + h, h < 0.07 ? SP.FLR : h < 0.14 ? SP.FLY : h < 0.2 ? SP.FLP : h < 0.3 ? SP.OLE : h < 0.36 ? SP.AGA : SP.SHR]); } }
        }
        break;
      }
      case 'wood': case 'orchard': {
        let n = 0; const area = Math.max(1, polyArea(pts)), sp = a.k === 'wood' ? 110 : 90, want = Math.min(500, Math.floor(area / sp));
        for (let t = 0; t < want * 3 && n < want; t++) {
          const x = a.x0 + hash2(t * 29 + 3, ~~a.cx) * (a.x1 - a.x0), z = a.z0 + hash2(t * 13 + 9, ~~a.cz) * (a.z1 - a.z0);
          if (inside(x, z) && this.grow(x, z, hf.height(x, z))) { const h = hash2(t * 5 + 1, ~~a.cz); trees.push([x, hf.height(x, z), z, a.k === 'wood' ? 1.15 : 0.8, pickSp(255, h, a.k)]); n++; if (a.k === 'wood' && h < 0.4) trees.push([x + 1.5, hf.height(x, z), z + 1.5, 0.8 + h, h < 0.1 ? SP.RET : SP.SHR]); }
        }
        break;
      }
      case 'beach': if (a.ext < 400) flat(hex(0xe0cf9c), gAvg + 0.04); break;
      case 'water': {
        const hs = pts.map(([x, z]) => hf.height(x, z)).sort((p, q) => p - q);
        flat([1, 1, 1], Math.max(hs[Math.floor(hs.length / 2)], 0.3) + 0.06, W); break;
      }
    }
  }

  pitchLines(a, M, y) {
    const pts = a.pts, ang = principalAngle(pts), c = Math.cos(ang), s = Math.sin(ang), col = hex(0xf4f4ef);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const P = (u, v) => [u * c - v * s, y, u * s + v * c], t = 0.09;
    const seg = (ua, va, ub, vb) => {   // thin line from (ua,va) to (ub,vb)
      const dx = ub - ua, dv = vb - va, l = Math.hypot(dx, dv) || 1, nu = -dv / l * t, nv = dx / l * t;
      M.quad(P(ua + nu, va + nv), P(ub + nu, vb + nv), P(ub - nu, vb - nv), P(ua - nu, va - nv), col);
    };
    const m = 0.5, A = u0 + m, B = u1 - m, C = v0 + m, D = v1 - m;
    seg(A, C, B, C); seg(B, C, B, D); seg(B, D, A, D); seg(A, D, A, C);
    const cu = (A + B) / 2, cv = (C + D) / 2;
    if (a.sport === 'tennis' || a.sport === 'padel') {
      const short = (B - A) < (D - C) ? 'u' : 'v';
      if (short === 'v') { seg(cu, C, cu, D); seg(A + (B - A) * 0.27, C, A + (B - A) * 0.27, D); seg(A + (B - A) * 0.73, C, A + (B - A) * 0.73, D); seg(A + (B - A) * 0.27, cv, A + (B - A) * 0.73, cv); }
      else { seg(A, cv, B, cv); seg(A, C + (D - C) * 0.27, B, C + (D - C) * 0.27); seg(A, C + (D - C) * 0.73, B, C + (D - C) * 0.73); seg(cu, C + (D - C) * 0.27, cu, C + (D - C) * 0.73); }
    } else if ((B - A) > (D - C)) seg(cu, C, cu, D); else seg(A, cv, B, cv);
  }

  river(rv, i0, i1, W, A) {
    const hf = this.hf, P = rv.P, hw = rv.w / 2, col = [1, 1, 1];
    let prev = null;
    for (let i = i0; i <= i1; i++) {
      const j = Math.min(rv.n - 1, i + 1), h = Math.max(0, i - 1), tx = P[2 * j] - P[2 * h], tz = P[2 * j + 1] - P[2 * h + 1], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, x = P[2 * i], z = P[2 * i + 1];
      const y = Math.max(rv.Wy[i], 0.35) + 0.04;
      const cur = { L: [x + nx * hw, y, z + nz * hw], R: [x - nx * hw, y, z - nz * hw] };
      if (prev) W.quad(prev.L, cur.L, cur.R, prev.R, col);
      if (rv.w >= 10 && x > -5200 && x < -1800 && z > -3300 && z < -300) for (const sg of [1, -1]) {   // stone quay wall from the water up to the bank (+ coping), only where the bank stands >0.35 m above the water
        const bx = x + nx * (hw + 5) * sg, bz = z + nz * (hw + 5) * sg, yb = Math.max(rv.Wy[i], 0.35) + RIVER_BANK, top = yb + 0.9, wx = x + nx * hw * sg, wz = z + nz * hw * sg;   // straight low wall over a level street
        cur['q' + sg] = Math.abs(hf.height(bx, bz) - yb) < 1.2 ? [wx, y, wz, wx, top, wz] : null;
        if (cur['q' + sg]) cur['s' + sg] = [wx, yb + 0.05, wz, wx + nx * sg * 4, yb + 0.05, wz + nz * sg * 4];
        { const p = prev?.['s' + sg], q = cur['s' + sg]; if (p && q) A.quad([p[0], p[1], p[2]], [q[0], q[1], q[2]], [q[3], q[4], q[5]], [p[3], p[4], p[5]], [0.78, 0.76, 0.72]); }   // acera

        const p = prev?.['q' + sg], q = cur['q' + sg];
        if (p && q) { const st = [0.55, 0.53, 0.5], cp = [0.72, 0.7, 0.66];
          A.quad([p[0], p[1], p[2]], [q[0], q[1], q[2]], [q[3], q[4], q[5]], [p[3], p[4], p[5]], st);
          A.quad([p[3], p[4] + 0.02, p[5]], [q[3], q[4] + 0.02, q[5]], [q[3] - nx * 0.5 * sg, q[4] + 0.02, q[5] - nz * 0.5 * sg], [p[3] - nx * 0.5 * sg, p[4] + 0.02, p[5] - nz * 0.5 * sg], cp); }
      }
      prev = cur;
    }
  }
}

const RIVER_BANK = 1.3, URBAN_RIVER = (x, z) => x > -5200 && x < -1800 && z > -3300 && z < -300;
function resample(pts, step) {
  const out = [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
  }
  return new Float32Array(out);
}
function principalAngle(pts) {
  let mx = 0, mz = 0; for (const [x, z] of pts) { mx += x; mz += z; } mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of pts) { const dx = x - mx, dz = z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  return 0.5 * Math.atan2(2 * sxz, sxx - szz);
}
function inPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); }
