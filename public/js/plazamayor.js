import * as THREE from 'three';
import { toLocal, R as ER, K as EK } from './geo.js';
import { props } from './props.js';
import { customVenueIds } from './venues3d.js';

// Plaza Mayor de Chiclana (Plaza de San Juan Bautista) and its surroundings, driven by data/plaza_mayor_spec.json (research: see data/plaza_mayor_spec.md,
// section "implemented vs guessed"). Replaces the generic plaza that used to live in monuments.js / plazas.js / landmarks.js.
//  - paving polygon (OSM way 184182530) with a slab + drainage-channel texture, granite kerb border
//  - Iglesia Mayor (Catastro idx 65036) and Torre del Reloj (idx 67292) are drawn here from their real footprints (custom meshes; Buildings.override hides the generic mesh, keeps the collision)
//  - every other Catastro part within R of the plaza gets whitewash/ochre/cream colours, almagre plinths and ground-floor shopfronts on the sides facing the plaza / pedestrian streets
//  - furniture (benches, lamps, planters, trees, palms, statue, memorial) is solid via props.js
const R_BUILD = 520, R_SHOW = 600, CENTER = [-3652, -1845], R_AREA = 135;
const HEX = h => [h >> 16 & 255, h >> 8 & 255, h & 255];
const col = h => new THREE.Color(h);
const hash = i => (Math.imul((i | 0) + 1, 2654435761) >>> 0) / 4294967296;
const PEDESTRIAN = /arquillo|callejoncillo|la rosa|mart[ií]n jim|san jos[eé]|padre a[ñn]eto|botica|obispo ranc|santo cristo|amados|larga/i;
const FACADE_PALETTE = [0xf4f0e6, 0xefe7d6, 0xe8d9b0, 0xe2c27e, 0xe5bfa5, 0xf2eee6, 0xdad2bf, 0xd9e0d8];   // whitewash, cream, ochre, salmon, pale green
const SIGN_PALETTE = [['#7a1f1f', '#f3e9d2'], ['#1f3a5f', '#f3e9d2'], ['#2f5d3a', '#f3e9d2'], ['#efe6cf', '#3a2a1e'], ['#3a2a1e', '#e8c675']];

const mats = {};
const M = (h, o = {}) => { const k = h + JSON.stringify(o); return mats[k] || (mats[k] = new THREE.MeshLambertMaterial({ color: h, ...o })); };
function tex(w, h, draw, rep = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const pavingTex = () => tex(512, 512, (g, w, h) => {      // one tile = 6 m: 4x4 slabs of 1.5 m, drainage channel on two edges
  g.fillStyle = '#b9b4a8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 0.94 + ((i * 7 + j * 13) % 5) * 0.025; g.fillStyle = `rgb(${185 * v | 0},${180 * v | 0},${168 * v | 0})`; g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124); }
  g.fillStyle = '#8f8a7f'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
  g.fillStyle = '#4b4a46'; g.fillRect(0, 0, w, 7); g.fillRect(0, 0, 7, h);
});
const ashlarTex = () => tex(256, 256, (g, w, h) => {      // ashlar courses 0.6 m high, blocks 1.2 m (tile = 2.4 m)
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, r * 64, w, 2); for (let b = 0; b < 2; b++) g.fillRect(((b * 128 + (r % 2) * 64) % 256), r * 64, 2, 64); }
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? '0,0,0' : '255,255,255'},0.035)`; g.fillRect(hash(i * 3) * w, hash(i * 5) * h, 24, 12); }
});
const checkerTex = () => tex(64, 64, (g) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#c9644a' : '#f2eee6'; g.fillRect(i * 8, j * 8, 8, 8); } });
function signTex(text, bg, fg) {
  return tex(512, 96, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 54; g.font = `bold ${fs}px Georgia, serif`; while (g.measureText(text).width > w - 40 && fs > 20) { fs -= 2; g.font = `bold ${fs}px Georgia, serif`; } g.fillText(text, w / 2, h / 2 + 3); }, false);
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);   // y = bottom
const cyl = (r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 10) => mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat, x, y + h / 2, z);
const sph = (r, mat, x, y, z, sy = 1) => { const m = mesh(new THREE.SphereGeometry(r, 10, 8), mat, x, y, z); m.scale.y = sy; return m; };

function pointInPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
function distSeg(x, z, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - t * dx, z - az - t * dz); }
function distPoly(P, x, z) { let m = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) m = Math.min(m, distSeg(x, z, P[j][0], P[j][1], P[i][0], P[i][1])); return m; }

/** extruded prism over a footprint ring: textured walls (uv in metres) + optional flat roof. Returns THREE.Group */
function prism(ring, y0, y1, wallMat, roofMat, tint) {
  const pos = [], uv = [], n = ring.length; let u = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n], len = Math.hypot(bx - ax, bz - az); if (len < 0.02) continue;
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    const u0 = u / 2.4, u1 = (u + len) / 2.4, v0 = y0 / 2.4, v1 = y1 / 2.4; uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1); u += len;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g, wallMat));
  if (roofMat) {
    const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []), rp = []; for (const [x, z] of ring) rp.push(x, y1, z);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(tri.flat()); rg.computeVertexNormals(); grp.add(new THREE.Mesh(rg, roofMat));
  }
  void tint; return grp;
}

/** Flatten the DEM under the plaza (+ a few metres around) towards a gently sloping plane and blend back to the real relief over `blend` m.
 *  Must run BEFORE Terrain/Buildings/World read the heightfield (see main.js). Returns {before:[min,max], after:[min,max]} over the plaza polygon. */
export function flattenPlaza(hf, spec, { keep = 0.25, pad = 8, blend = 32 } = {}) {
  const P = spec.elements.find(e => e.kind === 'plaza').polyLocal.slice(0, -1), g = hf.grid, W = hf.W, H = hf.H, s = hf.s;
  const rng = () => { let a = 1e9, b = -1e9; for (const [x, z] of P) { const h = hf.height(x, z); a = Math.min(a, h); b = Math.max(b, h); } return [+a.toFixed(2), +b.toFixed(2)]; };
  const before = rng();
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const [x, z] of P) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  // least-squares plane h = a + bx*(x-cx) + bz*(z-cz) over 3 m samples inside the polygon
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2; let n = 0, sh = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, shx = 0, shz = 0;
  for (let x = minx; x <= maxx; x += 3) for (let z = minz; z <= maxz; z += 3) { if (!pointInPoly(P, x, z)) continue; const h = hf.height(x, z), dx = x - cx, dz = z - cz; n++; sh += h; sx += dx; sz += dz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; shx += h * dx; shz += h * dz; }
  const hm0 = sh / n, mdx = sx / n, mdz = sz / n;   // centred normal equations (bbox centre != centroid)
  const cxx = sxx - n * mdx * mdx, czz = szz - n * mdz * mdz, cxz = sxz - n * mdx * mdz, chx = shx - n * hm0 * mdx, chz = shz - n * hm0 * mdz, det = cxx * czz - cxz * cxz;
  const bx = det ? (chx * czz - chz * cxz) / det : 0, bz = det ? (chz * cxx - chx * cxz) / det : 0, hm = hm0 - keep * (bx * mdx + bz * mdz);
  const plane = (x, z) => hm + keep * (bx * (x - cx) + bz * (z - cz));
  const reach = pad + blend, cell = s * EK;
  const u0 = Math.floor((minx - reach) / cell) - 2, u1 = Math.ceil((maxx + reach) / cell) + 2;      // coarse bound only; exact cell loop below via world->grid
  void u0; void u1;
  // grid index range from the world bbox corners
  const toUV = (x, z) => { const mx = x / EK + hf._mx0, my = hf._my0 - z / EK; return [(mx + Math.PI * ER) / s - hf.tx0 * 256 - 0.5, (Math.PI * ER - my) / s - hf.ty0 * 256 - 0.5]; };
  const c1 = toUV(minx - reach, minz - reach), c2 = toUV(maxx + reach, maxz + reach);
  const i0 = Math.max(0, Math.floor(Math.min(c1[0], c2[0])) - 1), i1 = Math.min(W - 1, Math.ceil(Math.max(c1[0], c2[0])) + 1), j0 = Math.max(0, Math.floor(Math.min(c1[1], c2[1])) - 1), j1 = Math.min(H - 1, Math.ceil(Math.max(c1[1], c2[1])) + 1);
  const orig = new Map();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) orig.set(j * W + i, g[j * W + i]);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const mx = (i + 0.5 + hf.tx0 * 256) * s - Math.PI * ER, my = Math.PI * ER - (j + 0.5 + hf.ty0 * 256) * s, x = (mx - hf._mx0) * EK, z = (hf._my0 - my) * EK;
    const d = pointInPoly(P, x, z) ? 0 : distPoly(P, x, z); if (d > reach) continue;
    const t = d <= pad ? 0 : (d - pad) / blend, e = t * t * (3 - 2 * t), o = j * W + i;
    g[o] = Math.max(0, plane(x, z) * (1 - e) + g[o] * e);
  }
  return { before, after: rng(), plane: { hm: +hm.toFixed(2), bx: +bx.toFixed(3), bz: +bz.toFixed(3), keep } };
}

export class PlazaMayor {
  /** spec = data/plaza_mayor_spec.json, osm = data/osm.json (roads with lon/lat), B = Buildings */
  constructor(scene, hf, B, spec, osm) {
    this.scene = scene; this.hf = hf; this.B = B; this.spec = spec; this.osm = osm; this.group = null; this.t = 0;
    this.poly = spec.elements.find(e => e.kind === 'plaza').polyLocal.slice(0, -1);
    this.cfg = { churchPt: [-3601.2, -1823.7], towerPt: [-3633.3, -1861.6], facadeA: [-3639.4, -1824.6], facadeB: [-3629.6, -1850.3], churchH: 12.5, towerShaftH: 21, archC: [-3631.27, -1861.1], archA: [0.914, 0.409], archW: 2.6 };
    this.stats = { parts: 0, shopfronts: 0, props0: props.n };
    this.applyOverrides();
  }
  // -------------------------------------------------------------- Catastro parts: colours + heights; church/tower meshes are replaced
  partRing(i) { const { P, off } = this.B, r = []; for (let k = off[i]; k < off[i + 1]; k++) r.push([P[k * 2], P[k * 2 + 1]]); return r; }
  partIndexAt(x, z) { const B = this.B; for (let i = 0; i < B.n; i++) { if (x < B.bb[i * 4] || x > B.bb[i * 4 + 1] || z < B.bb[i * 4 + 2] || z > B.bb[i * 4 + 3]) continue; if (pointInPoly(this.partRing(i), x, z)) return i; } return -1; }
  applyOverrides() {
    const B = this.B, c = this.cfg; this.ci = this.partIndexAt(...c.churchPt); this.ti = this.partIndexAt(...c.towerPt); this.near = [];
    for (let i = 0; i < B.n; i++) {
      const cx = (B.bb[i * 4] + B.bb[i * 4 + 1]) / 2, cz = (B.bb[i * 4 + 2] + B.bb[i * 4 + 3]) / 2;
      if (Math.hypot(cx - CENTER[0], cz - CENTER[1]) > R_AREA || i === this.ci || i === this.ti) continue;
      this.near.push(i);
      const h = hash(i * 31 + 7), rgb = HEX(FACADE_PALETTE[(h * FACADE_PALETTE.length) | 0]);
      if (this.annex(i)) B.override(i, { rgb: HEX(0xa77b55), plinth: 0 }); else B.override(i, { rgb, plinth: h < 0.55 ? 2 : 1 });
      this.stats.parts++;
    }
    if (this.ci >= 0) B.override(this.ci, { skip: true, top: c.churchH });
    if (this.ti >= 0) B.override(this.ti, { skip: true, top: c.towerShaftH + 7 });
  }
  annex(i) { const B = this.B, x = (B.bb[i * 4] + B.bb[i * 4 + 1]) / 2, z = (B.bb[i * 4 + 2] + B.bb[i * 4 + 3]) / 2; return Math.hypot(x - this.cfg.towerPt[0], z - this.cfg.towerPt[1]) < 12 && B.floors[i] <= 2 && i !== this.ci; }

  // -------------------------------------------------------------- build (lazy, when the player is within R_BUILD)
  build() {
    const g = this.group = new THREE.Group(); g.name = 'plazaMayor';
    this.paving(g); this.streets(g); this.church(g); this.tower(g); this.shopfronts(g); this.furniture(g);
    this.scene.add(g);
  }
  gy(x, z) { return this.hf.height(x, z); }

  paving(g) {
    const P = this.poly, S = 1.5, pos = [], uvs = [], idx = []; let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const [x, z] of P) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const ang = Math.atan2(-0.423, -0.906), ca = Math.cos(ang), sa = Math.sin(ang);
    const uv = (x, z) => [(x * ca + z * sa) / 6, (-x * sa + z * ca) / 6];
    for (let x = Math.floor(minx / S) * S; x < maxx; x += S) for (let z = Math.floor(minz / S) * S; z < maxz; z += S) {
      if (!pointInPoly(P, x + S / 2, z + S / 2) && distPoly(P, x + S / 2, z + S / 2) > 0.2) continue;
      const k = pos.length / 3;
      for (const [dx, dz] of [[0, 0], [S, 0], [S, S], [0, S]]) { pos.push(x + dx, this.gy(x + dx, z + dz) + 0.07, z + dz); uvs.push(...uv(x + dx, z + dz)); }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const pv = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: pavingTex(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })); g.add(pv);
    // granite kerb along the exact polygon edge (covers the 1.5 m cell jaggies)
    const kpos = [], kidx = [];
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], l = Math.hypot(bx - ax, bz - az); if (l < 0.1) continue; const nx = -(bz - az) / l * 0.55, nz = (bx - ax) / l * 0.55, v = kpos.length / 3;
      for (const [x, z] of [[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]]) kpos.push(x, this.gy(x, z) + 0.1, z);
      kidx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(kpos, 3)); kg.setIndex(kidx); kg.computeVertexNormals();
    g.add(new THREE.Mesh(kg, new THREE.MeshLambertMaterial({ color: 0x8e8b84, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })));
  }

  /** slab overlay on the adjoining pedestrian streets (names from spec.streets + a few more), ribbon width = OSM width */
  streets(g) {
    const pos = [], uvs = [], idx = [], tx = pavingTex();
    for (const r of this.osm.roads) {
      if (!r.n || !PEDESTRIAN.test(r.n) || !/pedestrian|living_street|footway|residential/.test(r.h) || r.b) continue;
      const pts = []; for (let k = 0; k < r.p.length; k += 2) pts.push(toLocal(r.p[k], r.p[k + 1]));
      if (!pts.some(([x, z]) => Math.hypot(x - CENTER[0], z - CENTER[1]) < R_AREA) || r.h !== 'pedestrian') continue;
      const w = Math.min(r.w || 4, 6) / 2; let s = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.3) continue; const nx = -(bz - az) / l * w, nz = (bx - ax) / l * w, k = pos.length / 3;
        for (const [x, z, u, v] of [[ax - nx, az - nz, s, 0], [bx - nx, bz - nz, s + l, 0], [bx + nx, bz + nz, s + l, w * 2], [ax + nx, az + nz, s, w * 2]]) { pos.push(x, this.gy(x, z) + 0.1, z); uvs.push(u / 6, v / 6); }
        idx.push(k, k + 2, k + 1, k, k + 3, k + 2); s += l;
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 })));
  }

  // -------------------------------------------------------------- Iglesia Mayor San Juan Bautista
  church(g) {
    if (this.ci < 0) return; const B = this.B, c = this.cfg, ring = this.partRing(this.ci), y0 = B.base[this.ci] - 0.3, H = B.base[this.ci] + c.churchH;
    const ash = new THREE.MeshLambertMaterial({ color: 0xd6b583, map: ashlarTex() }), roof = M(0xb5573b, { side: THREE.DoubleSide });
    g.add(prism(ring, y0, H, ash, roof));
    this._roofPending = { H, roofMat: roof };
    // flat roof edge parapet band + central cupola with checkered tiles (OSM/photos: dome behind the facade)
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    g.add(cyl(4.6, 4.8, 3.4, M(0xe6dcc6), cx, H, cz, 8), mesh(new THREE.SphereGeometry(4.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ map: (() => { const t = checkerTex(); t.repeat.set(6, 2); return t; })() }), cx, H + 3.4, cz), cyl(0.15, 0.15, 1.6, M(0x2b2b2b), cx, H + 7.8, cz, 6));
    // facade on the edge that touches the plaza
    const [ax, az] = c.facadeA, [bx, bz] = c.facadeB, L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L; let nx = tz, nz = -tx;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (pointInPoly(ring, mx + nx * 0.5, mz + nz * 0.5)) { nx = -nx; nz = -nz; }
    let bulge = 0; for (const [x, z] of ring) { const d = (x - mx) * nx + (z - mz) * nz; if (Math.abs((x - mx) * tx + (z - mz) * tz) < L / 2 && d > bulge) bulge = d; }
    const gy = B.base[this.ci], f = new THREE.Group(); f.position.set(mx, gy, mz); f.rotation.y = Math.atan2(nx, nz);   // local +x = south-ish along facade, +z = out to the plaza
    const o = bulge + 0.18, trim = M(0xf2eee6), dark = M(0x3a2a1e), black = M(0x17191a), granite = M(0x9c9a94);
    f.add(box(L, 1.2, 0.5, granite, 0, -0.3, o), box(L, 0.6, 0.55, trim, 0, 11.7, o), box(L, 0.4, 0.4, trim, 0, 12.3, o));   // plinth, cornice, parapet
    for (const u of [-L / 2 + 1, -5.2, 5.2, L / 2 - 1]) f.add(box(0.9, 11, 0.4, trim, u, 0.9, o + 0.05));                    // pilasters
    const ped = new THREE.Shape([new THREE.Vector2(-6.8, 0), new THREE.Vector2(6.8, 0), new THREE.Vector2(0, 3.4)]); const pg = new THREE.ExtrudeGeometry(ped, { depth: 0.7, bevelEnabled: false });
    f.add(mesh(pg, trim, 0, 12.4, o - 0.1)); const tym = new THREE.Shape([new THREE.Vector2(-5.4, 0.35), new THREE.Vector2(5.4, 0.35), new THREE.Vector2(0, 2.7)]); f.add(mesh(new THREE.ExtrudeGeometry(tym, { depth: 0.2, bevelEnabled: false }), M(0xcfa86e), 0, 12.4, o + 0.55));
    for (const [u, h] of [[-3.2, 0.9], [0, 1.5], [3.2, 0.9]]) f.add(box(0.8, h, 0.5, trim, u, 12.55 + (u === 0 ? 0.9 : 0), o + 0.7));      // sculpted angels (blocks)
    // solid facade wall (closes any gap with the Catastro prism) with the portal recessed into it: wall pieces left / right / above the opening, dark doorway set back, jamb frame + arched head in front
    const wall = M(0xd6b583), hw = 1.35, wl = L / 2 - hw;
    f.add(box(wl, 12, 0.3, wall, -(hw + wl / 2), -0.3, o - 0.02), box(wl, 12, 0.3, wall, hw + wl / 2, -0.3, o - 0.02), box(2 * hw, 7.1, 0.3, wall, 0, 4.9, o - 0.02));
    f.add(box(2 * hw, 4.4, 0.1, dark, 0, 0.5, o - 0.1), box(0.1, 4.4, 0.35, trim, -hw - 0.05, 0.5, o + 0.02), box(0.1, 4.4, 0.35, trim, hw + 0.05, 0.5, o + 0.02), box(2 * hw + 0.2, 0.3, 0.4, trim, 0, 4.9, o + 0.02));
    const hd = cyl(hw, hw, 0.12, dark, 0, 4.9, o - 0.08, 16); hd.rotation.x = Math.PI / 2; hd.position.y = 5.2; f.add(hd);   // arched head of the doorway
    for (const sx of [-1, 1]) f.add(box(0.5, 5.4, 0.45, trim, sx * (hw + 0.4), 0.5, o + 0.05));               // portal jambs
    f.add(box(2 * hw + 1.3, 0.4, 0.5, trim, 0, 5.9, o + 0.08));                                                // portal lintel / cornice
    f.add(box(5.4, 0.28, 1.2, trim, 0, 6.5, o + 0.35), box(5.4, 0.08, 0.08, black, 0, 7.5, o + 0.9));                      // balcony slab + rail
    for (let k = 0; k < 14; k++) f.add(box(0.05, 1.0, 0.05, black, -2.55 + k * 0.39, 6.78, o + 0.9));
    for (const u of [-8.6, 8.6]) { const oc = cyl(1.05, 1.05, 0.2, trim, u, 6.6, o + 0.12, 20); oc.rotation.x = Math.PI / 2; oc.position.y = 7.6; const od = cyl(0.8, 0.8, 0.22, M(0x2a2f35), u, 6.6, o + 0.15, 20); od.rotation.x = Math.PI / 2; od.position.y = 7.6; f.add(oc, od, box(1.5, 2.6, 0.2, dark, u, 0.5, o + 0.12)); }
    // terrace: three granite steps (flat enough to walk over) + black railing with a gap at the stairs
    f.add(box(L - 3, 0.1, 5.5, granite, 0, 0, o + 2.5), box(L - 6, 0.2, 4.2, granite, 0, 0, o + 2.0), box(L - 9, 0.3, 2.9, granite, 0, 0, o + 1.5));
    for (const s of [-1, 1]) { const w = (L - 3) / 2 - 3.2, cu = s * (3.2 + w / 2), rail = box(w, 1.0, 0.06, black, cu, 0.1, o + 5.3); f.add(rail); }
    // closed pitched terracotta nave roof (ridge along the nave axis, from the facade back to the rear of the Catastro footprint)
    { let minD = 0; for (const [x, z] of ring) minD = Math.min(minD, (x - mx) * nx + (z - mz) * nz);
      const depth = bulge - minD, rise = 3.0, tri = new THREE.Shape([new THREE.Vector2(-L / 2, 0), new THREE.Vector2(L / 2, 0), new THREE.Vector2(0, rise)]);
      const rg = mesh(new THREE.ExtrudeGeometry(tri, { depth, bevelEnabled: false }), M(0xb5573b, { side: THREE.DoubleSide }), 0, c.churchH - 0.05, minD); f.add(rg);
      for (const sx of [-1, 1]) f.add(box(0.5, 0.4, depth, M(0xa14a30), sx * L / 2, c.churchH - 0.25, minD)); }   // eaves
    g.add(f);
    f.updateMatrixWorld(true);
    for (const s of [-1, 1]) { const w = (L - 3) / 2 - 3.2, cu = s * (3.2 + w / 2), p = new THREE.Vector3(cu, 0, o + 5.3).applyMatrix4(f.matrixWorld); props.box(p.x, p.z, w / 2, 0.15, f.rotation.y, gy + 1.1); }
    this.facade = { f, L, o, mx, mz, nx, nz, gy };
  }

  // -------------------------------------------------------------- Torre del Reloj
  tower(g) {
    if (this.ti < 0) return; const B = this.B, c = this.cfg, ring = this.partRing(this.ti), y0 = B.base[this.ti] - 0.3, Hs = B.base[this.ti] + c.towerShaftH;
    const stone = new THREE.MeshLambertMaterial({ color: 0xa77b55, map: ashlarTex(), side: THREE.DoubleSide }); this.archTower(g, ring, y0, Hs, stone);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length, trim = M(0xf2eee6);
    g.add(cyl(4.5, 4.5, 0.7, trim, cx, Hs, cz, 8), cyl(3.1, 3.1, 4.4, M(0xb38a5f), cx, Hs + 0.7, cz, 8), cyl(3.6, 3.6, 0.5, trim, cx, Hs + 5.1, cz, 8));   // cornice, octagonal bell stage, upper cornice
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 8; const w = box(1.3, 2.6, 0.3, M(0x2a1f18), cx + Math.sin(a) * 2.85, Hs + 1.6, cz + Math.cos(a) * 2.85); w.rotation.y = a; g.add(w); }   // arched belfry openings
    const tor = mesh(new THREE.TorusGeometry(3.5, 0.05, 4, 16), M(0x17191a), cx, Hs + 1.7, cz); tor.rotation.x = Math.PI / 2; g.add(tor);
    const dome = mesh(new THREE.SphereGeometry(3.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ map: (() => { const t = checkerTex(); t.repeat.set(8, 3); return t; })() }), cx, Hs + 5.6, cz); g.add(dome);
    g.add(cyl(0.12, 0.12, 2.2, M(0x2b2b2b), cx, Hs + 8.7, cz, 6), box(0.9, 0.12, 0.12, M(0x2b2b2b), cx, Hs + 10.2, cz));      // finial + cross
    const ids = []; for (let i = 0; i < ring.length; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length]; ids.push([Math.hypot(bx - ax, bz - az), i]); }
    ids.sort((a, b) => b[0] - a[0]);
    for (const [l, i] of ids.slice(0, 3)) {      // clock on the three longest sides
      if (l < 2.5) continue; const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], mx = (ax + bx) / 2, mz = (az + bz) / 2; let nx = (bz - az) / l, nz = -(bx - ax) / l; if (pointInPoly(ring, mx + nx * 0.4, mz + nz * 0.4)) { nx = -nx; nz = -nz; }
      const cg = new THREE.Group(); cg.position.set(mx + nx * 0.12, Hs - 3.8, mz + nz * 0.12); cg.rotation.y = Math.atan2(nx, nz);
      const rim = cyl(1.35, 1.35, 0.14, M(0x2b2b2b), 0, 0, 0, 24), face = cyl(1.2, 1.2, 0.18, M(0xf5f2e8), 0, 0, 0, 24); rim.rotation.x = face.rotation.x = Math.PI / 2; rim.position.y = face.position.y = 0;
      const h1 = box(0.1, 0.8, 0.05, M(0x17191a), 0, 0, 0.12); h1.position.y = 0.4; const h2 = box(0.07, 1.0, 0.05, M(0x17191a), 0, 0, 0.12); h2.rotation.z = -1.9; h2.position.set(0.45, -0.1, 0.12); cg.add(rim, face, h1, h2); g.add(cg);
    }
    // ceramic tile "PLAZA MAYOR" at the tower corner (photo-seen)
    const t = this.poly[5] || [cx, cz]; const sg = mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: signTex('PLAZA MAYOR', '#f4f4f0', '#1f3a5f') }), cx - 3.3, B.base[this.ti] + 2.6, cz + 1.2); sg.rotation.y = Math.atan2(-0.9, -0.4); g.add(sg); void t;
  }

  /** tower shaft with a round-arch passage (Arquillo del Reloj) running through its base. The Catastro ring is cut into two full-height piers and N thin strips whose underside
   *  follows a semicircle -> real tunnel you can walk through (collision: Buildings.hole). Axis/width are read off the Catastro ring: the tower's west faces open to the plaza
   *  street and edge v6-v0 (2.9 m) opens to the 2.5 m alley between the neighbouring parts (guessed from the footprints + photo; see data/plaza_mayor_spec.md). */
  archTower(g, ring, y0, Hs, stone) {
    const c = this.cfg, C = c.archC, A = c.archA, N = [-A[1], A[0]], w = c.archW, r = w / 2, spring = 2.2, ns = 14, B = this.B, ti = this.ti;
    const U = p => (p.x - C[0]) * N[0] + (p.z - C[1]) * N[1];
    const clip = (poly, keepGE, d) => {   // Sutherland-Hodgman against u=d; vertex.ec = edge from previous vertex lies on the cut
      const out = [], n = poly.length;
      for (let i = 0; i < n; i++) {
        const S = poly[(i + n - 1) % n], E = poly[i], sIn = keepGE ? U(S) >= d : U(S) <= d, eIn = keepGE ? U(E) >= d : U(E) <= d;
        const I = () => { const us = U(S), ue = U(E), t = (d - us) / (ue - us); return { x: S.x + (E.x - S.x) * t, z: S.z + (E.z - S.z) * t }; };
        if (eIn) { if (!sIn) out.push({ ...I(), ec: true }); out.push({ x: E.x, z: E.z, ec: E.ec }); } else if (sIn) out.push({ ...I(), ec: E.ec });
      }
      return out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]; return Math.hypot(p.x - q.x, p.z - q.z) > 1e-4; });
    };
    const pos = [], uv = [];
    const wall = (a, b, y1, y2) => { if (y2 - y1 < 1e-3) return; const l = Math.hypot(b.x - a.x, b.z - a.z); if (l < 1e-4) return; const u0 = (a.x * 0.7 + a.z * 0.3) / 2.4, u1 = u0 + l / 2.4;
      pos.push(a.x, y1, a.z, b.x, y1, b.z, b.x, y2, b.z, a.x, y1, a.z, b.x, y2, b.z, a.x, y2, a.z); uv.push(u0, y1 / 2.4, u1, y1 / 2.4, u1, y2 / 2.4, u0, y1 / 2.4, u1, y2 / 2.4, u0, y2 / 2.4); };
    const cap = (poly, y) => { if (poly.length < 3) return; const tri = THREE.ShapeUtils.triangulateShape(poly.map(p => new THREE.Vector2(p.x, p.z)), []); for (const t of tri) for (const k of t) { pos.push(poly[k].x, y, poly[k].z); uv.push(poly[k].x / 2.4, poly[k].z / 2.4); } };
    const base = ring.map(([x, z]) => ({ x, z, ec: false })), bot = k => y0 + spring + Math.sqrt(Math.max(0, r * r - Math.pow(-r + (k + 0.5) * w / ns, 2)));
    const bots = Array.from({ length: ns }, (_, k) => bot(k));
    for (const side of [1, -1]) {       // piers: full height, inner cut wall up to the first arch step
      const poly = clip(base, side > 0, side * r); if (poly.length < 3) continue; const yb = side > 0 ? bots[ns - 1] : bots[0];
      for (let i = 0; i < poly.length; i++) { const a = poly[(i + poly.length - 1) % poly.length], b = poly[i]; wall(a, b, y0, b.ec ? yb : Hs); }
    }
    for (let k = 0; k < ns; k++) {
      const u0 = -r + k * w / ns, u1 = u0 + w / ns, poly = clip(clip(base, true, u0), false, u1); if (poly.length < 3) continue;
      for (let i = 0; i < poly.length; i++) { const a = poly[(i + poly.length - 1) % poly.length], b = poly[i];
        if (!b.ec) { wall(a, b, bots[k], Hs); continue; }
        const um = (U(a) + U(b)) / 2, hi = um > (u0 + u1) / 2, nb = hi ? (k < ns - 1 ? bots[k + 1] : null) : (k > 0 ? bots[k - 1] : null);
        if (nb != null && bots[k] < nb - 1e-4) wall(a, b, bots[k], nb); }
      cap(poly, bots[k]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, stone));
    const rp = []; const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []); const rg = new THREE.BufferGeometry();
    for (const t of tri) for (const k of t) rp.push(ring[k][0], Hs, ring[k][1]); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.computeVertexNormals(); g.add(new THREE.Mesh(rg, M(0x8f6a48, { side: THREE.DoubleSide })));
    // where the passage axis crosses the ring: t range
    let t0 = 1e9, t1 = -1e9;
    for (let i = 0; i < ring.length; i++) { const [px, pz] = ring[i], [qx, qz] = ring[(i + 1) % ring.length], ex = qx - px, ez = qz - pz, den = A[0] * ez - A[1] * ex; if (Math.abs(den) < 1e-6) continue;
      const t = ((px - C[0]) * ez - (pz - C[1]) * ex) / den, sgm = ((px - C[0]) * A[1] - (pz - C[1]) * A[0]) / den * -1; void sgm;
      const s2 = (C[0] - px) * A[1] - (C[1] - pz) * A[0]; const sp = s2 / (A[0] * ez - A[1] * ex) * -1; void sp;
      const tt = ((px - C[0]) * ez - (pz - C[1]) * ex) / den, ss = ((px - C[0]) * A[1] - (pz - C[1]) * A[0]) / den; if (ss >= -1e-6 && ss <= 1 + 1e-6) { t0 = Math.min(t0, tt); t1 = Math.max(t1, tt); } void t; }
    if (t0 > t1) { t0 = -3; t1 = 3; }
    this.arch = { t0, t1 };
    // voussoir rings on both faces + paved floor (extends 3 m into the alley)
    const vm = new THREE.MeshLambertMaterial({ color: 0xc9a57a });
    for (const [t, sg] of [[t0, -1], [t1, 1]]) { const tor = mesh(new THREE.TorusGeometry(r + 0.14, 0.14, 6, 20, Math.PI), vm, C[0] + A[0] * (t + sg * 0.04), y0 + spring, C[1] + A[1] * (t + sg * 0.04)); tor.rotation.y = Math.atan2(A[0], A[1]); g.add(tor); }
    const fl = [], fi = [], gb = B.base[ti] + 0.06, T0 = t0 - 2, T1 = t1 + 3;
    for (const [t, sd] of [[T0, -1], [T0, 1], [T1, 1], [T1, -1]]) fl.push(C[0] + A[0] * t + N[0] * sd * r, gb, C[1] + A[1] * t + N[1] * sd * r);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fl, 3)); fg.setIndex([0, 2, 1, 0, 3, 2]); fg.computeVertexNormals();
    g.add(new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: 0x9d9689, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }))); void fi;
    // walk-through collision
    const tm = (t0 + t1) / 2; B.hole(ti, C[0] + A[0] * tm, C[1] + A[1] * tm, A[0], A[1], (t1 - t0) / 2 + 0.2, r, B.base[ti] + 3.2);
  }

  // -------------------------------------------------------------- shopfronts on the ground floor of buildings facing the plaza / pedestrian streets
  edgesFacing(i, maxD) {
    const ring = this.partRing(i), out = [], B = this.B; if (B.floors[i] === 0 || B.top[i] - B.base[i] < 4) return out;
    for (let a = 0; a < ring.length; a++) {
      const [ax, az] = ring[a], [bx, bz] = ring[(a + 1) % ring.length], l = Math.hypot(bx - ax, bz - az); if (l < 3.4) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2; let nx = (bz - az) / l, nz = -(bx - ax) / l; if (pointInPoly(ring, mx + nx * 0.4, mz + nz * 0.4)) { nx = -nx; nz = -nz; }
      const px = mx + nx * 1.2, pz = mz + nz * 1.2; let ok = pointInPoly(this.poly, px, pz) || distPoly(this.poly, px, pz) < maxD;
      if (!ok) for (const s of this.pedSegs) if (distSeg(px, pz, s[0], s[1], s[2], s[3]) < s[4]) { ok = true; break; }
      if (ok) out.push({ ax, az, bx, bz, l, mx, mz, nx, nz });
    }
    return out;
  }
  shopfront(g, e, i, name) {
    const B = this.B, gy = B.base[i], k = hash(i * 17 + (name ? name.length : 3)), [bg, fg] = SIGN_PALETTE[(k * SIGN_PALETTE.length) | 0];
    const w = Math.min(e.l - 1.0, name ? 6.5 : 5), grp = new THREE.Group(); grp.position.set(e.mx, gy, e.mz); grp.rotation.y = Math.atan2(e.nx, e.nz);
    grp.add(box(w, 0.25, 0.2, M(0x2b2b2b), 0, 3.05, 0.1), box(w, 2.5, 0.1, M(0x1f2d38), 0, 0.4, 0.07), box(1.1, 2.4, 0.16, M(0x3a2a1e), -w / 2 + 1.1, 0.0, 0.1));
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.75, 0.16), [M(0x2b2b2b), M(0x2b2b2b), M(0x2b2b2b), M(0x2b2b2b), new THREE.MeshBasicMaterial({ map: signTex(name || '', bg, fg) }), M(0x2b2b2b)]);
    sign.position.set(0, 3.55, 0.12); grp.add(sign);
    if (name || k > 0.5) { const aw = box(w, 0.08, 1.2, M(name ? 0x9a2f2f : 0xd9d0b8), 0, 3.0, 0.7); aw.rotation.x = 0.28; grp.add(aw); }
    g.add(grp); this.stats.shopfronts++;
  }
  shopfronts(g) {
    const B = this.B; this.pedSegs = [];
    for (const r of this.osm.roads) { if (!r.n || !PEDESTRIAN.test(r.n) || r.h !== 'pedestrian') continue; const pts = []; for (let k = 0; k < r.p.length; k += 2) pts.push(toLocal(r.p[k], r.p[k + 1]));
      for (let k = 0; k + 1 < pts.length; k++) if (Math.hypot(pts[k][0] - CENTER[0], pts[k][1] - CENTER[1]) < R_AREA) this.pedSegs.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], Math.min(r.w || 4, 6) / 2 + 1.5]); }
    const named = new Map(); for (const b of this.spec.buildings) for (const s of b.shops || []) { const [x, z] = toLocal(b.lon, b.lat); const i = this.nearestPart(x, z, 12); if (i >= 0) named.set(i, { name: s.name.replace(/^./, c => c.toUpperCase()), x, z }); }
    for (const sp of ['n4261016398', 'n4261032596', 'n698086761', 'n9869311317']) customVenueIds.add(sp);
    let budget = 110;
    for (const [i, nv] of named) { const ring = this.partRing(i); let best = null, bd = 1e9;
      for (let a = 0; a < ring.length; a++) { const [ax, az] = ring[a], [bx, bz] = ring[(a + 1) % ring.length], l = Math.hypot(bx - ax, bz - az); if (l < 3.4) continue; const d = distSeg(nv.x, nv.z, ax, az, bx, bz); if (d < bd) { bd = d; const mx = (ax + bx) / 2, mz = (az + bz) / 2; let nx = (bz - az) / l, nz = -(bx - ax) / l; if (pointInPoly(ring, mx + nx * 0.4, mz + nz * 0.4)) { nx = -nx; nz = -nz; } best = { ax, az, bx, bz, l, mx, mz, nx, nz }; } }
      if (best) { this.shopfront(g, best, i, nv.name); budget--; } }
    for (const i of this.near) { if (budget <= 0 || named.has(i)) continue; for (const e of this.edgesFacing(i, 1.6).slice(0, 2)) { if (budget-- <= 0) break; this.shopfront(g, e, i, null); } }
  }
  nearestPart(x, z, r) { let best = -1, bd = r; for (const i of this.near) { const d = distPoly(this.partRing(i), x, z) * (pointInPoly(this.partRing(i), x, z) ? 0 : 1); if (d < bd) { bd = d; best = i; } } return best; }

  // -------------------------------------------------------------- furniture (positions of everything except the polygon / Catastro are ESTIMATES from photos)
  furniture(g) {
    const P = this.poly, O = [-3640, -1838], d = [-0.906, -0.423], p = [0.423, -0.906], inset = (x, z) => pointInPoly(P, x, z) ? distPoly(P, x, z) : -1;
    const stone = M(0xe0cfa8), iron = M(0x1f2420), plant = M(0x4a4d4f), red = M(0xc0302a), green = M(0x3f6b34), trunk = M(0x6b5a45);
    const at = (s, w) => [O[0] + d[0] * s + p[0] * w, O[1] + d[1] * s + p[1] * w];
    const put = (obj, x, z, ry = 0) => { obj.position.set(x, this.gy(x, z) + 0.08, z); obj.rotation.y = ry; g.add(obj); };
    const bench = ry => { const b = new THREE.Group(); b.add(box(2.2, 0.15, 0.7, stone, 0, 0.45, 0), box(2.2, 0.55, 0.15, stone, 0, 0.45, -0.3), box(0.2, 0.45, 0.65, stone, -0.9), box(0.2, 0.45, 0.65, stone, 0.9)); b.rotation.y = ry; return b; };
    const lamp = () => { const l = new THREE.Group(); l.add(cyl(0.16, 0.1, 4.5, iron, 0, 0, 0, 8), box(1.2, 0.08, 0.08, iron, 0, 4.2), sph(0.22, M(0xf3e9b8), -0.55, 4.45, 0), sph(0.22, M(0xf3e9b8), 0.55, 4.45, 0), sph(0.22, M(0xf3e9b8), 0, 4.8, 0)); return l; };
    const planter = () => { const l = new THREE.Group(); l.add(box(1.2, 0.8, 1.2, plant), box(1.0, 0.12, 1.0, red, 0, 0.8)); return l; };
    const tree = () => { const t = new THREE.Group(); t.add(cyl(0.14, 0.2, 2.6, trunk, 0, 0, 0, 6), sph(1.9, green, 0, 4.0, 0, 0.85)); return t; };
    const palm = () => { const t = new THREE.Group(); t.add(cyl(0.22, 0.32, 7.5, M(0x7a6548), 0, 0, 0, 7)); for (let k = 0; k < 9; k++) { const f = box(0.2, 0.05, 2.8, M(0x4f7a38), 0, 7.4, 0); f.geometry.translate(0, 0, 1.4); f.rotation.y = k * 0.7; f.rotation.x = -0.35 + (k % 3) * 0.08; t.add(f); } return t; };
    let n = 0;
    for (let s = 6; s < 92; s += 14) for (const w of [-6.5, 6.5]) { const [x, z] = at(s, w); if (inset(x, z) < 2.2) continue; const ry = Math.atan2(-p[0] * Math.sign(w), -p[1] * Math.sign(w)); put(bench(0), x, z, ry); props.box(x, z, 1.1, 0.35, ry, this.gy(x, z) + 0.6); n++; }
    for (let s = 13; s < 90; s += 14) for (const w of [-2.2, 2.2]) { const [x, z] = at(s, w); if (inset(x, z) < 2) continue; put(planter(), x, z); props.box(x, z, 0.6, 0.6, 0, this.gy(x, z) + 0.9); n++; }
    for (let s = 9; s < 90; s += 12) for (const w of [-10, 10]) { const [x, z] = at(s, w + (s % 24 ? 0 : 1)); if (inset(x, z) < 3) continue; put(tree(), x, z); props.circle(x, z, 0.35, this.gy(x, z) + 3); n++; }
    for (let i = 0; i < P.length; i++) { const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], l = Math.hypot(bx - ax, bz - az); if (l < 8) continue; for (let t = 5; t < l - 3; t += 15) { const x0 = ax + (bx - ax) * t / l, z0 = az + (bz - az) * t / l; let nx = -(bz - az) / l, nz = (bx - ax) / l; if (!pointInPoly(P, x0 + nx * 1.5, z0 + nz * 1.5)) { nx = -nx; nz = -nz; } const x = x0 + nx * 1.6, z = z0 + nz * 1.6; if (inset(x, z) < 1) continue; put(lamp(), x, z); props.circle(x, z, 0.2, this.gy(x, z) + 4.4); n++; } }
    if (this.facade) {   // palms + the Padre Francisco monument on a granite planter bed beside the steps; palm next to the portal
      const F = this.facade, w = (u, v) => { const q = new THREE.Vector3(u, 0, v).applyMatrix4(F.f.matrixWorld); return [q.x, q.z]; };
      for (const [u, v] of [[-11.5, F.o + 7.5], [8, F.o + 7.5], [-14, F.o + 4]]) { const [x, z] = w(u, v); put(palm(), x, z); props.circle(x, z, 0.4, this.gy(x, z) + 3); n++; }
      const [x, z] = w(11, F.o + 6.5), bronze = M(0x3e3a35), bed = new THREE.Group(); bed.add(box(3.4, 0.5, 3.4, granite0), box(1.0, 1.2, 1.0, granite0, 0, 0.5), cyl(0.3, 0.25, 1.1, bronze, 0, 1.7, 0, 8), sph(0.18, bronze, 0, 3.0, 0), cyl(0.12, 0.1, 0.7, bronze, 0.32, 2.0, 0, 6)); put(bed, x, z, F.f.rotation.y); props.circle(x, z, 1.7, this.gy(x, z) + 3.3); n++;
    }
    const [mx, mz] = at(48, 0); if (inset(mx, mz) > 3) { const mm = new THREE.Group(); mm.add(box(2.2, 0.5, 1.6, M(0xc9b48a)), box(1.8, 3.2, 0.6, M(0x4a2e22), 0, 0.5)); put(mm, mx, mz, Math.atan2(d[0], d[1]) + Math.PI / 2); props.box(mx, mz, 1.1, 0.8, Math.atan2(d[0], d[1]) + Math.PI / 2, this.gy(mx, mz) + 3.7); n++; }
    this.stats.furniture = n;
  }

  update(cam) {
    const d = Math.hypot(CENTER[0] - cam.x, CENTER[1] - cam.z);
    if (!this.group && d < R_BUILD) { try { this.build(); } catch (e) { console.error('PlazaMayor build failed', e); this.group = new THREE.Group(); } }
    if (this.group) this.group.visible = d < R_SHOW * (window.__lodK ?? 1);
  }
}
const granite0 = M(0x9c9a94);
