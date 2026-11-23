import * as THREE from 'three';
import { toLocal } from './geo.js';

const CELL = 512;        // meshing cell (m)
const GCELL = 64;        // collision grid cell (m)
const FLOOR_H = 3.4;     // metres per storey

// Andalusian palette for walls: whitewash and warm creams. (Roofs come from the real orthophoto when available.)
const WALLS = [0xf3eee4, 0xeae2d1, 0xf5f2eb, 0xe4d8be, 0xdcd7cb, 0xf0e8d9, 0xe8d9c0, 0xd8cdb6];
const ROOFS = [0xb5573b, 0xa94f35, 0xc2644a, 0x8d4a38, 0x9a9a98, 0x7f8083, 0xb86a4c, 0xc9c4b8, 0xa8a49a];
const wallRGB = WALLS.map(h => new THREE.Color(h)), roofRGB = ROOFS.map(h => new THREE.Color(h));
const hash = i => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
const ORDER = [0, 1, -1, 2, -2];   // preference when the wanted LOD isn't built yet
const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

/** flat per-triangle normals for a non-indexed position array (what computeVertexNormals() gives for such geometry, without the BufferAttribute overhead) */
function flatNormals(p) {
  const n = new Float32Array(p.length);
  for (let i = 0; i + 8 < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    n[i] = n[i + 3] = n[i + 6] = x; n[i + 1] = n[i + 4] = n[i + 7] = y; n[i + 2] = n[i + 5] = n[i + 8] = z;
  }
  return n;
}

/** procedural facade ATLAS: 4x2 tiles of 128 px (one storey x one bay each), white base tinted per building by vertex colour.
 *  0 classic window  1 reja (tall barred window)  2 persiana shutters  3 balcony door  4 modern ribbon window
 *  5 arched window + cornice  6 industrial / blank with high small windows  7 brick-coursed with small window */
const FAC_STYLES = 8;
function facadeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 256);
  const glass = (x, y, w, h) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#3e5468'); gr.addColorStop(1, '#1d2935'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.8, y); g.lineTo(x + w * 0.25, y + h); g.fill(); };
  for (let t = 0; t < FAC_STYLES; t++) {
    g.save(); g.translate((t % 4) * 128, (t >> 2) * 128); g.beginPath(); g.rect(0, 0, 128, 128); g.clip();
    g.fillStyle = 'rgba(0,0,0,0.045)'; g.fillRect(0, 118, 128, 10);                       // floor slab line
    if (t === 0) {
      const x = 36, w = 56, y = 30, h = 62;
      g.fillStyle = '#ddd7c9'; g.fillRect(x - 5, y - 5, w + 10, h + 10); glass(x, y, w, h);
      g.fillStyle = '#e9e4d8'; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillRect(x, y + h * 0.38, w, 3); g.fillStyle = '#b9b2a2'; g.fillRect(x - 8, y + h + 5, w + 16, 5);
    } else if (t === 1) {                                                              // tall narrow window with wrought-iron reja
      const x = 46, w = 36, y = 22, h = 74;
      g.fillStyle = '#f2efe6'; g.fillRect(x - 4, y - 4, w + 8, h + 8); glass(x, y, w, h);
      g.fillStyle = '#15171a'; for (let k = 0; k <= 6; k++) g.fillRect(x + 2 + k * (w - 6) / 6, y - 2, 2.2, h + 4); g.fillRect(x - 4, y + h * 0.3, w + 8, 2.5); g.fillRect(x - 4, y + h * 0.7, w + 8, 2.5);
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 100, 128, 18);                        // darker band low on the wall
    } else if (t === 2) {                                                              // window with two louvred shutters (persianas)
      const x = 40, w = 48, y = 28, h = 64; g.fillStyle = '#ddd7c9'; g.fillRect(x - 4, y - 4, w + 8, h + 8); glass(x + 8, y, w - 16, h);
      g.fillStyle = '#7d8b73'; g.fillRect(x - 12, y, 20, h); g.fillRect(x + w - 8, y, 20, h); g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let k = 0; k < 14; k++) { g.fillRect(x - 12, y + 2 + k * 4.5, 20, 1.4); g.fillRect(x + w - 8, y + 2 + k * 4.5, 20, 1.4); }
    } else if (t === 3) {                                                              // french door + iron balcony
      const x = 44, w = 40, y = 14, h = 92; g.fillStyle = '#e4dfd2'; g.fillRect(x - 6, y - 6, w + 12, h + 8); glass(x, y, w, h); g.fillStyle = '#e9e4d8'; g.fillRect(x + w / 2 - 1.5, y, 3, h);
      g.fillStyle = '#c9c2b2'; g.fillRect(x - 16, y + h - 6, w + 32, 7);
      g.fillStyle = '#1b1d20'; g.fillRect(x - 16, y + h - 34, w + 32, 2.4); for (let k = 0; k <= 14; k++) g.fillRect(x - 15 + k * (w + 30) / 14, y + h - 34, 2, 28);
    } else if (t === 4) {                                                              // modern ribbon window, aluminium frame
      const x = 10, w = 108, y = 38, h = 44; g.fillStyle = '#9aa0a4'; g.fillRect(x - 3, y - 3, w + 6, h + 6); glass(x, y, w, h);
      g.fillStyle = '#9aa0a4'; for (let k = 1; k < 4; k++) g.fillRect(x + k * w / 4 - 1, y, 2.4, h); g.fillRect(x, y + h * 0.62, w, 2.4);
    } else if (t === 5) {                                                              // arched window, cornice and string course
      const x = 40, w = 48, y = 26, h = 70; g.fillStyle = '#e4dfd2'; g.beginPath(); g.rect(x - 5, y + w / 2, w + 10, h - w / 2 + 5); g.arc(x + w / 2, y + w / 2, w / 2 + 5, Math.PI, 0); g.fill();
      g.fillStyle = '#26394a'; g.beginPath(); g.rect(x, y + w / 2, w, h - w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.fill();
      g.fillStyle = '#e9e4d8'; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 128, 6); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 6, 128, 3); g.fillStyle = '#b9b2a2'; g.fillRect(x - 8, y + h + 4, w + 16, 5);
    } else if (t === 6) {                                                              // industrial: panel joints + small high windows
      g.fillStyle = 'rgba(0,0,0,0.10)'; for (let k = 0; k < 4; k++) g.fillRect(k * 32, 0, 1.6, 128); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 64, 128, 1.6);
      for (let k = 0; k < 2; k++) { glass(16 + k * 64, 20, 34, 16); g.fillStyle = '#9aa0a4'; g.fillRect(16 + k * 64, 36, 34, 2); }
    } else {                                                                           // brick courses + small window
      g.fillStyle = 'rgba(0,0,0,0.20)'; for (let r = 0; r < 24; r++) { g.fillRect(0, r * 5.4, 128, 1); for (let k = 0; k < 9; k++) g.fillRect(((r % 2) * 7 + k * 14) % 128, r * 5.4, 1, 5.4); }
      const x = 44, w = 40, y = 36, h = 48; g.fillStyle = '#e4dfd2'; g.fillRect(x - 5, y - 5, w + 10, h + 10); glass(x, y, w, h); g.fillStyle = '#e9e4d8'; g.fillRect(x + w / 2 - 1, y, 2.4, h); g.fillStyle = '#b9b2a2'; g.fillRect(x - 7, y + h + 5, w + 14, 4);
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Buildings {
  /** buf: buildings.bin ArrayBuffer; roofs: optional Uint8Array rgb per part (sampled from the orthophoto) */
  constructor(scene, hf, buf, roofs = null, facades = null) {
    this.scene = scene; this.hf = hf; this.roofs = roofs; this.fac = facades; this._wc = new THREE.Color();
    const hdr = new Uint32Array(buf, 0, 3), nParts = hdr[1], nPts = hdr[2];
    const counts = new Uint32Array(buf, 12, nParts);
    const floors = this.floors = new Uint8Array(buf, 12 + nParts * 4, nParts);
    const ll = new Int32Array(buf, 12 + nParts * 4 + nParts + (4 - nParts % 4) % 4, nPts * 2);
    this.n = nParts;

    const P = this.P = new Float32Array(nPts * 2), off = this.off = new Uint32Array(nParts + 1);
    for (let k = 0; k < nPts; k++) { const [x, z] = toLocal(ll[k * 2] / 1e7, ll[k * 2 + 1] / 1e7); P[k * 2] = x; P[k * 2 + 1] = z; }
    for (let i = 0; i < nParts; i++) off[i + 1] = off[i] + counts[i];

    this.bb = new Float32Array(nParts * 4);            // minx,maxx,minz,maxz
    this.base = new Float32Array(nParts); this.top = new Float32Array(nParts); this.area = new Float32Array(nParts);
    this.rev = new Uint8Array(nParts);                 // 1 = ring runs the "wrong" way for outward-facing wall triangles (true for practically every Catastro ring)
    this.cells = new Map(); this.grid = new Map(); this.skip = new Set();
    for (let i = 0; i < nParts; i++) {
      let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, g = 1e9, A = 0;
      const s = off[i], e = off[i + 1];
      for (let k = s; k < e; k++) {
        const x = P[k * 2], z = P[k * 2 + 1], n = k + 1 < e ? k + 1 : s;
        minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
        g = Math.min(g, hf.height(x, z)); A += x * P[n * 2 + 1] - P[n * 2] * z;
      }
      const f = floors[i], H = f === 0 ? 3.4 : f * FLOOR_H + 1.1;
      this.bb.set([minx, maxx, minz, maxz], i * 4);
      this.base[i] = g; this.top[i] = g + H; this.area[i] = Math.abs(A) / 2; this.rev[i] = A > 0 ? 1 : 0;
      const cx = Math.floor((minx + maxx) / 2 / CELL), cz = Math.floor((minz + maxz) / 2 / CELL), ck = (cx + 1000) * 10007 + cz + 1000;
      let c = this.cells.get(ck); if (!c) this.cells.set(ck, c = { x: cx * CELL, z: cz * CELL, list: [], m: [null, null, null], built: [false, false, false], job: null });
      c.list.push(i);
      for (let gx = Math.floor(minx / GCELL); gx <= Math.floor(maxx / GCELL); gx++)
        for (let gz = Math.floor(minz / GCELL); gz <= Math.floor(maxz / GCELL); gz++) {
          const k2 = gx * 100003 + gz; let l = this.grid.get(k2); if (!l) this.grid.set(k2, l = []); l.push(i);
        }
    }
    // far LOD (big blocks only) is meshed per 2 km cluster of 4x4 cells: one draw call instead of up to 16 (it used to be ~300 draw calls for 100k triangles)
    this.clusters = new Map();
    for (const c of this.cells.values()) {
      const kx = Math.floor(c.x / (CELL * 4)), kz = Math.floor(c.z / (CELL * 4)), k = (kx + 1000) * 10007 + kz + 1000;
      let q = this.clusters.get(k); if (!q) this.clusters.set(k, q = { cluster: true, cells: [], list: [], m: [null, null, null], built: [false, false, false], job: null, pure: false, show: false });
      q.cells.push(c); c.q = q;
    }
    for (const q of this.clusters.values()) for (const c of q.cells) for (const i of c.list) q.list.push(i);
    // walls are wound so their front faces look outwards -> single-sided (no back-face shading, correct sun side); roofs/parapets stay double-sided
    this.wallMat = new THREE.MeshLambertMaterial({ map: facadeTexture(), vertexColors: true, side: THREE.FrontSide });
    this.wallMat.onBeforeCompile = sh => {            // tiled sampling inside the atlas tile chosen by the per-vertex style (fract + explicit gradients keep mips seamless)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float sty; varying float vSty;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSty = sty;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSty;').replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec2 fu = fract(vMapUv), tl = vec2(mod(vSty, 4.0), floor(vSty / 4.0)), at = vec2(4.0, 2.0);
  diffuseColor *= textureGrad(map, (tl + fu * 0.96 + 0.02) / at, dFdx(vMapUv) / at, dFdy(vMapUv) / at);
#endif`);
    };
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.boxMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
    this.settings = { r0: 650, r1: 2800, r2: 8000 };
    this.stats = { lod0: 0, lod1: 0, lod2: 0 };
    this._rc = [0, 0, 0]; this._lx = 1e9; this._lz = 1e9; this._dirty = true; this.need = [];
  }

  /** custom modules: hide part i's generated mesh (collision stays) and/or change its height / baked facade colour; rebuilds its cell */
  override(i, { skip, top, rgb, plinth } = {}) {
    if (skip) this.skip.add(i);
    if (top != null) this.top[i] = this.base[i] + top;
    if (rgb && this.fac) { const o = i * 4; this.fac[o] = rgb[0]; this.fac[o + 1] = rgb[1]; this.fac[o + 2] = rgb[2]; if (plinth != null) this.fac[o + 3] = (this.fac[o + 3] & ~3) | plinth; }
    const bb = this.bb, cx = Math.floor((bb[i * 4] + bb[i * 4 + 1]) / 2 / CELL), cz = Math.floor((bb[i * 4 + 2] + bb[i * 4 + 3]) / 2 / CELL), c = this.cells.get((cx + 1000) * 10007 + cz + 1000);
    if (c) { for (let L = 0; L < 3; L++) this.free(c, L); c.job = null; if (c.q) { this.free(c.q, 2); c.q.job = null; } this._dirty = true; }
  }
  /** is world point inside a footprint whose roof is above y? */
  /** highest roof top (world y) at x,z that is <= ymax, or -Infinity: lets the on-foot player stand on rooftops */
  topAt(x, z, ymax) {
    const list = this.grid.get(Math.floor(x / GCELL) * 100003 + Math.floor(z / GCELL));
    if (!list) return -Infinity;
    const P = this.P, off = this.off; let best = -Infinity;
    for (const i of list) {
      const b = i * 4, t = this.top[i];
      if (t > ymax || t <= best || x < this.bb[b] || x > this.bb[b + 1] || z < this.bb[b + 2] || z > this.bb[b + 3]) continue;
      const s = off[i], e = off[i + 1]; let inside = false;
      for (let a = s, c = e - 1; a < e; c = a++) {
        const xi = P[a * 2], zi = P[a * 2 + 1], xj = P[c * 2], zj = P[c * 2 + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) best = t;
    }
    return best;
  }
  hit(x, z, y) {
    if (this.ug && this.ug.under(x, z, y)) return this.ug.blocks(x, z, y);   // below ground: surface buildings do not exist, the tunnel walls do
    const list = this.grid.get(Math.floor(x / GCELL) * 100003 + Math.floor(z / GCELL));
    if (!list) return false;
    const P = this.P, off = this.off;
    for (const i of list) {
      const b = i * 4;
      if (x < this.bb[b] || x > this.bb[b + 1] || z < this.bb[b + 2] || z > this.bb[b + 3] || y > this.top[i]) continue;
      const s = off[i], e = off[i + 1]; let inside = false;
      for (let a = s, c = e - 1; a < e; c = a++) {
        const xi = P[a * 2], zi = P[a * 2 + 1], xj = P[c * 2], zj = P[c * 2 + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) {
        const hs = this.holes && this.holes.get(i);   // walk-through openings (arch passages): oriented box below a ceiling height
        if (hs) { let open = false; for (const h of hs) { const dx = x - h.cx, dz = z - h.cz; if (y < h.top && Math.abs(dx * h.ax + dz * h.az) <= h.hl && Math.abs(-dx * h.az + dz * h.ax) <= h.hw) { open = true; break; } } if (open) continue; }
        return true;
      }
    }
    return false;
  }
  /** carve a walk-through passage in part i's collision: centre (cx,cz), unit axis (ax,az), half-length hl, half-width hw, open below world height `top` */
  hole(i, cx, cz, ax, az, hl, hw, top) { (this.holes || (this.holes = new Map())).set(i, [...(this.holes.get(i) || []), { cx, cz, ax, az, hl, hw, top }]); }

  // ------------------------------------------------------------ per-frame LOD management
  update(cam, budgetMs = 3) {
    // LOD decisions only change when the camera moves or a mesh finishes: re-evaluate then, not every frame
    const mx = cam.x - this._lx, mz = cam.z - this._lz;
    const tnow = performance.now();
    if ((this._dirty && tnow - (this._te || 0) > 120) || mx * mx + mz * mz > 100) { this._te = tnow; this.evaluate(cam); this._lx = cam.x; this._lz = cam.z; this._dirty = false; }
    const deadline = performance.now() + budgetMs;
    for (const n of this.need) {                      // nearest first, a few ms per frame; a cell's job may span many frames
      if (n.c.built[n.want]) continue;
      if (!n.c.job || n.c.job.L !== n.want) n.c.job = this.startJob(n.c, n.want);
      const j = n.c.job;
      if ((j.i >= j.c.list.length || this.step(j, deadline)) && this.finish(j)) { n.c.job = null; this._dirty = true; }   // finish() is itself sliced over several frames
      if (performance.now() > deadline) break;
    }
  }

  evaluate(cam) {
    const { r0, r1, r2 } = this.settings, st = this.stats;
    st.lod0 = st.lod1 = st.lod2 = 0;
    const need = this.need = [];
    for (const c of this.cells.values()) {
      const dx = Math.max(Math.abs(c.x + CELL / 2 - cam.x) - CELL / 2, 0), dz = Math.max(Math.abs(c.z + CELL / 2 - cam.z) - CELL / 2, 0), d = Math.hypot(dx, dz);
      c.d = d; c.want = d < r0 ? 0 : d < r1 ? 1 : d < r2 ? 2 : -1;
    }
    // a cluster whose cells all want the far LOD ("pure") is drawn as ONE mesh. When the camera gets closer and it stops being pure, the cluster mesh
    // stays up until its far cells have their own LOD2 meshes (identical boxes, so the brief overlap is invisible) -> no holes, no popping.
    for (const q of this.clusters.values()) {
      let pure = true, any = false, ready = true, dmin = 1e9;
      for (const c of q.cells) { if (c.want === 0 || c.want === 1) pure = false; else if (c.want === 2) { any = true; if (!c.built[2]) ready = false; } if (c.d < dmin) dmin = c.d; }
      pure = pure && any; q.pure = pure;
      if (pure && !q.built[2]) need.push({ c: q, want: 2, d: dmin });
      q.show = q.built[2] && (pure || (any && !ready));
      if (q.m[2]) { q.m[2].visible = q.show; if (q.show) st.lod2++; }
      if (q.built[2] && !q.show) this.free(q, 2);
    }
    for (const c of this.cells.values()) {
      const want = c.want, d = c.d, q = c.q, viaCluster = want === 2 && q.show;
      if (want >= 0 && !c.built[want] && !(want === 2 && q.pure)) need.push({ c, want, d });
      // show the built LOD closest to the wanted one (no holes while the wanted one is still being meshed)
      let show = -1;
      if (want >= 0 && !viaCluster) for (let k = 0; k < 5 && show < 0; k++) { const L = want + ORDER[k]; if (L >= 0 && L <= 2 && c.built[L]) show = L; }
      for (let L = 0; L < 3; L++) if (c.m[L]) { c.m[L].visible = L === show; if (L === show) st['lod' + L]++; }
      if (c.built[2] && q.pure && q.show) this.free(c, 2);    // covered by the cluster mesh
      if (c.built[0] && d > r0 * 1.6) this.free(c, 0);       // free what is far away
      if (c.built[1] && d > r1 * 1.4) this.free(c, 1);
      if (c.built[2] && d > r2 * 1.3) this.free(c, 2);
    }
    need.sort((a, b) => a.d - b.d);
  }

  free(c, L) {
    const m = c.m[L]; if (!m) return;
    this.scene.remove(m); m.traverse(o => o.geometry?.dispose()); c.m[L] = null; c.built[L] = false;
  }

  startJob(c, L) {
    return L === 0 ? { c, L, i: 0, wp: [], wu: [], ws: [], wc: [], rp: [], rc: [] } : { c, L, i: 0, pos: [], nor: [], col: [] };
  }
  /** process parts until the deadline; returns true when the cell is complete */
  step(job, deadline) {
    const list = job.c.list;
    while (job.i < list.length) {
      const i = list[job.i++];
      if (this.skip.has(i)) continue;   // drawn by a custom module (plazamayor.js); the footprint still collides
      if (job.L === 0) this.partDetail(i, job); else this.partBox(i, job);
      if (performance.now() > deadline) break;
    }
    return job.i >= list.length;
  }
  /** turn a finished job into meshes. LOD0 cells are big (hundreds of thousands of floats), so the typed-array conversion and the
   *  normals are spread over 4 calls (one per frame slice) instead of one long hitch. Returns true once the cell is in the scene. */
  finish(job) {
    if (job.L === 0) {
      const f = job.fin || (job.fin = { s: 0 });
      switch (f.s++) {
        case 0: f.wp = new Float32Array(job.wp); job.wp = null; return false;
        case 1: f.wn = flatNormals(f.wp); f.wu = new Float32Array(job.wu); job.wu = null; f.ws = new Float32Array(job.ws); job.ws = null; return false;
        case 2: f.wc = new Float32Array(job.wc); job.wc = null; return false;
        case 3: f.rp = new Float32Array(job.rp); f.rn = flatNormals(f.rp); f.rc = new Float32Array(job.rc); job.rp = job.rc = null; return false;
      }
    }
    const group = new THREE.Group();
    if (job.L === 0) {
      const f = job.fin, A = (a, n) => new THREE.BufferAttribute(a, n);
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', A(f.wp, 3)); wg.setAttribute('normal', A(f.wn, 3)); wg.setAttribute('uv', A(f.wu, 2)); wg.setAttribute('sty', A(f.ws, 1)); wg.setAttribute('color', A(f.wc, 3));
      wg.computeBoundingSphere(); group.add(new THREE.Mesh(wg, this.wallMat));
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', A(f.rp, 3)); rg.setAttribute('normal', A(f.rn, 3)); rg.setAttribute('color', A(f.rc, 3));
      rg.computeBoundingSphere(); group.add(new THREE.Mesh(rg, this.solidMat));
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(job.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(job.nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(job.col, 3));
      geo.computeBoundingSphere(); group.add(new THREE.Mesh(geo, this.boxMat));
    }
    group.visible = false; group.name = job.c.cluster ? 'bld-far' : 'bld-lod' + job.L;
    group.traverse(o => { o.matrixAutoUpdate = false; });
    this.scene.add(group); job.c.m[job.L] = group; job.c.built[job.L] = true;
    return true;
  }

  /** wall colour of part i: baked facade colour (scripts/facades.mjs) when available, else palette. Returns a THREE.Color (linear). */
  wallColor(i, r) {
    if (!this.fac) return wallRGB[(r * 977 | 0) % wallRGB.length];
    const o = i * 4, c = this._wc; c.setRGB(LIN[this.fac[o]], LIN[this.fac[o + 1]], LIN[this.fac[o + 2]]); return c;
  }
  /** facade atlas style of part i (deterministic: hash + storeys + footprint area); 0 classic .. 7 brick, see facadeTexture */
  facadeStyle(i) {
    const h = hash(i + 4001), f = this.floors[i], a = this.area[i];
    if (f === 0 || a > 700) return h < 0.7 ? 6 : 7;                                // sheds, warehouses, big blocks
    if (f >= 4) return h < 0.4 ? 4 : h < 0.7 ? 3 : h < 0.85 ? 0 : 5;               // apartment blocks: ribbon windows, balconies
    if (f === 3) return h < 0.25 ? 3 : h < 0.45 ? 5 : h < 0.6 ? 4 : h < 0.8 ? 0 : 2;
    return h < 0.22 ? 1 : h < 0.4 ? 2 : h < 0.55 ? 0 : h < 0.7 ? 3 : h < 0.82 ? 5 : h < 0.92 ? 7 : 4;   // houses: rejas, persianas, balconies, brick, ribbon
  }
  /** plinth (zocalo) colour multiplier set for part i: [r,g,b] linear or null */
  plinth(i, wc) {
    if (!this.fac) return null;
    switch (this.fac[i * 4 + 3] & 3) {
      case 1: return [0.62, 0.60, 0.56];                       // grey stone base
      case 2: return [0.55 * wc.r + 0.30, 0.30 * wc.g + 0.08, 0.22 * wc.b + 0.04];   // almagre / ochre band
      case 3: return [wc.r * 0.45, wc.g * 0.45, wc.b * 0.45];  // dark base
      default: return null;
    }
  }

  /** roof colour (linear) of part i: sampled from the real orthophoto when available, else palette */
  roofColor(i, r) {
    const out = this._rc;
    if (this.roofs) {
      const o = i * 3; out[0] = LIN[this.roofs[o]] * 0.85; out[1] = LIN[this.roofs[o + 1]] * 0.85; out[2] = LIN[this.roofs[o + 2]] * 0.85;
    } else { const c = roofRGB[(r * 7919 | 0) % roofRGB.length]; out[0] = c.r; out[1] = c.g; out[2] = c.b; }
    return out;
  }

  // ------------------------------------------------------------ LOD0: facades with windows + roofs
  partDetail(i, job) {
    const { wp, wu, ws, wc, rp, rc } = job, { P, off } = this, sty = this.facadeStyle(i);
    const s = off[i], m = off[i + 1] - s, base = this.base[i], top = this.top[i], r = hash(i);
    const wcol = this.wallColor(i, r).clone(), rcol = this.roofColor(i, r), pl = this.plinth(i, wcol);
    const bri = 0.93 + hash(i + 77) * 0.1, y0 = base - 0.6, v0 = (y0 - base) / FLOOR_H, v1 = (top - 1.1 - base) / FLOOR_H + (this.floors[i] === 0 ? 0.3 : 0);
    let u = hash(i + 5) * 9; const rev = this.rev[i];
    const gable = m === 4 && this.floors[i] > 0 && this.floors[i] <= 2 && r < 0.4 && this.area[i] < 220;
    for (let a = 0; a < m; a++) {
      const k0 = s + a, k1 = s + (a + 1) % m, ka = rev ? k1 : k0, kb = rev ? k0 : k1, ax = P[ka * 2], az = P[ka * 2 + 1], bx = P[kb * 2], bz = P[kb * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az), ua = u, ub = u + len / 3.3; u = ub;
      if (len < 0.05) continue;
      const lo = 0.74 * bri, hi = bri, cr = wcol.r, cg = wcol.g, cb = wcol.b;     // cheap ambient occlusion: darker at the foot
      const yp = pl && top - y0 > 2.6 ? y0 + 1.5 : null;                            // plinth band up to ~0.9 m above the floor line
      if (yp) {
        const vp = v0 + (yp - y0) / FLOOR_H, pr = pl[0] * bri, pg = pl[1] * bri, pb = pl[2] * bri;
        wp.push(ax, y0, az, bx, y0, bz, bx, yp, bz, ax, y0, az, bx, yp, bz, ax, yp, az, ax, yp, az, bx, yp, bz, bx, top, bz, ax, yp, az, bx, top, bz, ax, top, az);
        wu.push(ua, v0, ub, v0, ub, vp, ua, v0, ub, vp, ua, vp, ua, vp, ub, vp, ub, v1, ua, vp, ub, v1, ua, v1); for (let q = 0; q < 12; q++) ws.push(sty);
        wc.push(pr * 0.74, pg * 0.74, pb * 0.74, pr * 0.74, pg * 0.74, pb * 0.74, pr, pg, pb, pr * 0.74, pg * 0.74, pb * 0.74, pr, pg, pb, pr, pg, pb,
          cr * lo, cg * lo, cb * lo, cr * lo, cg * lo, cb * lo, cr * hi, cg * hi, cb * hi, cr * lo, cg * lo, cb * lo, cr * hi, cg * hi, cb * hi, cr * hi, cg * hi, cb * hi);
        continue;
      }
      wp.push(ax, y0, az, bx, y0, bz, bx, top, bz, ax, y0, az, bx, top, bz, ax, top, az);
      wu.push(ua, v0, ub, v0, ub, v1, ua, v0, ub, v1, ua, v1); for (let q = 0; q < 6; q++) ws.push(sty);
      wc.push(cr * lo, cg * lo, cb * lo, cr * lo, cg * lo, cb * lo, cr * hi, cg * hi, cb * hi, cr * lo, cg * lo, cb * lo, cr * hi, cg * hi, cb * hi, cr * hi, cg * hi, cb * hi);
    }
    if (gable) this.gableRoof(s, top, rp, rc, rcol, bri);
    else this.flatRoof(s, m, top, rp, rc, wcol, rcol, bri);
    this.roofProps(i, s, m, gable ? top + Math.min(...[0, 1].map(k => Math.hypot(P[(s + k + 1) * 2] - P[(s + k) * 2], P[(s + k + 1) * 2 + 1] - P[(s + k) * 2 + 1]))) * 0.2 : top, rp, rc, bri);
  }

  // chimneys (~35% of buildings) and TV antennas (~25%): tiny deterministic boxes placed between a vertex and the centroid
  roofProps(i, s, m, top, rp, rc, bri) {
    const { P } = this, r1 = hash(i + 301), r2 = hash(i + 302);
    if (this.area[i] < 25 || (r1 > 0.35 && r2 > 0.25)) return;
    let cx = 0, cz = 0; for (let a = 0; a < m; a++) { cx += P[(s + a) * 2]; cz += P[(s + a) * 2 + 1]; } cx /= m; cz /= m;
    const box = (x, z, w, h, c, y0) => {
      const x0 = x - w, x1 = x + w, z0 = z - w, z1 = z + w, y1 = y0 + h, q = (...v) => { rp.push(...v); for (let t = 0; t < v.length / 3; t++) rc.push(c[0], c[1], c[2]); };
      q(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y0, z0, x1, y1, z0, x0, y1, z0, x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y0, z1, x0, y1, z1, x1, y1, z1,
        x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y0, z1, x0, y1, z0, x0, y1, z1, x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y0, z0, x1, y1, z1, x1, y1, z0,
        x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z0, x1, y1, z1, x0, y1, z1);
    };
    const pt = (r) => { const k = s + Math.floor(r * m) % m; return [P[k * 2] + (cx - P[k * 2]) * 0.45, P[k * 2 + 1] + (cz - P[k * 2 + 1]) * 0.45]; };
    if (r1 <= 0.35) { const [x, z] = pt(hash(i + 303)); box(x, z, 0.3, 1.1 + hash(i + 304) * 0.5, [0.55 * bri, 0.38 * bri, 0.32 * bri], top); box(x, z, 0.36, 0.12, [0.3, 0.3, 0.3], top + 1.1 + hash(i + 304) * 0.5); }
    if (r2 <= 0.25) { const [x, z] = pt(hash(i + 305)), h = 2.2 + hash(i + 306) * 1.2; box(x, z, 0.04, h, [0.6, 0.6, 0.62], top); box(x, z, 0.5 * 0.5, 0.04, [0.6, 0.6, 0.62], top + h * 0.8); }
  }

  flatRoof(s, m, top, rp, rc, wcol, rcol, bri) {
    const { P } = this;
    const contour = []; for (let a = 0; a < m; a++) contour.push(new THREE.Vector2(P[(s + a) * 2], P[(s + a) * 2 + 1]));
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
    const cr = rcol[0] * bri, cg = rcol[1] * bri, cb = rcol[2] * bri;
    for (const t of tris) for (const v of t) { rp.push(contour[v].x, top, contour[v].y); rc.push(cr, cg, cb); }
    const cw = wcol.r * bri * 0.95, cgw = wcol.g * bri * 0.95, cbw = wcol.b * bri * 0.95;   // low parapet around the azotea
    for (let a = 0; a < m; a++) {
      const ka = s + a, kb = s + (a + 1) % m, ax = P[ka * 2], az = P[ka * 2 + 1], bx = P[kb * 2], bz = P[kb * 2 + 1];
      rp.push(ax, top, az, bx, top, bz, bx, top + 0.7, bz, ax, top, az, bx, top + 0.7, bz, ax, top + 0.7, az);
      for (let q = 0; q < 6; q++) rc.push(cw, cgw, cbw);
    }
  }

  gableRoof(s, top, rp, rc, rcol, bri) {
    const { P } = this;
    const p = [0, 1, 2, 3].map(k => [P[(s + k) * 2], P[(s + k) * 2 + 1]]);
    const l01 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), l12 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
    // A and B are the two short edges; ridge joins their midpoints. A1-B0 and B1-A0 are the long edges.
    const [A0, A1, B0, B1] = l01 < l12 ? [p[0], p[1], p[2], p[3]] : [p[1], p[2], p[3], p[0]];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const mA = mid(A0, A1), mB = mid(B0, B1), yr = top + Math.min(l01, l12) * 0.3;
    const tri = (a, ya, b, yb, c, yc, shade) => {
      rp.push(a[0], ya, a[1], b[0], yb, b[1], c[0], yc, c[1]);
      const k = bri * shade; for (let q = 0; q < 3; q++) rc.push(rcol[0] * k, rcol[1] * k, rcol[2] * k);
    };
    tri(A0, top, A1, top, mA, yr, 0.8);                                   // gable ends
    tri(B0, top, B1, top, mB, yr, 0.8);
    tri(A1, top, B0, top, mB, yr, 1.0); tri(A1, top, mB, yr, mA, yr, 1.0);  // slope over long edge A1-B0
    tri(B1, top, A0, top, mA, yr, 0.9); tri(B1, top, mA, yr, mB, yr, 0.9);  // slope over long edge B1-A0
  }

  // ------------------------------------------------------------ LOD1/2: oriented boxes ("cubitos")
  partBox(i, job) {
    const { pos, nor, col } = job, { P, off } = this, L = job.L;
    if (this.area[i] < (L === 1 ? 24 : 110) && this.floors[i] < (L === 1 ? 1 : 3)) return;
    const s = off[i], e = off[i + 1];
    let best = 0, dx = 1, dz = 0;                                          // orientation = longest edge
    for (let k = s; k < e; k++) { const n = k + 1 < e ? k + 1 : s, ex = P[n * 2] - P[k * 2], ez = P[n * 2 + 1] - P[k * 2 + 1], l = Math.hypot(ex, ez); if (l > best) { best = l; dx = ex / l; dz = ez / l; } }
    const px = -dz, pz = dx; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let k = s; k < e; k++) { const x = P[k * 2], z = P[k * 2 + 1], u = x * dx + z * dz, v = x * px + z * pz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const qx0 = u0 * dx + v0 * px, qz0 = u0 * dz + v0 * pz, qx1 = u1 * dx + v0 * px, qz1 = u1 * dz + v0 * pz, qx2 = u1 * dx + v1 * px, qz2 = u1 * dz + v1 * pz, qx3 = u0 * dx + v1 * px, qz3 = u0 * dz + v1 * pz;
    const q = [[qx0, qz0], [qx1, qz1], [qx2, qz2], [qx3, qz3]];
    const y0 = this.base[i] - 0.5, y1 = this.top[i], r = hash(i), wcol = this.wallColor(i, r), rcol = this.roofColor(i, r);
    for (let a = 0; a < 4; a++) {
      const A = q[a], B = q[(a + 1) % 4], nx = B[1] - A[1], nz = -(B[0] - A[0]), nl = Math.hypot(nx, nz) || 1;
      pos.push(A[0], y0, A[1], B[0], y1, B[1], B[0], y0, B[1], A[0], y0, A[1], A[0], y1, A[1], B[0], y1, B[1]);
      for (let k = 0; k < 6; k++) { nor.push(nx / nl, 0, nz / nl); const sh = k === 0 || k === 2 || k === 3 ? 0.78 : 1; col.push(wcol.r * sh, wcol.g * sh, wcol.b * sh); }
    }
    pos.push(q[0][0], y1, q[0][1], q[2][0], y1, q[2][1], q[1][0], y1, q[1][1], q[0][0], y1, q[0][1], q[3][0], y1, q[3][1], q[2][0], y1, q[2][1]);
    for (let k = 0; k < 6; k++) { nor.push(0, 1, 0); col.push(rcol[0], rcol[1], rcol[2]); }
  }
}
